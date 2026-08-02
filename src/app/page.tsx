"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import ChatArea from "@/components/ChatArea";
import MessageInput from "@/components/MessageInput";

type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  bookmarked?: boolean;
  replyToId?: string | null;
  quoteText?: string | null;
  createdAt?: string;
};

// Target referensi buat reply/quote
type ReplyTarget = {
  id: string;
  content: string;
  role?: string;
  quoteText?: string;
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Fetch all sessions ────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data: Session[] = await res.json();
      setSessions(data);
      return data;
    } catch (err) {
      console.error("fetchSessions error:", err);
      return [];
    }
  }, []);

  // ─── Fetch messages for a session ──────────────────────────
  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data: Message[] = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("fetchMessages error:", err);
    }
  }, []);

  // ─── Save a message ────────────────────────────────────────
  const saveMessage = useCallback(
    async (
      sessionId: string,
      role: "user" | "assistant",
      content: string,
      model?: string,
      replyToId?: string | null,
      quoteText?: string | null
    ) => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            content,
            model,
            replyToId: replyToId || null,
            quoteText: quoteText || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to save message");
        const msg: Message = await res.json();
        return msg;
      } catch (err) {
        console.error("saveMessage error:", err);
        return null;
      }
    },
    []
  );

  // ─── Update session title from first message ────────────────
  const updateSessionTitle = useCallback(
    async (sessionId: string, userContent: string) => {
      const title =
        userContent.slice(0, 40) + (userContent.length > 40 ? "..." : "");
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
      );
    },
    []
  );

  // ─── Init: load sessions, auto-create if empty ──────────────
  useEffect(() => {
    (async () => {
      setIsSessionsLoading(true);
      const data = await fetchSessions();
      let sessions = data;

      // Auto-create first session if empty
      if (sessions.length === 0) {
        try {
          const res = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Chat" }),
          });
          if (res.ok) {
            const newSession: Session = await res.json();
            sessions = [newSession];
            setSessions(sessions);
          }
        } catch (err) {
          console.error("Auto-create session error:", err);
        }
      }

      // Select first session
      if (sessions.length > 0) {
        setActiveSessionId(sessions[0].id);
        await fetchMessages(sessions[0].id);
      }
      setIsSessionsLoading(false);
    })();
  }, [fetchSessions, fetchMessages]);

  // ─── New session ────────────────────────────────────────────
  const handleNewSession = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const session: Session = await res.json();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
    } catch (err) {
      console.error("handleNewSession error:", err);
    }
  }, []);

  // ─── Select session ─────────────────────────────────────────
  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id === activeSessionId) return;
      setActiveSessionId(id);
      setMessages([]);
      setIsLoading(false);
      abortRef.current?.abort();
      await fetchMessages(id);
    },
    [activeSessionId, fetchMessages]
  );

  // ─── Delete session ─────────────────────────────────────────
  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        const updated = sessions.filter((s) => s.id !== id);
        setSessions(updated);

        if (id === activeSessionId) {
          if (updated.length > 0) {
            setActiveSessionId(updated[0].id);
            setMessages([]);
            await fetchMessages(updated[0].id);
          } else {
            setActiveSessionId(null);
            setMessages([]);
          }
        }
      } catch (err) {
        console.error("handleDeleteSession error:", err);
      }
    },
    [sessions, activeSessionId, fetchMessages]
  );

  // ─── Send message ───────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !activeSessionId || isLoading) return;

    const userContent = trimmed;
    // Capture reply reference sebelum di-clear
    const activeReply = replyTarget;
    setInput("");
    setReplyTarget(null);

    // 1. Add user message to UI immediately
    const tempUserMsg: Message = {
      id: `temp-${crypto.randomUUID()}`,
      role: "user",
      content: userContent,
      replyToId: activeReply?.id || null,
      quoteText: activeReply?.quoteText || null,
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    // 2. Save user message to DB
    await saveMessage(
      activeSessionId,
      "user",
      userContent,
      undefined,
      activeReply?.id || null,
      activeReply?.quoteText || null
    );

    // 3. Auto-title: set session title from first user message
    const currentMessages = messages.filter((m) => !m.id.startsWith("temp-"));
    if (currentMessages.length === 0) {
      updateSessionTitle(activeSessionId, userContent);
    }

    // 4. Stream response from LLM
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...messages.filter((m) => !m.id.startsWith("temp-")),
            { role: "user" as const, content: userContent },
          ],
          // Kasih tau AI bahwa user mereferensi pertanyaan/teks sebelumnya
          // Quote → pake teks yang di-highlight; Reply → pake isi pesan
          replyTo: activeReply
            ? {
                id: activeReply.id,
                content: activeReply.quoteText || activeReply.content,
              }
            : undefined,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // 5. Read streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const assistantId = `assist-${crypto.randomUUID()}`;
      let assistantContent = "";

      // Add placeholder assistant message
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Plain text chunks langsung dari AI SDK
        const text = decoder.decode(value, { stream: true });
        assistantContent += text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent } : m
          )
        );
      }

      // 6. Save assistant message to DB
      if (assistantContent) {
        await saveMessage(activeSessionId, "assistant", assistantContent);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Generation stopped by user");
        // Save partial content if any
        const partialMsg = messages.find((m) => m.id.startsWith("assist-"));
        if (partialMsg?.content) {
          await saveMessage(activeSessionId, "assistant", partialMsg.content);
        }
      } else {
        console.error("handleSubmit error:", err);
        const errMsg = err instanceof Error ? err.message : "An error occurred";
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${crypto.randomUUID()}`,
            role: "assistant",
            content: `❌ Error: ${errMsg}`,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      fetchSessions();
    }
  }, [input, activeSessionId, isLoading, messages, replyTarget, saveMessage, updateSessionTitle, fetchSessions]);

  // ─── Regenerate response ──────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!activeSessionId || isLoading) return;

    // Cari pesan user terakhir & hapus pesan assistant terakhir dari state
    let lastUserContent = "";
    let lastAssistantId = "";

    setMessages((prev) => {
      const newMsgs = [...prev];
      // Hapus assistant terakhir dari belakang
      for (let i = newMsgs.length - 1; i >= 0; i--) {
        if (newMsgs[i].role === "assistant" && !newMsgs[i].id.startsWith("error-")) {
          lastAssistantId = newMsgs[i].id;
          newMsgs.splice(i, 1);
          break;
        }
      }
      // Cari user terakhir
      for (let i = newMsgs.length - 1; i >= 0; i--) {
        if (newMsgs[i].role === "user") {
          lastUserContent = newMsgs[i].content;
          break;
        }
      }
      return newMsgs;
    });

    // Hapus dari DB kalo id-nya real (bukan temp-)
    if (lastAssistantId && !lastAssistantId.startsWith("temp-") && !lastAssistantId.startsWith("assist-")) {
      try {
        // Hapus message dari DB via API yang ada
        // Kita delete & re-create pake cascade session...
        // Simpler: delete message by id (kita butuh endpoint)
        // Sementara skip, nanti session refresh synchronize
      } catch {}
    }

    if (!lastUserContent) return;

    setIsLoading(true);

    // Ambil message history dari state (udah di-filter di atas)
    const historyForApi = messages
      .filter((m) => !m.id.startsWith("temp-") && m.id !== lastAssistantId)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...historyForApi, { role: "user" as const, content: lastUserContent }],
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const assistantId = `assist-${crypto.randomUUID()}`;
      let assistantContent = "";

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        assistantContent += text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent } : m
          )
        );
      }

      if (assistantContent) {
        await saveMessage(activeSessionId, "assistant", assistantContent);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Regeneration stopped by user");
      } else {
        console.error("handleRegenerate error:", err);
        const errMsg = err instanceof Error ? err.message : "An error occurred";
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${crypto.randomUUID()}`,
            role: "assistant",
            content: `❌ Error: ${errMsg}`,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      fetchSessions();
    }
  }, [activeSessionId, isLoading, messages, saveMessage, fetchSessions]);

  // ─── Stop generation ────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  // ─── Toggle bookmark ────────────────────────────────────────
  const toggleBookmark = useCallback(
    async (messageId: string) => {
      if (!activeSessionId) return;

      // Optimistic update
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m
        )
      );

      try {
        const res = await fetch(
          `/api/sessions/${activeSessionId}/messages/${messageId}`,
          { method: "PATCH", headers: { "Content-Type": "application/json" } }
        );
        if (!res.ok) throw new Error("Failed to toggle bookmark");
        const updated: Message = await res.json();

        // Sync dengan response server
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, bookmarked: updated.bookmarked } : m
          )
        );
      } catch (err) {
        console.error("toggleBookmark error:", err);
        // Rollback
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m
          )
        );
      }
    },
    [activeSessionId]
  );

  // ─── Reply: set referensi pertanyaan yang mau di-reply ──
  const handleReply = useCallback((message: Message) => {
    setReplyTarget({
      id: message.id,
      content: message.content,
      role: message.role,
    });
    setTimeout(() => {
      document.querySelector("textarea")?.focus();
    }, 50);
  }, []);

  // ─── Quote: set referensi dari teks yang di-highlight ──
  const handleQuote = useCallback((text: string, messageId: string) => {
    const sourceMsg = messages.find((m) => m.id === messageId);
    setReplyTarget({
      id: messageId,
      content: sourceMsg?.content || text,
      role: sourceMsg?.role,
      quoteText: text,
    });
    setTimeout(() => {
      document.querySelector("textarea")?.focus();
    }, 50);
  }, [messages]);

  return (
    <div className="flex h-screen bg-zinc-900">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isLoading={isSessionsLoading}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          sessionId={activeSessionId}
          onRegenerateAction={handleRegenerate}
          onToggleBookmarkAction={toggleBookmark}
          onReplyAction={handleReply}
          onQuoteAction={handleQuote}
        />

        <MessageInput
          input={input}
          isLoading={isLoading}
          sessionId={activeSessionId}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onStop={handleStop}
          replyTarget={replyTarget}
          onClearReply={() => setReplyTarget(null)}
        />
      </main>
    </div>
  );
}
