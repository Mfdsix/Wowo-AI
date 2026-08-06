"use client";

import { useState } from "react";
import { MessageSquarePlus, Trash2, MessageSquare, Loader2, PenLine } from "lucide-react";

type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

type SidebarProps = {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
};

export default function Sidebar({
  sessions,
  activeSessionId,
  isLoading,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startRename = (session: Session) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <aside className="w-72 h-screen flex flex-col bg-zinc-950 border-r border-zinc-800">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg
                     bg-zinc-800 hover:bg-zinc-700 text-zinc-200
                     transition-colors duration-150 text-sm font-medium"
        >
          <MessageSquarePlus size={18} />
          New Chat
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="text-zinc-500 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare size={32} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-zinc-500 text-sm">No chats yet</p>
            <p className="text-zinc-600 text-xs mt-1">Start a new conversation</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer
                         transition-colors duration-150 text-sm ${
                activeSessionId === session.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
              onClick={() => onSelectSession(session.id)}
            >
              <MessageSquare size={16} className="shrink-0" />
              {editingId === session.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-zinc-700 text-zinc-100 rounded px-1.5 py-0.5
                             text-sm outline-none border border-indigo-500"
                />
              ) : (
                <span className="flex-1 truncate">{session.title}</span>
              )}
              <span className="text-xs text-zinc-600 shrink-0">
                {session._count?.messages ?? 0}
              </span>
              {editingId !== session.id && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(session);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded
                               hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200
                               transition-all duration-150"
                    title="Rename chat"
                  >
                    <PenLine size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded
                               hover:bg-zinc-700 text-zinc-500 hover:text-red-400
                               transition-all duration-150"
                    title="Delete chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800">
        <p className="text-xs text-zinc-600 text-center">wowo.ai</p>
      </div>
    </aside>
  );
}
