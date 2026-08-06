"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  Minus,
  PenLine,
  Trash2,
  Copy,
  Check,
  Move,
  Smartphone,
  Monitor,
  History,
  RotateCcw,
  Palette,
  X,
} from "lucide-react";

type DesignerPage = {
  id: string;
  name: string;
  html: string;
  versions?: { id: string; html: string; updatedAt: string }[];
  createdAt?: string;
  updatedAt?: string;
};

type DesignerCanvasProps = {
  pages: DesignerPage[];
  isLoading?: boolean;
  selectedPageId?: string | null;
  onSelectPage?: (id: string) => void;
  onRenamePage: (id: string, name: string) => void;
  onDeletePage: (id: string) => void;
  onRevertPage?: (pageId: string, versionId: string) => void;
  // NeedMCP style picker
  styles?: { slug: string; name: string }[];
  lockedStyle?: string | null;
  onStyleChange?: (slug: string | null) => void;
};

const ARTBOARD_WIDTHS = { mobile: 375, web: 900 } as const;
const ARTBOARD_HEIGHT = 420;

// Inject script pengukur tinggi ke HTML page (biar artboard auto setinggi isi)
// Hanya post KALO tinggi berubah — hindari spam postMessage & re-render loop
function buildSrcDoc(pageId: string, html: string) {
  const script = `
<script>
window.addEventListener('load', function () {
  var lastH = -1;
  function report() {
    var h = document.documentElement.scrollHeight;
    if (h !== lastH) {
      lastH = h;
      window.parent.postMessage({ type: 'wowo-artboard', id: '${pageId}', height: h }, '*');
    }
  }
  [0, 400, 2000].forEach(function (ms) { setTimeout(report, ms); });
  window.addEventListener('resize', report);
});
<\/script>`;
  // Inject sebelum </head> kalau ada, else di akhir body
  if (html.includes("</head>")) {
    return html.replace("</head>", script + "\n</head>");
  }
  return html + script;
}

// ArtboardFrame — memoize srcDoc biar iframe GAK reload tiap render
// (kalo srcDoc berubah reference, browser reload iframe → script ukur tinggi → setState → loop)
function ArtboardFrame({
  pageId,
  pageName,
  html,
  width,
  height,
}: {
  pageId: string;
  pageName: string;
  html: string;
  width: number;
  height: number;
}) {
  const srcDoc = useMemo(() => buildSrcDoc(pageId, html), [pageId, html]);
  return (
    <iframe
      title={pageName}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="w-full border-0 bg-white"
      style={{
        width,
        height,
        transition: "height 0.2s, width 0.2s",
      }}
    />
  );
}

