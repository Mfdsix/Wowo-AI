"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Bot, User, Copy, Check, X, FileText, RefreshCw, Bookmark, BookmarkCheck, CornerUpLeft, LayoutDashboard, Compass, Sparkles } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import CodeBlock from "./CodeBlock";
import BookmarkPanel from "./BookmarkPanel";
import TextSelectionToolbar from "./TextSelectionToolbar";
import FileTypeIcon from "./FileTypeIcon";
import FilePreviewModal from "./FilePreviewModal";
import type { Message, AttachmentMeta } from "@/lib/types";

// ─── ReactMarkdown component overrides ──────────────────────
const MARKDOWN_COMPONENTS: Components = {
  // Jangan bungkus pake <pre> — biar CodeBlock full kontrol layout
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");

    if (!match) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 text-sm font-mono">
          {children}
        </code>
      );
    }

    return <CodeBlock code={code} language={match[1]} />;
  },
};

type ChatAreaProps = {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
  onRegenerateAction?: () => void;
  onToggleBookmarkAction?: (messageId: string) => void;
  onReplyAction?: (message: Message) => void;
  onQuoteAction?: (text: string, messageId: string) => void;
  onOpenInDesignerAction?: (content: string) => void;
  onRefreshMessagesAction?: () => void; // refetch messages — dipake poll status index
};

// Status Document Intelligence pipeline — chip kecil di attachment
const PROCESSING_STATUSES = ["pending", "extracting", "ocr", "indexing"] as const;
const INDEX_STATUS_LABEL: Record<string, string> = {
  pending: "antri index",
  extracting: "extract teks",
  ocr: "OCR…",
  indexing: "indexing…",
  ready: "ter-index",
  failed: "gagal",
};

function AttachmentIndexChip({ att }: { att: AttachmentMeta }) {
  if (!att.status) return null;

  // Siap → hijau + ringkasan (jumlah halaman / chunk hasil index)
  if (att.status === "ready") {
    const summary = att.pageCount
      ? `Siap · ${att.pageCount} hal`
      : att.chunkCount
        ? `Siap · ${att.chunkCount} chunk`
        : "Siap";
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-emerald-500/20 text-emerald-300"
        title={att.chunkCount ? `${att.chunkCount} chunk ter-index` : "ter-index"}
      >
        <Check size={9} className="text-emerald-300" />
        {summary}
      </span>
    );
  }

  // Gagal → merah + error di tooltip
  if (att.status === "failed") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-300"
        title={att.error ?? "gagal di-index"}
      >
        <X size={9} />
        Gagal
      </span>
    );
  }

  // Processing (pending/extracting/ocr/indexing) → biru + spinner + stage + %
  const label = INDEX_STATUS_LABEL[att.status] ?? att.status;
  const progress =
    typeof att.progress === "number" && att.progress > 0 ? ` ${att.progress}%` : "";
  return (
    <span
      className="inline-flex shrink-0 animate-pulse items-center gap-1 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-sky-500/20 text-sky-300"
      title={`Index dokumen: ${label}`}
    >
      <Loader2 size={9} className="animate-spin" />
      {label}
      {progress}
    </span>
  );
}

