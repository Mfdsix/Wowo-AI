"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, ChevronDown, ChevronRight, Maximize, X, FileCode } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  php: "php",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  dart: "dart",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  diff: "diff",
  elixir: "elixir",
  lua: "lua",
  r: "r",
  toml: "toml",
  solidity: "solidity",
};

const PREVIEW_LINES = 6;

type CodeBlockProps = {
  code: string;
  language?: string;
};

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const lang = language ? LANGUAGE_MAP[language.toLowerCase()] || language.toLowerCase() : "text";
  const lineCount = code.split("\n").length;
  const isLong = lineCount > PREVIEW_LINES;

  const displayCode = collapsed && isLong
    ? code.split("\n").slice(0, PREVIEW_LINES).join("\n")
    : code;

  const handleCopy = async (text = code) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: do nothing
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="my-3 rounded-lg border border-zinc-700 overflow-hidden">
        {/* ─── Header: language | fullscreen + copy ─────────────── */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-800 border-b border-zinc-700">
          {/* Language badge */}
          <span className="text-[11px] font-semibold text-zinc-400 font-mono uppercase tracking-wider">
            {language || "code"}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5">
            {/* Fullscreen — [⛶ FULLSCREEN] */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[CodeBlock] FULLSCREEN clicked");
                setShowModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]
                         font-mono font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700
                         transition-colors duration-150"
            >
              <span className="text-zinc-500">[</span>
              <Maximize size={12} />
              <span>FULLSCREEN</span>
              <span className="text-zinc-500">]</span>
            </button>

            {/* Copy — [📋 COPY] */}
            <button
              onClick={() => handleCopy()}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]
                         font-mono font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700
                         transition-colors duration-150"
            >
              {copied ? (
                <>
                  <span className="text-zinc-500">[</span>
                  <Check size={12} className="text-green-400" />
                  <span className="text-green-400">COPIED</span>
                  <span className="text-zinc-500">]</span>
                </>
              ) : (
                <>
                  <span className="text-zinc-500">[</span>
                  <Copy size={12} />
                  <span>COPY</span>
                  <span className="text-zinc-500">]</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ─── Code area ────────────────────────────────────────── */}
        <div className="relative">
          <div
            className="overflow-x-auto overflow-y-auto"
            style={{ maxHeight: collapsed && isLong ? "185px" : "none" }}
          >
            <SyntaxHighlighter
              language={lang}
              style={oneDark}
              customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: "0.85rem",
                lineHeight: "1.55",
                padding: "0.75rem 1rem",
              }}
              showLineNumbers={lineCount > 3}
              wrapLongLines={false}
            >
              {displayCode}
            </SyntaxHighlighter>
          </div>

          {/* Gradient + Show more */}
          {collapsed && isLong && (
            <button
              onClick={() => setCollapsed(false)}
              className="relative w-full flex items-center justify-center gap-1.5 py-2.5
                         bg-gradient-to-b from-transparent via-zinc-900/90 to-zinc-900
                         text-zinc-400 hover:text-zinc-200
                         transition-colors duration-150 text-xs font-medium"
            >
              <ChevronDown size={15} />
              <span>Show more ({lineCount - PREVIEW_LINES} more lines)</span>
            </button>
          )}

          {/* Collapse */}
          {!collapsed && isLong && (
            <button
              onClick={() => setCollapsed(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2
                         bg-zinc-800/40 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200
                         border-t border-zinc-700/50 text-xs font-medium
                         transition-colors duration-150"
            >
              <ChevronRight size="14" />
              <span>Show less</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Fullscreen Modal ─────────────────────────────────── */}
      {showModal && (
        <FullscreenModal
          code={code}
          language={language || "code"}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// ─── Fullscreen Modal (inline biar gak ada import issues) ─────
function FullscreenModal({
  code,
  language,
  onClose,
}: {
  code: string;
  language: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  console.log("[FullscreenModal] RENDERED, language:", language);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Escape to close + lock body scroll
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);

    // Lock body scroll pas modal kebuka
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Guard SSR/hydration — document gak ada di server
  if (typeof document === "undefined") return null;

  // Portal ke <body> biar modal bener2 di luar semua parent
  // (kaga ke-clip sama overflow chat area / <pre> / dsb)
  return createPortal(
    <div
      // Inline styles biar PASTI jalan — gak bergantung Tailwind class generation
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-zinc-900 rounded-xl border border-zinc-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono font-semibold uppercase tracking-wider text-zinc-300">
              {language}
            </span>
            <span className="text-xs text-zinc-500">
              {code.split("\n").length} lines
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                         bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100
                         border border-zinc-700 transition-colors duration-150"
            >
              {copied ? (
                <>
                  <Check size={15} className="text-green-400" />
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={15} />
                  <span>Copy code</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800
                         transition-colors duration-150"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-auto p-2">
          <SyntaxHighlighter
            language={language.toLowerCase()}
            style={oneDark}
            customStyle={{
              margin: 0,
              borderRadius: "0.5rem",
              fontSize: "0.9rem",
              lineHeight: "1.6",
            }}
            showLineNumbers={true}
            wrapLongLines={false}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>,
    document.body
  );
}
