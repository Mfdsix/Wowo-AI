"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, X, MessageSquare, Star, List } from "lucide-react";

type BookmarkItem = {
  id: string;
  content: string;
  createdAt?: string;
};

type BookmarkPanelProps = {
  bookmarks: BookmarkItem[];
  activeBookmarkId?: string | null;
  onJump: (messageId: string) => void;
};

export default function BookmarkPanel({ bookmarks, activeBookmarkId, onJump }: BookmarkPanelProps) {
  const [open, setOpen] = useState(false);

  const preview = (text: string) => {
    const clean = text.replace(/[#*`>_~\[\]()]/g, "").trim();
    return clean.length > 60 ? clean.slice(0, 60) + "..." : clean;
  };

  return (
    <>
      {/* ─── Vertical star rail (right side) ───────────────── */}
      {bookmarks.length > 0 && (
        <div className="fixed right-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1.5">
          {bookmarks.map((bm) => {
            const isActive = bm.id === activeBookmarkId;
            return (
              <button
                key={bm.id}
                onClick={() => onJump(bm.id)}
                className={`w-7 h-7 flex items-center justify-center rounded-full
                           transition-all duration-150 ${
                  isActive
                    ? "text-amber-400 scale-110"
                    : "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
                }`}
                title={preview(bm.content)}
              >
                {/* Inactive: outline star kecil; Active: filled star */}
                <Star
                  size={isActive ? 18 : 14}
                  fill={isActive ? "currentColor" : "none"}
                  strokeWidth={isActive ? 2 : 1.5}
                />
              </button>
            );
          })}

          {/* Expand to list */}
          <button
            onClick={() => setOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-full mt-1.5
                       text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800
                       transition-all duration-150"
            title="Open bookmark list"
          >
            <List size={16} />
          </button>
        </div>
      )}

      {/* ─── Right panel (slide-in) ─────────────────────────── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            className="fixed top-0 right-0 bottom-0 w-80 z-50 flex flex-col
                       bg-zinc-900 border-l border-zinc-700 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <BookmarkCheck size={16} className="text-amber-400" />
                <h3 className="text-sm font-semibold text-zinc-200">
                  Bookmarks
                </h3>
                <span className="text-xs text-zinc-500">
                  ({bookmarks.length})
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200
                           hover:bg-zinc-800 transition-colors duration-150"
              >
                <X size={18} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {bookmarks.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <Bookmark size={28} className="mx-auto mb-2 text-zinc-600" />
                  <p className="text-zinc-500 text-sm">No bookmarks yet</p>
                  <p className="text-zinc-600 text-xs mt-1">
                    Hover a question and click the bookmark icon
                  </p>
                </div>
              ) : (
                bookmarks.map((bm) => (
                  <button
                    key={bm.id}
                    onClick={() => {
                      onJump(bm.id);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg
                               hover:bg-zinc-800 transition-colors duration-150
                               group/item"
                  >
                    <div className="flex items-start gap-2">
                      <MessageSquare
                        size={14}
                        className="text-zinc-500 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-300 line-clamp-3 group-hover/item:text-zinc-100">
                          {preview(bm.content)}
                        </p>
                        {bm.createdAt && (
                          <p className="text-[11px] text-zinc-600 mt-0.5">
                            {new Date(bm.createdAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
