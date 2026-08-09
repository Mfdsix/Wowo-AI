"use client";

import { useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { Send, Square, X, CornerUpLeft, Paperclip } from "lucide-react";
import FileTypeIcon from "./FileTypeIcon";
import type { ReplyTarget } from "@/lib/types";

// File yang lagi menunggu dikirim (belum di-persist)
export type PendingFile = {
  id: string;
  file: File;
};

type MessageInputProps = {
  input: string;
  isLoading: boolean;
  sessionId: string | null;
  pendingFiles: PendingFile[];
  onInputChange: (value: string) => void;
  onAddFiles: (fileList: FileList | File[]) => void;
  onRemoveFile: (id: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  replyTarget?: ReplyTarget | null;
  onClearReply?: () => void;
};

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
};

export default function MessageInput({
  input,
  isLoading,
  sessionId,
  pendingFiles,
  onInputChange,
  onAddFiles,
  onRemoveFile,
  onSubmit,
  onStop,
  replyTarget,
  onClearReply,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = send (tanpa Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
    }
    // Reset biar file yang sama bisa di-attach lagi
    e.target.value = "";
  };

  const canSend = !isLoading && sessionId && (input.trim() !== "" || pendingFiles.length > 0);
  const disabled = !sessionId || isLoading;

  const preview = (text: string) => {
    const clean = text.replace(/[#*`>_~]/g, "").trim();
    return clean.length > 60 ? clean.slice(0, 60) + "..." : clean;
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* Reply quote banner */}
        {replyTarget && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 py-2">
            <CornerUpLeft size={14} className="text-zinc-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-zinc-500">
                {replyTarget.quoteText ? "Quoted text" : "Replying to question"}
              </p>
              <p className="text-sm text-zinc-300 line-clamp-2">
                {preview(replyTarget.quoteText || replyTarget.content)}
              </p>
            </div>
            <button
              onClick={onClearReply}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700
                         transition-colors duration-150 shrink-0"
              title="Cancel reply"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Pending files chips — file yang bakal dikirim */}
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                <FileTypeIcon
                  mimeType={f.file.type || "application/octet-stream"}
                  size={16}
                  className="shrink-0 text-zinc-400"
                />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-300 truncate max-w-[140px]">{f.file.name}</p>
                  <p className="text-[10px] text-zinc-500">{formatSize(f.file.size)}</p>
                </div>
                <button
                  onClick={() => onRemoveFile(f.id)}
                  className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700
                             transition-colors duration-150 shrink-0"
                  title="Remove file"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sessionId
                ? "Type a message... (Shift+Enter for new line, or attach a file)"
                : "Create or select a chat first"
            }
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-zinc-700
                       bg-zinc-800 px-4 py-3 pr-24 text-sm text-zinc-100
                       placeholder-zinc-500
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-150"
          />

          <div className="absolute right-2 bottom-2 flex gap-1">
            {/* Attach file */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors duration-150"
              title="Attach file (gambar, PDF, DOCX, teks/kode)"
            >
              <Paperclip size={16} />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.docx,.txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.css,.html,.htm,.xml,.yml,.yaml,.toml,.sh,.bash,.csv,.log,.sql,.svg"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-500
                           text-white transition-colors duration-150"
                title="Stop generating"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                           text-white disabled:bg-zinc-700 disabled:text-zinc-500
                           transition-colors duration-150"
                title="Send message"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </form>

        <p className="text-xs text-zinc-600 text-center mt-2">
          AI responses may not be accurate. Verify important information.
        </p>
      </div>
    </div>
  );
}