export default function ChatArea({ messages, isLoading, sessionId, onRegenerateAction, onToggleBookmarkAction, onReplyAction, onQuoteAction, onOpenInDesignerAction, onRefreshMessagesAction }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeBookmarkId, setActiveBookmarkId] = useState<string | null>(null);
  const [previewAtt, setPreviewAtt] = useState<AttachmentMeta | null>(null);

  // Auto-scroll ke bawah tiap ada pesan baru
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? "instant" : "smooth" });
  }, [messages, isLoading]);

  // Poll status index attachment yang lagi diproses — refetch messages
  // tiap 3 detik selama ada dokumen ke-index (kecuali lagi streaming).
  const hasProcessingAttachment = messages.some(
    (m) =>
      m.attachments?.some((a) =>
        a.status && (PROCESSING_STATUSES as readonly string[]).includes(a.status)
      ) ?? false
  );
  useEffect(() => {
    if (!hasProcessingAttachment || isLoading || !onRefreshMessagesAction) return;
    const t = setInterval(onRefreshMessagesAction, 3000);
    return () => clearInterval(t);
  }, [hasProcessingAttachment, isLoading, onRefreshMessagesAction]);

  // Track bookmark aktif — star yang lagi keliatan di tengah viewport
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateActive = () => {
      const bookmarkedIds = messages
        .filter((m) => m.role === "user" && m.bookmarked)
        .map((m) => m.id);

      if (bookmarkedIds.length === 0) {
        setActiveBookmarkId(null);
        return;
      }

      const viewportCenter = container.getBoundingClientRect().top + container.clientHeight / 2;
      let closestId: string | null = null;
      let closestDist = Infinity;

      for (const id of bookmarkedIds) {
        const el = document.getElementById(`msg-${id}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const dist = Math.abs(elCenter - viewportCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = id;
        }
      }

      setActiveBookmarkId(closestId);
    };

    updateActive();
    container.addEventListener("scroll", updateActive, { passive: true });
    return () => container.removeEventListener("scroll", updateActive);
  }, [messages]);

  // Cari index pesan assistant terakhir (yg bukan error)
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (
        messages[i].role === "assistant" &&
        !messages[i].id.startsWith("error-") &&
        !messages[i].id.startsWith("assist-")
      ) {
        return i;
      }
    }
    return -1;
  })();

  // State: belum pilih session
  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-900">
        <div className="text-center">
          <Bot size={48} className="mx-auto mb-4 text-zinc-600" />
          <h2 className="text-xl font-semibold text-zinc-400 mb-2">
            Select or create a chat
          </h2>
          <p className="text-zinc-600 text-sm">
            Choose a conversation from the sidebar or start a new one
          </p>
        </div>
      </div>
    );
  }

  // State: session dipilih tapi belum ada pesan
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-900 px-4">
        <div className="text-center w-full max-w-md">
          {/* Highlighted Curiosity Engine CTA — persuasive redirect */}
          <Link
            href="/curiosity"
            className="group block mb-7 rounded-2xl border border-amber-500/50 bg-gradient-to-br from-amber-500/20 via-amber-500/5 to-zinc-900 p-5 text-left transition-all hover:border-amber-400 hover:from-amber-500/30 hover:shadow-lg hover:shadow-amber-500/10"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-500/20 p-2.5 ring-1 ring-amber-400/40">
                <Compass size={26} className="text-amber-300" />
              </div>
              <div className="flex-1">
                <p className="flex items-center gap-1.5 text-base font-semibold text-amber-200">
                  <Sparkles size={15} /> Belum menemukan yang kamu cari?
                </p>
                <p className="text-[13px] text-zinc-300 mt-1">
                  Biarkan rasa penasaran yang menemukannya.{" "}
                  <span className="font-semibold text-amber-300 underline-offset-2 group-hover:underline">
                    Coba Curiosity Engine →
                  </span>
                </p>
              </div>
            </div>
          </Link>

          <Bot size={40} className="mx-auto mb-3 text-zinc-600" />
          <h2 className="text-xl font-semibold text-zinc-300 mb-2">
            Mulai mengobrol
          </h2>
          <p className="text-zinc-500 text-sm">
            Kirim pesan untuk memulai percakapan
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto bg-zinc-900">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {messages.map((msg, idx) => {
          // Cari pesan yang di-reply (buat quote)
          const replyToMsg = msg.replyToId
            ? messages.find((m) => m.id === msg.replyToId)
            : undefined;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              replyToContent={replyToMsg?.content}
              isLastAssistant={idx === lastAssistantIdx}
              showRegenerate={idx === lastAssistantIdx && !isLoading && messages.length > 0}
              onRegenerateAction={onRegenerateAction}
              onToggleBookmarkAction={onToggleBookmarkAction}
              onReplyAction={onReplyAction}
              onOpenInDesignerAction={onOpenInDesignerAction}
              onPreviewAttachment={setPreviewAtt}
            />
          );
        })}

        {/* Loading/streaming indicator */}
        {isLoading && (
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <Loader2 size={16} className="text-zinc-400 animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-zinc-500 mb-1">AI is thinking...</p>
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Bookmark floating button + panel */}
      {messages.some((m) => m.role === "user" && m.bookmarked) && (
        <BookmarkPanel
          bookmarks={messages.filter((m) => m.role === "user" && m.bookmarked)}
          activeBookmarkId={activeBookmarkId}
          onJump={(id) => {
            document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      )}

      {/* Text selection toolbar — Copy | Quote */}
      <TextSelectionToolbar onQuoteAction={onQuoteAction} />

      {/* File preview modal — klik attachment chip */}
      {previewAtt && sessionId && (
        <FilePreviewModal
          attachment={previewAtt}
          sessionId={sessionId}
          onClose={() => setPreviewAtt(null)}
        />
      )}
    </div>
  );
}

// ─── Single Message Bubble ────────────────────────────────────

type MessageBubbleProps = {
  message: Message;
  replyToContent?: string;
  isLastAssistant: boolean;
  showRegenerate: boolean;
  onRegenerateAction?: () => void;
  onToggleBookmarkAction?: (messageId: string) => void;
  onReplyAction?: (message: Message) => void;
  onOpenInDesignerAction?: (content: string) => void;
  onPreviewAttachment?: (att: AttachmentMeta) => void;
};

function MessageBubble({ message, replyToContent, showRegenerate, onRegenerateAction, onToggleBookmarkAction, onReplyAction, onOpenInDesignerAction, onPreviewAttachment }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isError = message.id.startsWith("error-");
  const isStreaming = message.id.startsWith("assist-");
  const isBookmarked = message.bookmarked;

  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className={`group relative ${isUser ? "flex justify-end" : ""}`}
    >
      {/* Column wrapper — biar action buttons di BAWAH bubble */}
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      {/* Attachments — icon tipe file, di ATAS bubble */}
      {isUser && message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2 max-w-[85%] px-4 pt-2">
          {message.attachments.map((att) => {
            const isIndexing =
              !!att.status &&
              (PROCESSING_STATUSES as readonly string[]).includes(att.status);
            return (
              <button
                key={att.id}
                type="button"
                onClick={() => onPreviewAttachment?.(att)}
                className="flex flex-col rounded-md bg-white/10 px-2 py-1 text-xs text-white/90 min-w-0
                           hover:bg-white/20 hover:text-white transition-colors duration-150 cursor-pointer"
                title={`${att.filename} (${att.mimeType}) — klik buat preview`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileTypeIcon mimeType={att.mimeType} size={13} className="shrink-0" />
                  <span className="truncate max-w-[160px]">{att.filename}</span>
                  {/* Badge route Document Router — cuma PDF punya route */}
                  {att.route && (
                    <span
                      className={`shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${
                        att.route === "native"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {att.route === "native"
                        ? "native"
                        : att.route === "ocr"
                        ? "ocr"
                        : "scan→vision"}
                    </span>
                  )}
                  {/* Status Document Intelligence pipeline — index dokumen */}
                  {att.status && <AttachmentIndexChip att={att} />}
                </span>
                {/* Progress bar — animasi selagi dokumen ke-index di background */}
                {isIndexing && (
                  <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-sky-400 transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, att.progress ?? 0))}%`,
                      }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div
        className={`flex items-start gap-3 px-4 py-3 max-w-[85%] ${
          isUser ? "flex-row-reverse" : ""
        } ${isError ? "" : isUser ? "" : "bg-zinc-800/30 rounded-xl"}`}
      >
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            isError
              ? "bg-red-900 text-red-300"
              : isUser
              ? "bg-indigo-600 text-white"
              : "bg-zinc-700 text-zinc-300"
          }`}
        >
          {isError ? <Bot size={16} /> : isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-500 mb-1">
            {isError ? "Error" : isUser ? "You" : "AI"}
            {message.model && !isUser && !isError && (
              <span className="ml-2 text-zinc-600">({message.model})</span>
            )}
          </p>

          {/* Quote reference — teks yang di-quote / pesan yang di-reply */}
          {replyToContent && (
            <div
              className={`mb-1.5 rounded-lg border-l-4 px-3 py-2 ${
                isUser
                  ? "border-indigo-400/70 bg-indigo-600/30"
                  : "border-zinc-600 bg-zinc-800/60"
              }`}
            >
              <p className={`text-[11px] mb-0.5 ${isUser ? "text-indigo-200" : "text-zinc-500"}`}>
                <CornerUpLeft size={11} className="inline mr-1 -mt-0.5" />
                {message.quoteText ? "Quoted" : "Replied to"}
              </p>
              <p className={`text-sm line-clamp-3 ${isUser ? "text-white/90" : "text-zinc-400"}`}>
                {(message.quoteText || replyToContent).replace(/[#*`>_~]/g, "").trim()}
              </p>
            </div>
          )}

          <div
            className={`rounded-xl px-4 py-3 ${
              isUser
                ? "bg-indigo-600/80 text-white"
                : isError
                ? "bg-red-900/20 text-red-400"
                : ""
            }`}
          >
            <div className={`prose prose-invert prose-sm max-w-none break-words ${
              isError ? "text-red-400" : isUser ? "text-white" : "text-zinc-200"
            }`}>
              {message.content ? (
                <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
              ) : isStreaming ? (
                <span className="text-zinc-500 italic">...</span>
              ) : (
                <span className="text-zinc-500 italic">(empty)</span>
              )}
            </div>
          </div>

          {/* Sumber RAG — dokumen + halaman yang dipake AI buat jawab */}
          {!isUser && message.sources && message.sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
              {message.sources.map((s, i) => (
                <span
                  key={`${s.filename}-${i}`}
                  className="inline-flex items-center gap-1 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400"
                  title="Sumber retrieval — halaman dokumen yang dipake buat jawab"
                >
                  <FileText size={10} className="shrink-0" />
                  {s.filename} · hal. {s.pages}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons — user messages: bookmark + reply */}
      {isUser && !isStreaming && (
        <div className="flex items-center gap-1 px-4 pb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {/* Bookmark */}
          <button
            onClick={() => onToggleBookmarkAction?.(message.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                       transition-colors duration-150 ${
              isBookmarked
                ? "text-amber-400 hover:text-amber-300"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
            }`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this question"}
          >
            {isBookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            <span>{isBookmarked ? "Bookmarked" : "Bookmark"}</span>
          </button>

          {/* Reply */}
          <button
            onClick={() => onReplyAction?.(message)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                       text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50
                       transition-colors duration-150"
            title="Continue from this question"
          >
            <CornerUpLeft size={14} />
            <span>Reply</span>
          </button>
        </div>
      )}

      {/* Action buttons — assistant messages: copy + open in designer + regenerate */}
      {!isUser && !isStreaming && (
        <div className="flex items-center gap-1 px-4 pb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {/* Open in Designer — kalo message ada code block html */}
          {message.content.includes("```html") && onOpenInDesignerAction && (
            <button
              onClick={() => onOpenInDesignerAction?.(message.content)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                         text-indigo-400 hover:text-indigo-200 hover:bg-indigo-600/20
                         transition-colors duration-150"
              title="Open this HTML in Designer mode"
            >
              <LayoutDashboard size={14} />
              <span>Open in Designer</span>
            </button>
          )}

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                       text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50
                       transition-colors duration-150"
            title="Copy response"
          >
            {copied ? (
              <>
                <Check size={14} className="text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copy</span>
              </>
            )}
          </button>

          {/* Regenerate — cuma di pesan assistant terakhir */}
          {showRegenerate && onRegenerateAction && (
            <button
              onClick={onRegenerateAction}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                         text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50
                         transition-colors duration-150"
              title="Regenerate response"
            >
              <RefreshCw size={14} />
              <span>Regenerate</span>
            </button>
          )}
        </div>
      )}
      </div>
      {/* end column wrapper */}
    </div>
  );
}
