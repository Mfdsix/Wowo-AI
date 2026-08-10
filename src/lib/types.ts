// Shared client types — dipake page.tsx, ChatArea, dan komponen lain.
// (sebelumnya duplikat verbatim di beberapa file)

export type AttachmentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  // Document Router (cuma PDF): jalur yang dipake buat baca dokumen ini.
  route?: "native" | "vision" | "ocr";
  // Document Intelligence pipeline (RAG): status index dokumen besar.
  status?: "pending" | "extracting" | "ocr" | "indexing" | "ready" | "failed";
  progress?: number; // 0..100
  error?: string | null;
  chunkCount?: number; // jumlah DocChunk hasil index (buat tampilan "Siap · N chunk")
  pageCount?: number; // max pageEnd chunk — halaman terakhir yang ke-index
};

// Sumber retrieval — halaman dokumen yang dipake AI buat jawab (header x-retrieval-sources)
export type RetrievalSource = {
  filename: string;
  pages: string; // bentuk manusia: "3-15" atau "3, 5-7"
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  bookmarked?: boolean;
  replyToId?: string | null;
  quoteText?: string | null;
  attachments?: AttachmentMeta[];
  createdAt?: string;
  // Sumber RAG yang dipake buat jawab — dikirim via header, gak di-persist ke DB
  sources?: RetrievalSource[];
};

// Target referensi buat reply/quote
export type ReplyTarget = {
  id: string;
  content: string;
  role?: string;
  quoteText?: string;
};
