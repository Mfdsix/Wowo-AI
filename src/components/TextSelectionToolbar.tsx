"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, TextQuote } from "lucide-react";

type ToolbarState = {
  x: number;
  y: number;
  text: string;
  messageId: string;
};

type TextSelectionToolbarProps = {
  onQuoteAction?: (text: string, messageId: string) => void;
};

export default function TextSelectionToolbar({ onQuoteAction }: TextSelectionToolbarProps) {
  const [state, setState] = useState<ToolbarState | null>(null);
  const [copied, setCopied] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Detect text selection
  useEffect(() => {
    const handleSelection = () => {
      // Kalo lagi klik toolbar, jangan update
      if (toolbarRef.current?.contains(document.activeElement)) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setState(null);
        return;
      }

      const text = sel.toString().trim();
      if (!text || text.length === 0) {
        setState(null);
        return;
      }

      // Cari bubble pesan yang mengandung selection
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const el =
        container.nodeType === Node.TEXT_NODE
          ? (container.parentElement as Element)
          : (container as Element);

      const msgEl = el?.closest?.("[data-message-id]");
      if (!msgEl) {
        setState(null);
        return;
      }

      // Posisi toolbar di atas selection
      const rect = range.getBoundingClientRect();
      const toolbarWidth = 170;
      let x = rect.left + rect.width / 2;
      // Jangan sampai kelewat kanan viewport
      x = Math.min(Math.max(x, toolbarWidth / 2 + 8), window.innerWidth - toolbarWidth / 2 - 8);

      setState({
        x,
        y: rect.top,
        text,
        messageId: msgEl.getAttribute("data-message-id")!,
      });
    };

    const clearSelection = () => {
      // Hide kalo klik di luar toolbar
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        setState(null);
      }, 10);
    };

    document.addEventListener("selectionchange", handleSelection);
    document.addEventListener("mousedown", clearSelection);
    return () => {
      document.removeEventListener("selectionchange", handleSelection);
      document.removeEventListener("mousedown", clearSelection);
    };
  }, []);

  const handleCopy = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.text);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!state) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-zinc-700
                 bg-zinc-800/95 backdrop-blur-sm shadow-xl px-1 py-1"
      style={{
        left: state.x,
        top: state.y,
        transform: "translate(-50%, -100%)",
      }}
      onMouseDown={(e) => e.preventDefault()} // biar selection gak hilang
    >
      {/* Copy */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                   text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700
                   transition-colors duration-150"
      >
        {copied ? (
          <>
            <Check size={13} className="text-green-400" />
            <span className="text-green-400">Copied</span>
          </>
        ) : (
          <>
            <Copy size={13} />
            <span>Copy</span>
          </>
        )}
      </button>

      <div className="w-px h-4 bg-zinc-700 mx-0.5" />

      {/* Quote */}
      <button
        onClick={() => {
          if (!state) return;
          onQuoteAction?.(state.text, state.messageId);
          // Clear selection biar toolbar ilang
          window.getSelection()?.removeAllRanges();
          setState(null);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                   text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700
                   transition-colors duration-150"
      >
        <TextQuote size={13} />
        <span>Quote</span>
      </button>
    </div>
  );
}
