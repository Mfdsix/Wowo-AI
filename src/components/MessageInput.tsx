"use client";

import { useRef, useEffect, KeyboardEvent } from "react";
import { Send, Square, X, CornerUpLeft } from "lucide-react";

type ReplyTarget = {
  id: string;
  content: string;
  role?: string;
  quoteText?: string;
};

type MessageInputProps = {
  input: string;
  isLoading: boolean;
  sessionId: string | null;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  replyTarget?: ReplyTarget | null;
  onClearReply?: () => void;
};

export default function MessageInput({
  input,
  isLoading,
  sessionId,
  onInputChange,
  onSubmit,
  onStop,
  replyTarget,
  onClearReply,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sessionId
                ? "Type a message... (Shift+Enter for new line)"
                : "Create or select a chat first"
            }
            disabled={!sessionId || isLoading}
            rows={1}
            className="w-full resize-none rounded-xl border border-zinc-700
                       bg-zinc-800 px-4 py-3 pr-14 text-sm text-zinc-100
                       placeholder-zinc-500
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-150"
          />

          <div className="absolute right-2 bottom-2 flex gap-1">
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
                disabled={!input.trim() || !sessionId}
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
