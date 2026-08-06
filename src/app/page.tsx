"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import ChatArea from "@/components/ChatArea";
import MessageInput, { type PendingFile } from "@/components/MessageInput";
import type { Message, ReplyTarget, AttachmentMeta } from "@/lib/types";

type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

// Client-side caps — mirror caps di src/lib/attachments.ts
const MAX_CLIENT_FILES = 10;
const MAX_CLIENT_BYTES = 10 * 1024 * 1024; // 10 MB

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
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

  // ─── File attachment ────────────────────────────────────────
  const handleAddFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setPendingFiles((prev) => {
      const room = Math.max(0, MAX_CLIENT_FILES - prev.length);
      const oversized = incoming.filter((f) => f.size > MAX_CLIENT_BYTES);
      if (oversized.length > 0) {
        console.warn(
          `Lewati file >${MAX_CLIENT_BYTES / 1024 / 1024}MB:`,
          oversized.map((f) => f.name)
        );
      }
      const toAdd = incoming.filter((f) => f.size <= MAX_CLIENT_BYTES).slice(0, room);

      const items: PendingFile[] = toAdd.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      }));
      return [...prev, ...items];
    });
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const clearPendingFiles = useCallback(() => {
    setPendingFiles((prev) => {
      prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  // ─── Send message ───────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && pendingFiles.length === 0) || !activeSessionId || isLoading) return;

    const userContent = trimmed;
    // Capture reply reference & files sebelum di-clear
    const activeReply = replyTarget;
    const files = pendingFiles;
    setInput("");
    setReplyTarget(null);
    clearPendingFiles();

    // 1. Add user message to UI immediately
    const tempUserMsg: Message = {
      id: `temp-${crypto.randomUUID()}`,
      role: "user",
      content: userContent,
      replyToId: activeReply?.id || null,
      quoteText: activeReply?.quoteText || null,
      attachments: [],
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    // 2. Save user message to DB
    const savedUserMsg = await saveMessage(
      activeSessionId,
      "user",
      userContent,
      undefined,
      activeReply?.id || null,
      activeReply?.quoteText || null
    );

    // 2b. Upload attachments ke pesan yang barusan disimpan
    let attachmentMeta: AttachmentMeta[] = [];
    if (files.length > 0 && savedUserMsg) {
      try {
        const upForm = new FormData();
        files.forEach((f) => upForm.append("files", f.file));
        const upRes = await fetch(
          `/api/sessions/${activeSessionId}/messages/${savedUserMsg.id}/attachments`,
          { method: "POST", body: upForm }
        );
        if (upRes.ok) {
          attachmentMeta = (await upRes.json()) as AttachmentMeta[];
        } else {
          console.error("Upload attachments failed:", upRes.status);
        }
      } catch (err) {
        console.error("Upload attachments error:", err);
      }
    }

    // 2c. Swap temp → persisted (regenerate butuh message id real)
    if (savedUserMsg) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempUserMsg.id
            ? { ...savedUserMsg, attachments: attachmentMeta }
            : m
        )
      );
    }

    // 3. Auto-title: set session title from first user message
    const currentMessages = messages.filter((m) => !m.id.startsWith("temp-"));
    if (currentMessages.length === 0) {
      updateSessionTitle(activeSessionId, userContent);
    }

    // 4. Stream response from LLM
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const chatForm = new FormData();
      chatForm.append(
        "messages",
        JSON.stringify([
          ...messages.filter((m) => !m.id.startsWith("temp-")),
          { role: "user", content: userContent },
        ])
      );
      // Kasih tau AI bahwa user mereferensi pertanyaan/teks sebelumnya
      // Quote → pake teks yang di-highlight; Reply → pake isi pesan
      if (activeReply) {
        chatForm.append(
          "replyTo",
          JSON.stringify({
            id: activeReply.id,
            content: activeReply.quoteText || activeReply.content,
          })
        );
      }
      files.forEach((f) => chatForm.append("files", f.file));

      const res = await fetch("/api/chat", {
        method: "POST",
        body: chatForm,
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
        const modelName = res.headers.get("x-llm-model") || undefined;
        await saveMessage(activeSessionId, "assistant", assistantContent, modelName);
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
  }, [input, activeSessionId, isLoading, messages, replyTarget, pendingFiles, clearPendingFiles, saveMessage, updateSessionTitle, fetchSessions]);

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

    // Pesan user terakhir dari state (untuk re-attach files saat regenerate)
    const lastUserMsg: Message | null =
      [...messages].reverse().find((m) => m.role === "user") ?? null;

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
      const chatForm = new FormData();
      chatForm.append(
        "messages",
        JSON.stringify([...historyForApi, { role: "user", content: lastUserContent }])
      );

      // Re-attach files dari pesan user terakhir (fetch bytes on-demand)
      if (lastUserMsg?.attachments?.length) {
        await Promise.all(
          lastUserMsg.attachments.map(async (att) => {
            try {
              const dataRes = await fetch(
                `/api/sessions/${activeSessionId}/attachments/${att.id}/data`
              );
              if (!dataRes.ok) return;
              const blob = await dataRes.blob();
              chatForm.append("files", new File([blob], att.filename, { type: att.mimeType }));
            } catch (err) {
              console.error("Fetch attachment data error:", err);
            }
          })
        );
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        body: chatForm,
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
          pendingFiles={pendingFiles}
          onAddFiles={handleAddFiles}
          onRemoveFile={handleRemoveFile}
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
