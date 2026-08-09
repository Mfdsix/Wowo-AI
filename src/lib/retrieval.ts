// ─── Retrieval — cari chunk relevan dari dokumen yang udah ke-index ──
// Query-time: embed pertanyaan → cosine similarity ke semua chunk session
// → ambil top-K. Skala lokal (~ribuan chunk × 768 dim) → brute-force di JS
// masih milidetik; kalau nanti multipel user baru lirik vector DB.

import { prisma } from "@/lib/prisma";
import { cosineSimilarity, embedTexts, unpackF32 } from "@/lib/embeddings";

export const RETRIEVAL_TOP_K = 10;

// Dokumen baru dianggap "besar" (layak retrieval, bukan inline) kalau hasil
// index-nya ≥ N chunk. Di bawah ini, teks penuh inline lebih baik (exact).
export const RETRIEVAL_MIN_CHUNKS = 6;

export type RetrievedChunk = {
  attachmentId: string;
  filename: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  score: number;
};

// Retrieve top-K chunk untuk satu session (+ opsi filter per attachment).
// Return [] kalau embedding gagal / gak ada chunk.
export async function retrieveChunks(opts: {
  sessionId: string;
  question: string;
  topK?: number;
  attachmentId?: string;
}): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? RETRIEVAL_TOP_K;
  if (!opts.question.trim()) return [];

  let qvec: number[];
  try {
    [qvec] = await embedTexts([opts.question]);
  } catch (err) {
    console.error("[Retrieval] embed pertanyaan gagal:", err);
    return [];
  }
  if (!qvec) return [];

  const chunks = await prisma.docChunk.findMany({
    where: {
      sessionId: opts.sessionId,
      ...(opts.attachmentId ? { attachmentId: opts.attachmentId } : {}),
      embedding: { not: null },
    },
    select: {
      attachmentId: true,
      pageStart: true,
      pageEnd: true,
      text: true,
      embedding: true,
      attachment: { select: { filename: true } },
    },
  });

  const scored: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (!c.embedding) continue;
    scored.push({
      attachmentId: c.attachmentId,
      filename: c.attachment.filename,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      text: c.text,
      score: cosineSimilarity(qvec, unpackF32(c.embedding)),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// Cari attachment yang udah siap di-index (status ready) di session,
// cocok dari file yang baru di-analisa (filename+size+type).
// Dipake route /api/chat buat mutusin: inline vs retrieval.
export async function findIndexedAttachment(opts: {
  sessionId: string;
  filename: string;
  size: number;
  mimeType: string;
}) {
  return prisma.attachment.findFirst({
    where: {
      sessionId: opts.sessionId,
      filename: opts.filename,
      size: opts.size,
      status: "ready",
    },
    select: {
      id: true,
      filename: true,
      status: true,
      progress: true,
      _count: { select: { chunks: true } },
    },
  });
}
