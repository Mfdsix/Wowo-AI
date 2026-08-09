// Shared client types — dipake page.tsx, ChatArea, dan komponen lain.
// (sebelumnya duplikat verbatim di beberapa file)

export type AttachmentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  // Document Router (cuma PDF): jalur yang dipake buat baca dokumen ini.
  route?: "native" | "vision" | "ocr";
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
};

// Target referensi buat reply/quote
export type ReplyTarget = {
  id: string;
  content: string;
  role?: string;
  quoteText?: string;
};
