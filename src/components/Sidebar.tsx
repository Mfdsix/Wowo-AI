"use client";

import { MessageSquarePlus, Trash2, MessageSquare, Loader2 } from "lucide-react";

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
};

export default function Sidebar({
  sessions,
  activeSessionId,
  isLoading,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: SidebarProps) {
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
          // Loading state
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="text-zinc-500 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          // Empty state
          <div className="text-center py-8 px-4">
            <MessageSquare
              size={32}
              className="mx-auto mb-2 text-zinc-600"
            />
            <p className="text-zinc-500 text-sm">No chats yet</p>
            <p className="text-zinc-600 text-xs mt-1">
              Start a new conversation
            </p>
          </div>
        ) : (
          // Session list
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
              <span className="flex-1 truncate">{session.title}</span>
              <span className="text-xs text-zinc-600 shrink-0">
                {session._count?.messages ?? 0}
              </span>
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
