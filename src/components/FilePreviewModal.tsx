"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download, FileQuestion } from "lucide-react";
import FileTypeIcon from "./FileTypeIcon";
import type { AttachmentMeta } from "@/lib/types";

type Props = {
  attachment: AttachmentMeta;
  sessionId: string;
  onClose: () => void;
};

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
};

// Modal preview file — image langsung kelihatan, PDF/teks di-render,
// tipe lain (docx, archive, dll) → info + tombol download.
// Cuma di-render pas ada klik (client-only), jadi guard document doang cukup.
export default function FilePreviewModal({ attachment, sessionId, onClose }: Props) {
  // Escape untuk close + kunci scroll body
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const dataUrl = `/api/sessions/${sessionId}/attachments/${attachment.id}/data`;
  const mime = attachment.mimeType.toLowerCase();
  const isImage = mime.startsWith("image/");
  const isRenderable =
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("xml") ||
    mime.includes("csv");

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
          <FileTypeIcon mimeType={attachment.mimeType} size={16} className="shrink-0 text-zinc-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 truncate">{attachment.filename}</p>
            <p className="text-[11px] text-zinc-500">{formatSize(attachment.size)}</p>
          </div>
          <a
            href={dataUrl}
            download={attachment.filename}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors duration-150"
            title="Download"
          >
            <Download size={16} />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors duration-150"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 bg-zinc-950/50">
          {isImage ? (
            <img
              src={dataUrl}
              alt={attachment.filename}
              className="max-w-full max-h-[60vh] mx-auto object-contain rounded-lg"
            />
          ) : isRenderable ? (
            <iframe
              src={dataUrl}
              title={attachment.filename}
              className="w-full h-[60vh] rounded-lg bg-white"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-[40vh] text-zinc-500">
              <FileQuestion size={40} className="mb-2" />
              <p className="text-sm">Preview gak didukung buat tipe file ini.</p>
              <p className="text-xs text-zinc-600 mt-1">Klik ikon download di atas buat buka filenya.</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
