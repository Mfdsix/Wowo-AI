"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LayoutDashboard, MessagesSquare } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import ChatArea from "@/components/ChatArea";
import MessageInput, { type PendingFile } from "@/components/MessageInput";
import type { Message, ReplyTarget, AttachmentMeta, RetrievalSource } from "@/lib/types";
import DesignerCanvas from "@/components/DesignerCanvas";
import DesignerPrompt from "@/components/DesignerPrompt";

type Session = {
  id: string;
  title: string;
  designStyle?: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

// Client-side caps — mirror caps di src/lib/attachments.ts
const MAX_CLIENT_FILES = 10;
const MAX_CLIENT_BYTES = 10 * 1024 * 1024; // 10 MB

// Parse header x-retrieval-sources (filename + halaman) → undefined kalau kosong/rusak
function parseSources(header: string | null): RetrievalSource[] | undefined {
  if (!header) return undefined;
  try {
    const parsed = JSON.parse(header) as unknown;
    return Array.isArray(parsed) ? (parsed as RetrievalSource[]) : undefined;
  } catch {
    return undefined;
  }
}

type DesignerPage = {
  id: string;
  name: string;
  html: string;
  versions?: { id: string; html: string; updatedAt: string }[];
  createdAt?: string;
  updatedAt?: string;
};

// Deteksi section yang di-mention user dari prompt + keyword di HTML page.
// Kalau gak ketemu, balikin fallback (section terakhir yang aktif) biar
// follow-up kayak "gambarnya nabrak, benerin" otomatis ngarah ke section yang sama.
function detectSection(prompt: string, pageHtml: string, fallback: string | null): string | null {
  const lowerPrompt = prompt.toLowerCase();

  // Kumpulin keyword section dari HTML: class, id, heading
  const keywords = new Set<string>();
  const classIdRegex = /\b(?:class|id)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = classIdRegex.exec(pageHtml))) {
    m[1].split(/\s+/).forEach((w) => {
      const clean = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (clean.length > 2) keywords.add(clean);
    });
  }
  const headingRegex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/g;
  while ((m = headingRegex.exec(pageHtml))) {
    m[1].trim().toLowerCase().split(/\s+/).forEach((w) => {
      const clean = w.replace(/[^a-z0-9]/g, "");
      if (clean.length > 3) keywords.add(clean);
    });
  }

  // Common section names — prioritas tinggi
  const common = [
    "hero", "navbar", "nav", "header", "footer", "banner", "sidebar",
    "about", "testimonial", "gallery", "contact", "features", "feature",
    "pricing", "price", "faq", "cta", "services", "service", "team",
  ];
  for (const k of common) {
    if (lowerPrompt.includes(k)) return k;
  }
  // Keyword dari HTML page
  for (const k of keywords) {
    if (lowerPrompt.includes(k)) return k;
  }
  return fallback;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [viewMode, setViewMode] = useState<"chat" | "designer">("chat");
  const [designerPages, setDesignerPages] = useState<DesignerPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isDesignerLoading, setIsDesignerLoading] = useState(false);
  const [styles, setStyles] = useState<{ slug: string; name: string }[]>([]);
  const [lastAppliedStyle, setLastAppliedStyle] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref ke handleDesignerSubmit biar bisa dipanggil dari handleStyleChange
  // (yang dideklarasi lebih dulu — hindari "used before declaration")
  const designerSubmitRef = useRef<((prompt: string) => Promise<void>) | null>(null);

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

  // Refetch buat UI poll progress index attachment (ChatArea).
  const refreshMessages = useCallback(() => {
    if (activeSessionId) void fetchMessages(activeSessionId);
  }, [activeSessionId, fetchMessages]);

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
  // ─── Update title session (auto-title & rename) ────────────
  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      // Optimistic update
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
      );
      // Persist ke DB
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      } catch (err) {
        console.error("updateSessionTitle error:", err);
      }
    },
    []
  );

  // ─── Rename chat manual (dari sidebar) ──────────────────────
  const handleRenameSession = useCallback(
    async (sessionId: string, title: string) => {
      await updateSessionTitle(sessionId, title);
    },
    [updateSessionTitle]
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
      }));
      return [...prev, ...items];
    });
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clearPendingFiles = useCallback(() => {
    setPendingFiles([]);
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

    // 2. Save user message ke DB, lalu ganti placeholder temp- dengan pesan asli
    // (penting biar history state cuma punya id real — kalau gak, pesan user
    //  selalu ke-filter dan AI kehilangan konteks pertanyaan sebelumnya)
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

    // Ganti placeholder temp- dengan pesan asli (regenerate butuh message id real)
    if (savedUserMsg) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempUserMsg.id
            ? { ...savedUserMsg, attachments: attachmentMeta }
            : m
        )
      );
    }

    // 3. Auto-title: set session title dari pesan user pertama
    const currentMessages = messages.filter(
      (m) =>
        !m.id.startsWith("temp-") &&
        !m.id.startsWith("assist-") &&
        !m.id.startsWith("error-")
    );
    if (currentMessages.length === 0) {
      const autoTitle =
        userContent.slice(0, 40) + (userContent.length > 40 ? "..." : "");
      updateSessionTitle(activeSessionId, autoTitle);
    }

    // 4. Stream response from LLM
    const abortController = new AbortController();
    abortRef.current = abortController;

    // Sumber RAG dari header x-retrieval-sources — di-declare di luar try biar
    // accessible di catch (abort partial) juga.
    let sources: RetrievalSource[] | undefined;

    try {
      const chatForm = new FormData();
      chatForm.append(
        "messages",
        JSON.stringify([
          ...messages.filter(
            (m) =>
              !m.id.startsWith("temp-") &&
              !m.id.startsWith("assist-") &&
              !m.id.startsWith("error-")
          ),
          { role: "user", content: userContent },
        ])
      );
      chatForm.append("sessionId", activeSessionId);
      chatForm.append(
        "designStyle",
        sessions.find((s) => s.id === activeSessionId)?.designStyle ?? ""
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

      // Sumber RAG (dokumen + halaman) yang dipake AI buat jawab
      sources = parseSources(res.headers.get("x-retrieval-sources"));

      // 5. Read streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const assistantId = `assist-${crypto.randomUUID()}`;
      let assistantContent = "";

      // Add placeholder assistant message
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", sources },
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

      // 6. Save assistant message ke DB, ganti placeholder assist- dengan pesan asli
      if (assistantContent) {
        const modelName = res.headers.get("x-llm-model") || undefined;
        const savedAssistantMsg = await saveMessage(
          activeSessionId,
          "assistant",
          assistantContent,
          modelName
        );
        if (savedAssistantMsg) {
          // Pertahankan sources (gak di-persist di DB, cuma di state)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...savedAssistantMsg, sources } : m
            )
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Generation stopped by user");
        // Save partial content & ganti placeholder dengan pesan asli
        const partialMsg = messages.find((m) => m.id.startsWith("assist-"));
        if (partialMsg?.content) {
          const saved = await saveMessage(activeSessionId, "assistant", partialMsg.content);
          if (saved) {
            setMessages((prev) =>
              prev.map((m) => (m.id === partialMsg.id ? { ...saved, sources } : m))
            );
          }
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
  }, [input, activeSessionId, isLoading, messages, replyTarget, pendingFiles, clearPendingFiles, sessions, saveMessage, updateSessionTitle, fetchSessions]);

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

    let sources: RetrievalSource[] | undefined;

    try {
      const chatForm = new FormData();
      chatForm.append(
        "messages",
        JSON.stringify([...historyForApi, { role: "user", content: lastUserContent }])
      );
      chatForm.append("sessionId", activeSessionId);
      chatForm.append(
        "designStyle",
        sessions.find((s) => s.id === activeSessionId)?.designStyle ?? ""
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

      sources = parseSources(res.headers.get("x-retrieval-sources"));

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const assistantId = `assist-${crypto.randomUUID()}`;
      let assistantContent = "";

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", sources }]);

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
  }, [activeSessionId, isLoading, messages, sessions, saveMessage, fetchSessions]);

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

  // Load designer pages pas masuk designer mode / ganti session
  useEffect(() => {
    if (viewMode !== "designer" || !activeSessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${activeSessionId}/designer-pages`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DesignerPage[]) => {
        if (!cancelled) setDesignerPages(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewMode, activeSessionId]);

  // Fetch NeedMCP styles buat style picker (cuma pas masuk designer mode)
  useEffect(() => {
    if (viewMode !== "designer") return;
    let cancelled = false;
    fetch("/api/needmcp/styles")
      .then((r) => (r.ok ? r.json() : { styles: [] }))
      .then((d) => {
        if (!cancelled) setStyles(d.styles ?? []);
      })
      .catch(() => {
        if (!cancelled) setStyles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  // ─── Style picker (NeedMCP) — ONE-SHOT apply ────────────────
  // Ganti style = apply style SEKALI ke page aktif, terus balik ke
  // bawaan wowo.ai buat prompt lanjutan. Style terakhir di-track sbg history.
  const handleStyleChange = useCallback(
    async (slug: string | null) => {
      if (!activeSessionId) return;

      // Case: user pilih "Default" → unlock & hapus history
      if (!slug) {
        setLastAppliedStyle(null);
        try {
          await fetch(`/api/sessions/${activeSessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ designStyle: "" }),
          });
        } catch (err) {
          console.error("handleStyleChange unlock error:", err);
        }
        return;
      }

      // 1. Lock style sementara (biar request apply pake NeedMCP)
      try {
        await fetch(`/api/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designStyle: slug }),
        });
        // Update state biar handleDesignerSubmit kirim designStyle yg bener
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, designStyle: slug } : s
          )
        );
      } catch (err) {
        console.error("handleStyleChange lock error:", err);
      }

      // 2. Auto-apply: prompt AI terapkan style ke page aktif
      const styleName = styles.find((s) => s.slug === slug)?.name || slug;
      const target =
        designerPages.find((p) => p.id === activePageId) ||
        designerPages[designerPages.length - 1];
      if (target) {
        await designerSubmitRef.current?.(
          `Terapkan design style "${styleName}" ke page ini secara konsisten. ` +
            `Pertahankan konten & struktur page, tapi ganti warna, typography, spacing, dan komponen ` +
            `sesuai design system style "${styleName}". Jangan bikin page baru.`
        );
      }

      // 3. Unlock style → prompt lanjutan balik ke bawaan wowo.ai
      try {
        await fetch(`/api/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designStyle: "" }),
        });
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, designStyle: null } : s
          )
        );
      } catch (err) {
        console.error("handleStyleChange unlock error:", err);
      }

      // 4. Catat history style terakhir
      setLastAppliedStyle(slug);
    },
    [activeSessionId, styles, designerPages, activePageId]
  );

  // ─── Designer: rename page ─────────────────────────────────
  const handleRenameDesignerPage = useCallback(
    async (pageId: string, name: string) => {
      if (!activeSessionId) return;
      // Optimistic
      setDesignerPages((prev) =>
        prev.map((p) => (p.id === pageId ? { ...p, name } : p))
      );
      try {
        await fetch(`/api/sessions/${activeSessionId}/designer-pages/${pageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      } catch (err) {
        console.error("handleRenameDesignerPage error:", err);
      }
    },
    [activeSessionId]
  );

  // ─── Designer: delete page ─────────────────────────────────
  const handleDeleteDesignerPage = useCallback(
    async (pageId: string) => {
      if (!activeSessionId) return;
      setDesignerPages((prev) => prev.filter((p) => p.id !== pageId));
      try {
        await fetch(`/api/sessions/${activeSessionId}/designer-pages/${pageId}`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("handleDeleteDesignerPage error:", err);
      }
    },
    [activeSessionId]
  );

  // ─── Designer: revert page ke versi tertentu ──────────────
  const handleRevertPage = useCallback(
    async (pageId: string, versionId: string) => {
      if (!activeSessionId) return;
      try {
        const res = await fetch(
          `/api/sessions/${activeSessionId}/designer-pages/${pageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revertToVersionId: versionId }),
          }
        );
        if (res.ok) {
          const updated: DesignerPage = await res.json();
          setDesignerPages((prev) =>
            prev.map((p) => (p.id === pageId ? updated : p))
          );
        }
      } catch (err) {
        console.error("handleRevertPage error:", err);
      }
    },
    [activeSessionId]
  );

  // ─── Designer: open dari chat (HTML message → jadi page) ──
  const handleOpenInDesigner = useCallback(
    async (content: string) => {
      setViewMode("designer");
      if (!activeSessionId) return;

      const htmlMatch = content.match(/```html\s*([\s\S]*?)```/);
      const html = htmlMatch ? htmlMatch[1].trim() : "";
      if (!html) return;

      try {
        const res = await fetch(`/api/sessions/${activeSessionId}/designer-pages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html }),
        });
        if (res.ok) {
          const page: DesignerPage = await res.json();
          setDesignerPages((prev) => [...prev, page]);
        }
      } catch (err) {
        console.error("handleOpenInDesigner error:", err);
      }
    },
    [activeSessionId]
  );

  // ─── Designer: generate page dari prompt ───────────────────
  const handleDesignerSubmit = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || !activeSessionId || isDesignerLoading) return;

      setIsDesignerLoading(true);
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Tentukan target page.
      // Aturan: default MODIFIKASI page yang lagi aktif/terakhir,
      // KECUALI user eksplisit minta page baru / referensi page lain.
      const lower = trimmed.toLowerCase();
      const wantsNewPage = /tambah\s+page|page\s+baru|bikin\s+page\s+baru|buat\s+page\s+baru|new\s+page|add\s+page|halaman\s+baru/.test(lower);

      let targetPage: DesignerPage | null = null;

      // 1. Referensi eksplisit "page N"
      const numMatch = trimmed.match(/page\s*(\d+)/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (designerPages[idx]) targetPage = designerPages[idx];
      }

      // 2. Referensi nama page
      if (!targetPage && !wantsNewPage) {
        targetPage =
          designerPages.find((p) => lower.includes(p.name.toLowerCase())) || null;
      }

      // 3. Default: page aktif / page terakhir (modifikasi, bukan bikin baru)
      if (!targetPage && !wantsNewPage && designerPages.length > 0) {
        targetPage =
          designerPages.find((p) => p.id === activePageId) ||
          designerPages[designerPages.length - 1];
      }

      // Deteksi section yang di-mention → inget buat follow-up berikutnya
      const nextActiveSection = detectSection(
        trimmed,
        targetPage?.html || "",
        activeSection
      );
      if (nextActiveSection) setActiveSection(nextActiveSection);

      try {
        // Konteks kaya: semua page + HTML-nya + chat history
        // (biar AI paham apa yang lagi ada di canvas & konteks percakapan)
        const recentChat = messages
          .filter((m) => !m.id.startsWith("temp-") && !m.id.startsWith("assist-"))
          .slice(-10)
          .map((m) => `${m.role}: ${m.content.slice(0, 500)}`);

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user" as const, content: trimmed }],
            sessionId: activeSessionId,
            designStyle:
              sessions.find((s) => s.id === activeSessionId)?.designStyle ?? null,
            designer: true,
            designerContext: {
              pages: designerPages.map((p, i) => ({
                number: i + 1,
                name: p.name,
                html: p.html,
              })),
              activePage: targetPage?.name || null,
              activeSection: nextActiveSection || null,
              chatHistory: recentChat,
            },
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
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }

        // Extract HTML dari code block
        const htmlMatch = fullText.match(/```html\s*([\s\S]*?)```/);
        const html = htmlMatch ? htmlMatch[1].trim() : fullText.trim();

        if (!html) throw new Error("AI gak ngasih HTML");

        if (targetPage) {
          // Update page yang di-target
          const res2 = await fetch(
            `/api/sessions/${activeSessionId}/designer-pages/${targetPage.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ html }),
            }
          );
          if (res2.ok) {
            const updated: DesignerPage = await res2.json();
            setDesignerPages((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p))
            );
          }
        } else {
          // Bikin page baru
          const res2 = await fetch(`/api/sessions/${activeSessionId}/designer-pages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html }),
          });
          if (res2.ok) {
            const page: DesignerPage = await res2.json();
            setDesignerPages((prev) => [...prev, page]);
            setActivePageId(page.id);
          }
        }
      } catch (err: unknown) {
        console.error("handleDesignerSubmit error:", err);
      } finally {
        setIsDesignerLoading(false);
        abortRef.current = null;
      }
    },
    [activeSessionId, isDesignerLoading, designerPages, activePageId, activeSection, messages, sessions]
  );

  // Assign ref di dalam effect — React 19 gak boleh nulis ref saat render
  useEffect(() => {
    designerSubmitRef.current = handleDesignerSubmit;
  }, [handleDesignerSubmit]);

  // Designer mode cuma muncul kalau ada UI yang ke-generate di chat
  // (assistant message berisi ```html, atau udah ada designer page)
  const hasGeneratedUI =
    viewMode === "designer" ||
    designerPages.length > 0 ||
    messages.some((m) => m.role === "assistant" && m.content.includes("```html"));

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-900">
      {/* Sidebar cuma di chat mode — designer auto fullscreen */}
      {viewMode === "chat" && (
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isLoading={isSessionsLoading}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* View toggle: Chat | Designer — cuma muncul kalau ada UI yang ke-generate */}
        {hasGeneratedUI && (
        <div className="flex items-center justify-center gap-1 border-b border-zinc-800 bg-zinc-900/95 py-1.5 shrink-0">
          <button
            onClick={() => setViewMode("chat")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === "chat"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
          >
            <MessagesSquare size={14} />
            Chat
          </button>
          <button
            onClick={() => setViewMode("designer")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === "designer"
                ? "bg-indigo-600 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
          >
            <LayoutDashboard size={14} />
            Designer
          </button>
        </div>
        )}

        {viewMode === "chat" ? (
          <>
            <ChatArea
              messages={messages}
              isLoading={isLoading}
              sessionId={activeSessionId}
              onRegenerateAction={handleRegenerate}
              onToggleBookmarkAction={toggleBookmark}
              onReplyAction={handleReply}
              onQuoteAction={handleQuote}
              onOpenInDesignerAction={handleOpenInDesigner}
              onRefreshMessagesAction={refreshMessages}
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
          </>
        ) : (
          <>
            <DesignerCanvas
              pages={designerPages}
              isLoading={isDesignerLoading}
              selectedPageId={activePageId}
              onSelectPage={setActivePageId}
              onRenamePage={handleRenameDesignerPage}
              onDeletePage={handleDeleteDesignerPage}
              onRevertPage={handleRevertPage}
              styles={styles}
              lockedStyle={lastAppliedStyle}
              onStyleChange={handleStyleChange}
            />

            <DesignerPrompt
              onSubmit={handleDesignerSubmit}
              isLoading={isDesignerLoading}
            />
          </>
        )}
      </main>
    </div>
  );
}
