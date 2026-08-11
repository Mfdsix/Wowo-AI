// ─── Index Worker — index dokumen besar ke chunk + embedding ──────
// Background pipeline buat dokumen yang di-upload (native & scan):
//   native → extract full per-page → chunk → embed
//   scan   → render SEMUA halaman (bypass VISION_PDF_MAX_PAGES) → OCR
//            batch dengan concurrency → per-page text → chunk → embed
//
// Status Attachment: pending → extracting → ocr (scan) → indexing → ready | failed.
// Idempoten: DocChunk di-reset per attachment, resume gak dobel-insert.
// Trigger: fire-and-forget dari route upload. Embedding nonaktif → no-op.

import { prisma } from "@/lib/prisma";
import {
  decodeText,
  detectKind,
  extractDocxText,
  extractPdf,
} from "@/lib/attachments";
import { chunkPages, type PageText } from "@/lib/chunker";
import { embedTexts, embeddingEnabled, packF32 } from "@/lib/embeddings";
import {
  profileFromPages,
  renderPdfPages,
  routePdf,
} from "@/lib/documentRouter";
import { runPaddleOcr } from "@/lib/ocrClient";

export const INDEX_STATUS = {
  PENDING: "pending",
  EXTRACTING: "extracting",
  OCR: "ocr",
  INDEXING: "indexing",
  READY: "ready",
  FAILED: "failed",
} as const;

const getIndexMaxPages = () =>
  Math.max(1, parseInt(process.env.DOC_INDEX_MAX_PAGES ?? "200", 10) || 200);

const getOcrConcurrency = () =>
  Math.max(1, parseInt(process.env.OCR_INDEX_CONCURRENCY ?? "4", 10) || 4);

const OCR_BATCH = 4; // halaman per request /ocr

async function setStatus(id: string, status: string, progress: number) {
  await prisma.attachment
    .update({ where: { id }, data: { status, progress } })
    .catch(() => {});
}

// Proses beberapa attachment yang antri. Return jumlah yang diproses.
export async function runIndexWorker(opts?: { limit?: number }): Promise<number> {
  if (!embeddingEnabled()) return 0; // EMBEDDING_MODEL kosong → fitur nonaktif

  const limit = opts?.limit ?? 3;
  const candidates = await prisma.attachment.findMany({
    where: {
      data: { not: null },
      mimeType: { not: { startsWith: "image/" } },
      status: {
        in: [INDEX_STATUS.PENDING, INDEX_STATUS.EXTRACTING, INDEX_STATUS.OCR, INDEX_STATUS.INDEXING],
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      sessionId: true,
      filename: true,
      mimeType: true,
      size: true,
      data: true,
    },
  });

  let done = 0;
  for (const att of candidates) {
    try {
      await indexOne(att);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[IndexWorker] gagal index "${att.filename}":`, msg);
      await prisma.attachment
        .update({
          where: { id: att.id },
          data: { status: INDEX_STATUS.FAILED, error: msg.slice(0, 500) },
        })
        .catch(() => {});
    }
  }
  return done;
}

type Candidate = {
  id: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Uint8Array | null;
};

async function indexOne(att: Candidate) {
  if (!att.data) return;
  const data = new Uint8Array(att.data);
  const kind = detectKind(att.filename, att.mimeType);
  if (!kind || kind === "image") return;

  await setStatus(att.id, INDEX_STATUS.EXTRACTING, 10);

  // 1) Per-page text — re-extract FULL (bukan textContent yang di-truncate 100k)
  let pages: PageText[];
  if (kind === "pdf") {
    const pdf = await extractPdf(data);
    const profile = profileFromPages(pdf.pages, pdf.pageCount);
    if (routePdf(profile) !== "native") {
      // Scan / kompleks → OCR semua halaman (bypass cap interaktif)
      pages = await ocrPdfPages(data, pdf.pageCount, att.id);
    } else {
      pages = pdf.pages.map((p) => ({ num: p.num, text: p.text }));
    }
  } else if (kind === "docx") {
    const text = await extractDocxText(data);
    pages = text.trim() ? [{ num: 1, text }] : [];
  } else {
    const text = decodeText(data);
    pages = text.trim() ? [{ num: 1, text }] : [];
  }

  if (pages.length === 0) {
    await setStatus(att.id, INDEX_STATUS.READY, 100);
    return;
  }

  // 2) Chunk
  await setStatus(att.id, INDEX_STATUS.INDEXING, 80);
  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    await setStatus(att.id, INDEX_STATUS.READY, 100);
    return;
  }

  // 3) Embed (batch di dalam embedTexts)
  const vectors = await embedTexts(chunks.map((c) => c.text));

  // 4) Simpan — reset dulu biar idempoten (retry/run ulang bersih)
  await prisma.$transaction([
    prisma.docChunk.deleteMany({ where: { attachmentId: att.id } }),
    ...chunks.map((c, i) =>
      prisma.docChunk.create({
        data: {
          attachmentId: att.id,
          sessionId: att.sessionId,
          chunkIndex: c.chunkIndex,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          text: c.text,
          embedding: Buffer.from(packF32(vectors[i])),
        },
      })
    ),
  ]);

  await setStatus(att.id, INDEX_STATUS.READY, 100);
  console.log(
    `[IndexWorker] "${att.filename}": ${chunks.length} chunk dari ${pages.length} halaman OK`
  );
}

// Render semua halaman PDF scan → OCR dengan concurrency → per-page text.
// Halaman yang gagal OCR tetap diisi teks kosong (bukan fail total).
async function ocrPdfPages(
  data: Uint8Array,
  pageCount: number,
  attachmentId: string
): Promise<PageText[]> {
  const baseUrl = process.env.OCR_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "OCR_BASE_URL belum diset di .env — gak bisa index PDF scan. " +
        "Setup service OCR (repo terpisah) atau dokumen ini gak akan ke-index."
    );
  }
  const lang = process.env.OCR_LANGUAGE?.trim() || "ch";

  const maxPages = Math.min(pageCount, getIndexMaxPages());
  if (maxPages < pageCount) {
    console.warn(
      `[IndexWorker] "${attachmentId}": index ${maxPages}/${pageCount} halaman ` +
        `(DOC_INDEX_MAX_PAGES=${maxPages})`
    );
  }

  const rendered = await renderPdfPages(data, { maxPages });
  if (rendered.length === 0) return [];

  // Batch OCR: split halaman → beberapa request /ocr, jalan concurrency.
  const concurrency = getOcrConcurrency();
  const results = new Map<number, string>();
  const queue = [...rendered];
  const total = queue.length;
  let completed = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const batch = queue.splice(0, OCR_BATCH);
      try {
        const ocrPages = await runPaddleOcr(batch, baseUrl, lang);
        // app.py ngasih `page` = index dalam batch (1-based) → map balik
        // ke pageNumber asli lewat posisi di batch.
        for (let i = 0; i < batch.length; i++) {
          results.set(batch[i].pageNumber, ocrPages[i]?.text ?? "");
        }
      } catch (err) {
        console.error(
          `[IndexWorker] OCR batch gagal (${batch.length} hal):`,
          err instanceof Error ? err.message : err
        );
        for (const b of batch) results.set(b.pageNumber, "");
      }
      completed += batch.length;
      await setStatus(
        attachmentId,
        INDEX_STATUS.OCR,
        10 + Math.round((completed / total) * 70)
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return [...results.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([num, text]) => ({ num, text }));
}
