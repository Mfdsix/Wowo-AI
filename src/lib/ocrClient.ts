// ─── PaddleOCR HTTP client ──────────────────────────────────────
// Client ke services/ocr (FastAPI + PaddleOCR).
// Ngirim halaman PDF yang udah di-render → balik text + confidence + blocks.

export type OcrBlock = {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
};

export type OcrPageResult = {
  page: number;
  text: string;
  confidence: number;
  blocks?: OcrBlock[];
};

export type OcrResult = {
  pages: OcrPageResult[];
};

// Kirim daftar halaman (PNG) ke service OCR. Throw kalau service
// unreachable / error — caller fallback ke vision.
export async function runPaddleOcr(
  images: { pageNumber: number; data: Uint8Array }[],
  baseUrl: string,
  lang = "ch"
): Promise<OcrPageResult[]> {
  const form = new FormData();
  images.forEach((img) => {
    // Salin ke Uint8Array baru (ArrayBuffer-backed) — File/BlobPart butuh
    // ArrayBufferView<ArrayBuffer>, bukan <ArrayBufferLike>
    form.append(
      "files",
      new File([new Uint8Array(img.data)], `page-${img.pageNumber}.png`, {
        type: "image/png",
      })
    );
  });
  form.append("lang", lang);

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}/ocr`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    throw new Error(
      `OCR service unreachable di ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OCR service error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as OcrResult;
  return Array.isArray(data.pages) ? data.pages : [];
}