export default function DesignerCanvas({
  pages,
  isLoading,
  selectedPageId,
  onSelectPage,
  onRenamePage,
  onDeletePage,
  onRevertPage,
  styles,
  lockedStyle,
  onStyleChange,
}: DesignerCanvasProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyPageId, setHistoryPageId] = useState<string | null>(null);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [deviceModes, setDeviceModes] = useState<Record<string, "mobile" | "web">>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Dengerin tinggi dari tiap artboard iframe (via postMessage)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (data && data.type === "wowo-artboard" && data.id) {
        const h = Math.max(Math.round(data.height) || 0, 100);
        setHeights((prev) => (prev[data.id] === h ? prev : { ...prev, [data.id]: h }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const zoomAt = useCallback(
    (newScale: number, cursorX: number, cursorY: number) => {
      setScale((currentScale) => {
        const clamped = Math.min(Math.max(newScale, 0.2), 2.5);
        const container = containerRef.current;
        if (!container) return clamped;
        const rect = container.getBoundingClientRect();
        const cx = cursorX - rect.left;
        const cy = cursorY - rect.top;
        setOffset((prev) => ({
          x: cx - ((cx - prev.x) * clamped) / currentScale,
          y: cy - ((cy - prev.y) * clamped) / currentScale,
        }));
        return clamped;
      });
    },
    []
  );

  // Pan on drag
  const handleMouseDown = (e: React.MouseEvent) => {
    // Hanya pan kalo klik background (bukan artboard)
    if ((e.target as HTMLElement).closest("[data-artboard]")) return;
    setPanning(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!panning) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
  };

  const handleMouseUp = () => setPanning(false);

  const handleWheel = (e: React.WheelEvent) => {
    // Cmd/Ctrl + wheel = zoom, else = pan (gak scroll halaman)
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      zoomAt(scale * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
    } else {
      setOffset((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  const startRename = (page: DesignerPage) => {
    setEditingId(page.id);
    setEditName(page.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      onRenamePage(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleCopyPage = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    try {
      await navigator.clipboard.writeText(page.html);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative overflow-hidden bg-zinc-950 select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: panning ? "grabbing" : "default" }}
    >
      {/* ─── Toolbar (top-right) ─────────────────────────── */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/90 backdrop-blur-sm px-1.5 py-1 shadow-lg">
        <button
          onClick={() => zoomAt(scale * 1.2, window.innerWidth / 2, window.innerHeight / 2)}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => zoomAt(scale / 1.2, window.innerWidth / 2, window.innerHeight / 2)}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="px-2 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>

        <div className="w-px h-4 bg-zinc-700 mx-0.5" />

        {/* NeedMCP style — tombol "Ganti Style" + info style aktif */}
        {styles && styles.length > 0 && (
          <>
            <button
              onClick={() => setShowStyleModal(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium
                         text-indigo-300 hover:text-indigo-100 hover:bg-zinc-800 transition-colors"
              title="Ganti design style"
            >
              <Palette size={12} />
              {lockedStyle ? `Style: ${lockedStyle}` : "Ganti Style"}
            </button>
          </>
        )}

        <div className="w-px h-4 bg-zinc-700 mx-0.5" />

        {/* Global device toggle — semua page */}
        <div className="flex items-center gap-0.5 rounded-md bg-zinc-800 p-0.5">
          <button
            onClick={() => {
              const all: Record<string, "mobile" | "web"> = {};
              pages.forEach((p) => (all[p.id] = "mobile"));
              setDeviceModes(all);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                       text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
            title="Switch all to Mobile"
          >
            <Smartphone size={12} />
          </button>
          <button
            onClick={() => {
              const all: Record<string, "mobile" | "web"> = {};
              pages.forEach((p) => (all[p.id] = "web"));
              setDeviceModes(all);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                       text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
            title="Switch all to Web"
          >
            <Monitor size={12} />
          </button>
        </div>
      </div>

      {/* ─── Canvas content (transformed) ───────────────── */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {/* Dot grid background */}
        <div className="absolute inset-[-4000px]"
          style={{
            backgroundImage: "radial-gradient(circle, #3f3f46 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            opacity: 0.6,
          }}
        />

        {pages.length === 0 ? (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <Move size={40} className="mx-auto mb-3 text-zinc-700" />
            <p className="text-zinc-500 text-sm mb-1">Canvas kosong</p>
            <p className="text-zinc-600 text-xs">
              Ketik prompt di bawah buat generate page
            </p>
          </div>
        ) : (
          <div
            className="flex flex-wrap gap-6 p-8"
            style={{ width: "max-content" }}
          >
            {pages.map((page, i) => {
              const isSelected = page.id === selectedPageId;
              const device = deviceModes[page.id] || "web";
              const width = ARTBOARD_WIDTHS[device];
              return (
              <div
                key={page.id}
                data-artboard
                onClick={() => onSelectPage?.(page.id)}
                className={`group/artboard relative cursor-pointer ${
                  isSelected ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-zinc-950 rounded-lg" : ""
                }`}
              >
                {/* Device toggle bar */}
                <div className="mb-1.5 flex items-center justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeviceModes((prev) => ({ ...prev, [page.id]: "mobile" }));
                      // Tinggi otomatis re-measure via resize listener di iframe
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      device === "mobile"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                    }`}
                    title="Mobile view (375px)"
                  >
                    <Smartphone size={11} />
                    Mobile
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeviceModes((prev) => ({ ...prev, [page.id]: "web" }));
                      // Tinggi otomatis re-measure via resize listener di iframe
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      device === "web"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                    }`}
                    title="Web view (900px)"
                  >
                    <Monitor size={11} />
                    Web
                  </button>
                </div>

                {/* Artboard frame — tinggi auto-sync setinggi isi page */}
                <div className="bg-white rounded-lg shadow-xl overflow-hidden border border-zinc-600 group-hover/artboard:border-indigo-500 transition-colors">
                  <ArtboardFrame
                    pageId={page.id}
                    pageName={page.name}
                    html={page.html}
                    width={width}
                    height={heights[page.id] || ARTBOARD_HEIGHT}
                  />
                </div>

                {/* Page number badge */}
                <span className="absolute top-9 left-2 px-1.5 py-0.5 rounded bg-zinc-900/80 text-[10px] font-mono text-zinc-300">
                  {i + 1}
                </span>

                {/* Hover actions */}
                <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover/artboard:opacity-100 transition-opacity">
                  <button
                    onClick={() => startRename(page)}
                    className="p-1.5 rounded-md bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800"
                    title="Rename"
                  >
                    <PenLine size={13} />
                  </button>
                  <button
                    onClick={() => onDeletePage(page.id)}
                    className="p-1.5 rounded-md bg-zinc-900/80 text-zinc-300 hover:text-red-400 hover:bg-zinc-800"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => handleCopyPage(page.id)}
                    className="p-1.5 rounded-md bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800"
                    title="Copy HTML"
                  >
                    {copiedId === page.id ? (
                      <Check size={13} className="text-green-400" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoryPageId(historyPageId === page.id ? null : page.id);
                    }}
                    className="p-1.5 rounded-md bg-zinc-900/80 text-zinc-300 hover:text-amber-400 hover:bg-zinc-800"
                    title="Version history"
                  >
                    <History size={13} />
                  </button>
                </div>

                {/* Version history popover — selalu muncul, ada empty state */}
                {historyPageId === page.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-10 right-0 z-30 w-56 max-h-64 overflow-y-auto rounded-lg
                               border border-zinc-700 bg-zinc-900 shadow-2xl p-2 space-y-1"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500 px-1 mb-1">
                      Version history
                    </p>
                    {!page.versions || page.versions.length === 0 ? (
                      <p className="text-xs text-zinc-500 px-2 py-3 text-center leading-relaxed">
                        Belum ada versi tersimpan.
                        <br />
                        Update page dulu biar terekam.
                      </p>
                    ) : (
                      page.versions.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => onRevertPage?.(page.id, v.id)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-md
                                     text-xs text-zinc-300 hover:text-white hover:bg-zinc-800
                                     transition-colors"
                          title="Revert to this version"
                        >
                          <span className="truncate">
                            {new Date(v.updatedAt).toLocaleString()}
                          </span>
                          <RotateCcw size={12} className="text-amber-400 shrink-0 ml-2" />
                        </button>
                      ))
                    )}
                  </div>
                )}

                {/* Name label */}
                <div className="mt-2 px-1 text-center">
                  {editingId === page.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full text-center text-xs bg-zinc-800 text-zinc-100 rounded px-2 py-1 outline-none border border-indigo-500"
                    />
                  ) : (
                    <p className="text-xs text-zinc-400 truncate">
                      {page.name}
                      <Minus size={9} className="inline ml-1 -mt-0.5 text-zinc-600" />
                    </p>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Loading overlay — feedback pas generate */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-sm text-zinc-300 font-medium">Sedang membuat design...</p>
          </div>
        </div>
      )}

      {/* ─── Ganti Style modal ─────────────────────────────── */}
      {showStyleModal && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStyleModal(false);
          }}
        >
          <div className="w-80 max-h-[70vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <Palette size={15} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Ganti Style</h3>
              </div>
              <button
                onClick={() => setShowStyleModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Info style aktif */}
            <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-800/40">
              <p className="text-[11px] text-zinc-500">
                Style aktif:{" "}
                <span className="text-indigo-300 font-medium">
                  {lockedStyle ? lockedStyle : "Default (bawaan wowo.ai)"}
                </span>
              </p>
            </div>

            {/* List style */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                onClick={() => {
                  onStyleChange?.(null); // Default → unlock
                  setShowStyleModal(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  !lockedStyle
                    ? "bg-indigo-600/20 text-indigo-200"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Default (bawaan wowo.ai)
              </button>
              {(styles || []).map((s) => (
                <button
                  key={s.slug}
                  onClick={() => {
                    onStyleChange?.(s.slug);
                    setShowStyleModal(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    lockedStyle === s.slug
                      ? "bg-indigo-600/20 text-indigo-200"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
