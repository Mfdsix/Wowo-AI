// ─── Document Router ────────────────────────────────────────────
// Profiler + adaptive routing buat dokumen (fokus PDF dulu).
// Prinsip (dari desain Document Mode): jangan paksa semua dokumen
// lewat jalur yang sama. Deteksi apakah PDF punya text layer →
//  - native: text layer oke → langsung extract (murah & deterministic)
//  - vision: halaman di-render → VLM baca langsung (kompleks/visual)
//  - ocr:   render → PaddleOCR service (scan text-heavy, multilingual)
// Fase 1: routing document-level. Page-level routing & telemetry = fase lanjut.

import { PDFParse } from "pdf-parse";

export type DocRoute = "native" | "vision" | "ocr";

export type DocumentProfile = {
  pageCount: number;
  totalChars: number;
  avgTextPerPage: number;
  lowTextPages: number; // halaman dengan teks < TEXT_PAGE_THRESHOLD (dianggap scan/gambar)
  textCoverage: number; // 0..1 — proporsi halaman yang punya teks cukup
  extractionQuality: number; // 0..1 — normalisasi kepadatan teks per halaman
};

// ─── Thresholds & tuning (bisa di-override via env) ─────────────
export const TEXT_PAGE_THRESHOLD = 100; // chars — di bawah ini halaman "hampir kosong"
export const EXTRACTION_QUALITY_DIVISOR = 800; // chars/page yang dianggap padat
export const OCR_SCORE_NATIVE = 30; // < 30 → native
export const OCR_SCORE_VISION = 60; // < 60 → vision, ≥ 60 → ocr

export const getMaxVisionPdfPages = () =>
  Math.max(1, parseInt(process.env.VISION_PDF_MAX_PAGES ?? "8", 10) || 8);

export const getVisionPdfDesiredWidth = () =>
  Math.max(320, parseInt(process.env.VISION_PDF_DESIRED_WIDTH ?? "1600", 10) || 1600);

// ─── Profiling (pure — mudah di-test) ───────────────────────────
// pages dari pdf-parse getText() punya 1 entry per halaman (termasuk yang kosong),
// jadi lowTextPages bisa dihitung langsung dari array-nya.
export function profileFromPages(
  pages: { num: number; text: string }[],
  pageCount: number
): DocumentProfile {
  const perPage =
    pages.length > 0
      ? pages
      : Array.from({ length: pageCount }, () => ({ num: 0, text: "" }));

  const totalChars = perPage.reduce((sum, p) => sum + p.text.length, 0);
  const avgTextPerPage = pageCount > 0 ? totalChars / pageCount : 0;
  const lowTextPages = perPage.filter(
    (p) => p.text.trim().length < TEXT_PAGE_THRESHOLD
  ).length;
  const textCoverage =
    pageCount > 0 ? Math.min(1, (pageCount - lowTextPages) / pageCount) : 0;
  const extractionQuality = Math.min(
    1,
    avgTextPerPage / EXTRACTION_QUALITY_DIVISOR
  );

  return {
    pageCount,
    totalChars,
    avgTextPerPage,
    lowTextPages,
    textCoverage,
    extractionQuality,
  };
}

// Scoring heuristik — sinyal scan/native tanpa butuh LLM.
// Threshold di-tuning nanti pake data nyata (Phase 4 telemetry).
export function calculateOcrScore(profile: DocumentProfile): number {
  let score = 0;
  if (profile.textCoverage < 0.3) score += 40;
  if (profile.avgTextPerPage < 200) score += 20;
  if (profile.lowTextPages > profile.pageCount * 0.5) score += 30;
  if (profile.extractionQuality < 0.4) score += 30;
  return Math.min(score, 100);
}

export function routePdf(profile: DocumentProfile): DocRoute {
  const score = calculateOcrScore(profile);
  if (score < OCR_SCORE_NATIVE) return "native";
  if (score < OCR_SCORE_VISION) return "vision";
  return "ocr";
}

// ─── Render halaman PDF ke gambar (buat vision & OCR) ───────────
export type RenderedPdfPage = { pageNumber: number; data: Uint8Array };

// Hasil resolve PDF setelah di-route — vision → daftar halaman gambar;
// ocr → teks hasil OCR. Di-isi di route /api/chat, dikonsumsi buildUserContentParts.
export type ResolvedPdf = {
  filename: string;
  route: Exclude<DocRoute, "native">;
  pageCount?: number;
  pages: RenderedPdfPage[];
  ocrText?: string;
  ocrConfidence?: number;
};

export async function renderPdfPages(
  data: Uint8Array,
  opts: { maxPages: number; desiredWidth?: number }
): Promise<RenderedPdfPage[]> {
  // pdf-parse TRANSFER data ke worker thread (detach) → copy dulu biar
  // data asli (yang nanti disimpan/dipakai lagi) tetap utuh
  const copy = new Uint8Array(data);
  const parser = new PDFParse({ data: copy });
  try {
    const result = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      first: opts.maxPages,
      desiredWidth: opts.desiredWidth ?? getVisionPdfDesiredWidth(),
    });
    return result.pages.map((p) => ({
      pageNumber: p.pageNumber,
      data: p.data,
    }));
  } finally {
    await parser.destroy();
  }
}
