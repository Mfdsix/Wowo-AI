"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";

type DesignerPromptProps = {
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
};

export default function DesignerPrompt({ onSubmit, isLoading }: DesignerPromptProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [prompt]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt.trim());
      setPrompt("");
    }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm shrink-0">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe the page to generate... e.g. 'Halaman home landing page kafe'"
            rows={1}
            className="w-full resize-none rounded-xl border border-zinc-700
                       bg-zinc-800 px-4 py-3 pr-14 text-sm text-zinc-100
                       placeholder-zinc-500
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                       transition-all duration-150"
          />

          <div className="absolute right-2 bottom-2 flex gap-1">
            {isLoading ? (
              <button
                type="button"
                onClick={() => { /* stop handled by parent */ }}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white
                           transition-colors duration-150"
                title="Generating..."
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                           text-white disabled:bg-zinc-700 disabled:text-zinc-500
                           transition-colors duration-150"
                title="Generate page"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </form>

        <p className="text-xs text-zinc-600 text-center mt-2">
          Pages are generated as separate artboards on the canvas
        </p>
      </div>
    </div>
  );
}
