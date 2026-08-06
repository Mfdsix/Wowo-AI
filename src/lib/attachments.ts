// ─── Server-side attachment pipeline ───────────────────────────
// Klasifikasi file, ekstraksi teks, build AI SDK parts, & pilih model.
// Routes cuma compose fungsi ini — logic gak nempel di route file.

import { createOpenAI } from "@ai-sdk/openai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// ─── Caps ───────────────────────────────────────────────────────
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_EXTRACTED_CHARS = 100_000; // ~25k token per file

export type FileKind = "image" | "pdf" | "docx" | "text";

// Analisa satu file → apa yang dibutuhin route (bentuk bytes & teks)
export type AnalyzedAttachment = {
  kind: FileKind;
  filename: string;
  mimeType: string;
  size: number;
  data: Uint8Array<ArrayBuffer>; // Prisma Bytes butuh ArrayBuffer-backed
  textContent: string | null; // null untuk image (model vision yang baca langsung)
};

// Bentuk minimal file yang diupload (cocok buat global File di Node runtime)
export type UploadFileLike = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

// Error validation khusus — route tangkap & balikin sebagai 400
export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

// ─── Mime type & klasifikasi ────────────────────────────────────
const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
};

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".js", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".css", ".scss",
  ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".sh", ".bash", ".zsh",
  ".log", ".ini", ".conf", ".sql", ".env", ".graphql", ".prisma", ".svg",
]);

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

// File bisa datang dengan type kosong atau application/octet-stream —
// provider OpenAI lempar kalau mediaType gak valid, jadi normalize dari ekstensi.
export function normalizeMimeType(filename: string, mimeType: string): string {
  const ext = getExtension(filename);
  const fromMap = EXTENSION_TO_MIME[ext];
  const isGeneric =
    !mimeType ||
    mimeType === "application/octet-stream" ||
    mimeType === "binary/octet-stream";
  return isGeneric && fromMap ? fromMap : mimeType;
}

export function detectKind(filename: string, mimeType: string): FileKind | null {
  const norm = normalizeMimeType(filename, mimeType);
  const ext = getExtension(filename);
  if (norm.startsWith("image/")) return "image";
  if (norm === "application/pdf" || ext === ".pdf") return "pdf";
  if (
    norm === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    return "docx";
  }
  if (norm.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}

// ─── Ekstraksi teks ─────────────────────────────────────────────
async function extractPdfText(data: Uint8Array): Promise<string> {
  // Copy dulu — pdf.js TRANSFER buffer ke worker thread (detach),
  // jadi data asli yang mau disimpan ke DB harus tetap utuh
  const copy = new Uint8Array(data);
  const parser = new PDFParse({ data: copy });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(data: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: data });
  return result.value || "";
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…[isi dipotong]…";
}

// Analisa file: cek caps → klasifikasi → ekstrak teks (non-image)
export async function analyzeFile(file: UploadFileLike): Promise<AnalyzedAttachment> {
  const filename = file.name || "file";
  const size = file.size;

  if (size > MAX_FILE_BYTES) {
    throw new AttachmentValidationError(
      `Ukuran file "${filename}" (${(size / 1024 / 1024).toFixed(1)}MB) melebihi batas ${MAX_FILE_BYTES / 1024 / 1024}MB`
    );
  }

  const mimeType = normalizeMimeType(filename, file.type);
  const kind = detectKind(filename, mimeType);
  if (!kind) {
    throw new AttachmentValidationError(
      `Tipe file "${filename}" tidak didukung. Supported: gambar (PNG/JPG/WebP/GIF), PDF, DOCX, TXT/MD/kode`
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());

  let textContent: string | null = null;
  if (kind !== "image") {
    try {
      const raw =
        kind === "pdf"
          ? await extractPdfText(data)
          : kind === "docx"
          ? await extractDocxText(data)
          : decodeText(data);
      textContent = truncateText(raw, MAX_EXTRACTED_CHARS);
    } catch (err) {
      console.error(`Extract text error untuk "${filename}":`, err);
      throw new AttachmentValidationError(
        `Gagal baca isi "${filename}". File mungkin rusak atau formatnya beda.`
      );
    }
  }

  return { kind, filename, mimeType, size, data, textContent };
}

// ─── Build AI SDK parts ─────────────────────────────────────────
// Structural typing — bentuk ini match TextPart & FilePart AI SDK v7.
export type UserContentPart =
  | { type: "text"; text: string }
  | {
      type: "file";
      mediaType: string;
      filename?: string;
      data: { type: "data"; data: Uint8Array | string };
    };

export function buildUserContentParts(input: {
  userText: string;
  replyPrefix?: string;
  attachments: AnalyzedAttachment[];
}): UserContentPart[] {
  const parts: UserContentPart[] = [];

  let text = "";
  if (input.replyPrefix) text += input.replyPrefix;
  text += input.userText;

  // Dokumen & file teks → injected sebagai konteks teks
  const docs = input.attachments.filter((a) => a.kind !== "image" && a.textContent);
  if (docs.length > 0) {
    text +=
      "\n\n" + docs.map((d) => `[Dokumen: ${d.filename}]\n${d.textContent}`).join("\n\n");
  }

  // Skip text part kosong — user yang cuma kirim gambar tanpa teks
  if (text.trim() !== "") parts.push({ type: "text", text });

  // Gambar → FilePart (vision model yang lihat langsung)
  for (const img of input.attachments.filter((a) => a.kind === "image")) {
    parts.push({
      type: "file",
      mediaType: img.mimeType,
      filename: img.filename,
      data: { type: "data", data: img.data },
    });
  }

  return parts;
}

// ─── Pilih model: vision kalau ada gambar, text model untuk biasa ─
export function pickModelConfig(hasImage: boolean):
  | { openai: ReturnType<typeof createOpenAI>; modelName: string }
  | { error: string } {
  if (hasImage) {
    const modelName = process.env.VISION_MODEL?.trim();
    if (!modelName) {
      return {
        error: "VISION_MODEL belum diset di .env. Tambahkan vision model buat fitur gambar.",
      };
    }
    const openai = createOpenAI({
      baseURL: process.env.VISION_BASE_URL || process.env.LLM_BASE_URL || "http://localhost:11434/v1",
      apiKey: process.env.VISION_API_KEY || process.env.LLM_API_KEY || "",
    });
    return { openai, modelName };
  }

  const openai = createOpenAI({
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    apiKey: process.env.LLM_API_KEY || "",
  });
  return { openai, modelName: process.env.LLM_MODEL || "gpt-3.5-turbo" };
}
