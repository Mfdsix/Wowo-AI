"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download } from "lucide-react";

type WireframePreviewProps = {
  html: string;
  onClose: () => void;
};

export default function WireframePreview({ html, onClose }: WireframePreviewProps) {
  // Escape to close + lock body scroll
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleDownload = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wireframe.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Guard SSR
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(4px)",
        padding: "1.5rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">Wireframe Preview</h3>
          <span className="text-xs text-zinc-500">
            Sandboxed iframe (scripts on, isolated origin)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white
                       transition-colors duration-150"
          >
            <Download size={15} />
            Export HTML
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800
                       transition-colors duration-150"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Preview iframe — allow-scripts buat Tailwind CDN jalan,
          TANPA allow-same-origin biar gak bisa akses cookie/context app utama */}
      <div className="flex-1 bg-white rounded-xl overflow-hidden border border-zinc-700 shadow-2xl">
        <iframe
          title="Wireframe preview"
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full h-full border-0 bg-white"
        />
      </div>

      <p className="text-xs text-zinc-500 mt-3 shrink-0">
        Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Esc</kbd> to close
      </p>
    </div>,
    document.body
  );
}
