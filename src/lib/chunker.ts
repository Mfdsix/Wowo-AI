// ─── Chunker — halaman → potongan teks (chunk) ──────────────────
// Boundary natural: per halaman dulu (biar pageStart/pageEnd akurat
// buat kutip sumber). Halaman yang kepanjangan di-split by size
// dengan overlap. Split by CHARACTER (bukan token) — aman buat CJK
// (PaddleOCR default `ch`), karena jumlah char proporsional ke token.

export type PageText = { num: number; text: string };
export type TextChunk = {
  chunkIndex: number;
  pageStart: number; // 1-based, halaman asal
  pageEnd: number;
  text: string;
};

export const CHUNK_TARGET_CHARS = 1500;
export const CHUNK_OVERLAP = 150;

export function chunkPages(
  pages: PageText[],
  opts?: { targetChars?: number; overlapChars?: number }
): TextChunk[] {
  const target = opts?.targetChars ?? CHUNK_TARGET_CHARS;
  const overlap = opts?.overlapChars ?? CHUNK_OVERLAP;
  const chunks: TextChunk[] = [];
  let index = 0;

  for (const page of pages) {
    const text = page.text ?? "";
    if (text.trim().length === 0) continue;

    if (text.length <= target) {
      chunks.push({
        chunkIndex: index++,
        pageStart: page.num,
        pageEnd: page.num,
        text,
      });
      continue;
    }

    // Halaman panjang → split. overlap < target (default 150 < 1500),
    // jadi start selalu maju (target - overlap), gak mungkin infinite loop.
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + target, text.length);
      chunks.push({
        chunkIndex: index++,
        pageStart: page.num,
        pageEnd: page.num,
        text: text.slice(start, end),
      });
      if (end >= text.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
