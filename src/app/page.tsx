"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LayoutDashboard, MessagesSquare, Mic } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import ChatArea from "@/components/ChatArea";
import MessageInput, { type PendingFile } from "@/components/MessageInput";
import type { Message, ReplyTarget, AttachmentMeta, RetrievalSource } from "@/lib/types";
import DesignerCanvas from "@/components/DesignerCanvas";
import DesignerPrompt from "@/components/DesignerPrompt";
import PodcastArea from "@/components/PodcastArea";
import {
  DEFAULT_PODCAST_CONFIG,
  PODCAST_HISTORY_LIMIT,
  speakerAt,
  sanitizeForTts,
  voiceFor,
  cleanTurnText,
  isInstructionEcho,
  type Speaker,
  type PodcastConfig,
} from "@/lib/podcast";

type Session = {
  id: string;
  title: string;
  designStyle?: string | null;
  mode?: string;
  podcastConfig?: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

// Pecah teks jadi kalimat untuk TTS chunked.
const SENTENCE_RE = /[.!?…]+[\s\n]+|[.!?…]+$/;

// Chunk audio di channel: kind=chunk ada audio, kind=end sentinel akhir turn,
// kind=failed TTS gagal (skip tanpa hentikan turn).
type ChannelItem =
  | { kind: "chunk"; url: string }
  | { kind: "end" }
  | { kind: "failed" };

type SpawnedTurn = {
  turnIndex: number;
  speaker: Speaker;
  tempId: string;
  isTopBubble: boolean;
  abort: AbortController;
  finalize: () => Promise<Message | null>;
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
  const [viewMode, setViewMode] = useState<"chat" | "designer" | "podcast">("chat");
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

  // ─── Podcast mode state ────────────────────────────────────────
  const [podcastStatus, setPodcastStatus] = useState<"idle" | "running" | "stopped">("idle");
  const [podcastTurnCount, setPodcastTurnCount] = useState(0);
  const [podcastConfig, setPodcastConfig] = useState<PodcastConfig>(DEFAULT_PODCAST_CONFIG);
  const [podcastActiveSpeaker, setPodcastActiveSpeaker] = useState<Speaker | null>(null);
  const [podcastStreamingId, setPodcastStreamingId] = useState<string | null>(null);
  const [podcastPlayingId, setPodcastPlayingId] = useState<string | null>(null);
  const [podcastLoadingId, setPodcastLoadingId] = useState<string | null>(null);
  const [podcastNeedsGesture, setPodcastNeedsGesture] = useState(false);
  const [podcastNoteInput, setPodcastNoteInput] = useState("");
  const [podcastReplaying, setPodcastReplaying] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  // Refs: source of truth buat loop async biar gak kena stale-closure.
  // Status/turnCount/config dibaca dari sini, state cuma buat render.
  const podcastStateRef = useRef({
    status: "idle" as "idle" | "running" | "stopped",
    turnCount: 0,
    config: DEFAULT_PODCAST_CONFIG,
  });
  // Ref ke fungsi loop — biar rekursi podcastNextTurn gak kena "accessed before declared"
  const podcastNextTurnRef = useRef<(() => Promise<void>) | null>(null);
  const podcastPendingNotesRef = useRef<string[]>([]);
  const podcastTurnAbortRef = useRef<AbortController | null>(null);
  const podcastStopRequestedRef = useRef(false);
  const podcastAudioRef = useRef<HTMLAudioElement | null>(null);
  // resolve dari turn yang lagi main — dipanggil pas pause/stop biar await gak nge-gantung.
  const podcastAudioResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const pendingAudioRef = useRef<{ url: string; resolve: (ok: boolean) => void } | null>(null);
  const podcastConfigRef = useRef<PodcastConfig>(DEFAULT_PODCAST_CONFIG);
  const podcastMessagesRef = useRef<Message[]>([]);
  const podcastSessionIdRef = useRef<string | null>(null);
  const podcastTopicRef = useRef<string>("");
  useEffect(() => { podcastMessagesRef.current = messages; }, [messages]);
  useEffect(() => { podcastSessionIdRef.current = activeSessionId; }, [activeSessionId]);

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
      podcastMessagesRef.current = data;
      podcastTopicRef.current = data.find((m) => m.role === "user")?.content ?? "";
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
      quoteText?: string | null,
      speaker?: string | null
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
            speaker: speaker || null,
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
    // Kalau session yang aktif sekarang udah kosong (0 messages), tinggal pake session ini aja.
    if (activeSessionId && messages.length === 0) {
      return;
    }
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
      podcastSessionIdRef.current = session.id;
      setMessages([]);
      podcastMessagesRef.current = [];
      podcastTopicRef.current = "";
    } catch (err) {
      console.error("handleNewSession error:", err);
    }
  }, [activeSessionId, messages.length]);

  // ─── Podcast pipeline refs & helpers ─────────────────────────────────
  const turnsCommittedRef = useRef(0);       // turn yang udah commit (persisted atau temp bubble)
  const spawnCursorRef = useRef(0);          // index turn yang akan di-spawn berikutnya
  const parallelTextsRef = useRef<Record<number, { speaker: Speaker; content: string }>>({});
  const channelRef = useRef<{
    queue: ((turn: number, item: ChannelItem) => void)[];
    buf: { turn: number; item: ChannelItem }[];
  }>({ queue: [], buf: [] });
  const spawnedTurnsRef = useRef<Record<number, SpawnedTurn>>({});
  const nextTurnEnqueuedRef = useRef(false); // guard: spawn N+1 jangan dobel
  const ensureNextTurnSpawnedRef = useRef<((afterTurn: number) => void) | null>(null);
  const channelPush = useCallback((turn: number, item: ChannelItem) => {
    const c = channelRef.current;
    if (c.queue.length) { c.queue.shift()!(turn, item); return; }
    c.buf.push({ turn, item });
  }, []);
  const channelTake = useCallback((expectedTurn: number) =>
    new Promise<{ turn: number; item: ChannelItem }>((resolve) => {
      const c = channelRef.current;
      const i = c.buf.findIndex((b) => b.turn === expectedTurn);
      if (i >= 0) { const e = c.buf.splice(i, 1)[0]; resolve({ turn: e.turn, item: e.item }); return; }
      c.queue.push((turn, item) => resolve({ turn, item }));
    }), []);
  const channelClear = useCallback(() => {
    const c = channelRef.current;
    for (const r of c.queue.splice(0)) r(-1, { kind: "failed" }); // bangunin waiter → batal
    for (const b of c.buf.splice(0)) if (b.item.kind === "chunk") URL.revokeObjectURL(b.item.url);
  }, []);
  const resetPodcastPipeline = useCallback(() => {
    channelClear();
    parallelTextsRef.current = {};
    spawnedTurnsRef.current = {};
    nextTurnEnqueuedRef.current = false;
    spawnCursorRef.current = 0;
    turnsCommittedRef.current = 0;
  }, [channelClear]);

  // Sinkronkan pipeline refs sama transkrip yang udah tersimpan — belum
  // dipakai sebagai hook eksternal, tapi disimpan buat dipakai pipeline.
  const syncPipelineToTranscript = useCallback(() => {
    channelClear();
    parallelTextsRef.current = {};
    spawnedTurnsRef.current = {};
    nextTurnEnqueuedRef.current = false;
    const count = podcastMessagesRef.current.filter(
      (m) =>
        m.role === "assistant" && m.speaker &&
        !m.id.startsWith("temp-") && !m.id.startsWith("assist-") && !m.id.startsWith("error-")
    ).length;
    spawnCursorRef.current = count;
    turnsCommittedRef.current = count;
  }, [channelClear]);

  // ─── Select session ─────────────────────────────────────────
  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id === activeSessionId) return;
      // Stop podcast yang lagi jalan sebelum pindah session
      podcastTurnAbortRef.current?.abort();
      podcastStateRef.current = { ...podcastStateRef.current, status: "stopped" };
      setPodcastStatus("stopped");
      setPodcastStreamingId(null);
      setPodcastPlayingId(null);
      setPodcastLoadingId(null);
      resetPodcastPipeline();

      setActiveSessionId(id);
      podcastSessionIdRef.current = id;
      setMessages([]);
      podcastMessagesRef.current = [];
      podcastTopicRef.current = "";
      setIsLoading(false);
      abortRef.current?.abort();

      // Kalau session podcast → load config + pindah ke view podcast
      const sess = sessions.find((s) => s.id === id);
      if (sess?.mode === "podcast") {
        setViewMode("podcast");
        let cfg = DEFAULT_PODCAST_CONFIG;
        if (sess.podcastConfig) {
          try {
            const parsed = JSON.parse(sess.podcastConfig) as Partial<PodcastConfig>;
            cfg = {
              names: {
                ...DEFAULT_PODCAST_CONFIG.names,
                ...(parsed.names ?? {}),
              },
              maxTurns: parsed.maxTurns ?? DEFAULT_PODCAST_CONFIG.maxTurns,
            };
          } catch {
            // config rusak → default
          }
        }
        podcastConfigRef.current = cfg;
        setPodcastConfig(cfg);
        podcastStateRef.current = { ...podcastStateRef.current, config: cfg };
      }
      await fetchMessages(id);
    },
    [activeSessionId, fetchMessages, sessions, resetPodcastPipeline]
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

  // ─── Podcast mode: orchestrator ────────────────────────────────
  // Semua nilai yang dibaca loop async diambil dari ref biar gak kena stale-closure.
  // State cuma buat render.

  // Play blob audio; resolve pas audio selesai / error. Kalau autoplay diblokir
  // (butuh gesture), pending sampe user klik "lanjut audio".
  const playPodcastAudio = useCallback((url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      podcastAudioRef.current?.pause();
      podcastAudioRef.current = audio;
      podcastAudioResolveRef.current = resolve;
      const finish = (ok: boolean) => {
        URL.revokeObjectURL(url);
        if (podcastAudioRef.current === audio) podcastAudioRef.current = null;
        if (podcastAudioResolveRef.current === resolve) podcastAudioResolveRef.current = null;
        if (pendingAudioRef.current?.url === url) pendingAudioRef.current = null;
        resolve(ok);
      };
      audio.onended = () => {
        setIsAudioPaused(false);
        finish(true);
      };
      audio.onerror = () => {
        setIsAudioPaused(false);
        finish(false);
      };
      const p = audio.play();
      if (p) {
        p.then(() => {
          setIsAudioPaused(false);
          setPodcastNeedsGesture(false);
        }).catch(() => {
          setPodcastNeedsGesture(true);
          pendingAudioRef.current = { url, resolve };
        });
      } else {
        finish(false);
      }
    });
  }, []);

  const resumePodcastAudio = useCallback(() => {
    const pending = pendingAudioRef.current;
    setPodcastNeedsGesture(false);
    if (!pending) return;
    const audio = podcastAudioRef.current;
    if (!audio) {
      pending.resolve(false);
      pendingAudioRef.current = null;
      return;
    }
    audio
      .play()
      .then(() => {
        pendingAudioRef.current = null;
      })
      .catch(() => {
        pending.resolve(false);
        pendingAudioRef.current = null;
      });
  }, []);

  // Toggle pause/play untuk chunk audio yang sedang diputar.
  const togglePausePlayAudio = useCallback(() => {
    const audio = podcastAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => setIsAudioPaused(false))
        .catch(() => {});
    } else {
      audio.pause();
      setIsAudioPaused(true);
    }
  }, []);

  // ─── Chunked TTS helpers ──────────────────────────────────────────
  // SENTENCE_RE dipindah ke level modul (dipakai juga di spawnTurn).

  /** Fire TTS request, return Promise<string|null> (object URL or null on error). */
  const fetchTtsChunk = useCallback(
    async (text: string, speaker: Speaker, signal?: AbortSignal): Promise<string | null> => {
      const clean = sanitizeForTts(text);
      if (!clean) return null;
      const { voice, pitchShift } = voiceFor(speaker);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice, pitchShift }),
          signal,
        });
        if (!res.ok) {
          console.error("[Podcast] TTS chunk failed:", res.status);
          return null;
        }
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      } catch (err) {
        if (signal?.aborted) return null;
        console.error("[Podcast] TTS chunk error:", err);
        return null;
      }
    },
    []
  );

  // Fetch TTS SELURUH konten satu pesan jadi satu blob audio. Dipakai buat
  // "Lanjut dari sini" & replay — pesan BERIKUTNYA di-prefetch selama pesan
  // sekarang diputar, jadi transisi antar-bubble seamless.
  // Return Promise yang resolve URL audio (atau null) — caller yang await
  // tepat sebelum bubble itu mau diputar, jadi fetch jalan paralel dgn playback.
  const prefetchMessageAudio = useCallback(
    async (msg: Message): Promise<string | null> => {
      const speaker = (msg.speaker as Speaker) ?? "host";
      const clean = sanitizeForTts(msg.content);
      if (!clean) return null;
      try {
        const { voice, pitchShift } = voiceFor(speaker);
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice, pitchShift }),
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error("[Podcast] prefetchTts error:", err);
        return null;
      }
    },
    []
  );

  // ─── Orchestrator podcast: lookahead pipeline ─────────────────────────
  // spawnTurn jalanin generate+TTS di background; hasil teks masuk
  // parallelTextsRef, chunk audio masuk channel. Player loop konsumsi
  // channel, konfirmasi teks ke DB, lalu spawn turn berikutnya. Turn yang
  // ke-spawn dipertahanin pas pause → resume instan.
  const spawnTurn = useCallback((turnIndex: number, stick: boolean) => {
    const sessionId = podcastSessionIdRef.current;
    if (!sessionId) return;
    const speaker = speakerAt(turnIndex);
    const tempId = `assist-${crypto.randomUUID()}`;

    // Bangun history dari turn yang udah commit + teks paralel yang udah final
    // (turn yang teksnya kelar tapi audio masih diputar, belum masuk messages).
    // Turn yang SUDAH commit ada di messages DAN di parallelTexts — dedupe by
    // konten biar prompt gak dobel (dobel = prefill makin lambat di turn lanjut).
    const msgs = podcastMessagesRef.current.filter(
      (m) =>
        m.role === "assistant" && m.speaker &&
        !m.id.startsWith("temp-") && !m.id.startsWith("assist-") && !m.id.startsWith("error-")
    );
    const allHistory = msgs.map((m) => ({
      role: "assistant" as const,
      speaker: m.speaker ?? null,
      content: m.content,
    }));
    const ptKeys = Object.keys(parallelTextsRef.current)
      .map(Number)
      .filter((t) => t < turnIndex)
      .sort((a, b) => a - b);
    for (const t of ptKeys) {
      const pt = parallelTextsRef.current[t];
      if (!pt?.content) continue;
      if (allHistory.some((h) => h.speaker === pt.speaker && h.content === pt.content)) continue;
      // Turn yang teksnya udah final tapi belum commit (audio masih muter)
      // HARUS masuk history biar model punya konteks penuh.
      allHistory.push({ role: "assistant", speaker: pt.speaker, content: pt.content });
    }
    // Window terbatas: model cuma butuh beberapa ronde terakhir. Prompt pendek
    // = prefill cepat = transisi antar-turn lebih mulus.
    const history = allHistory.slice(-PODCAST_HISTORY_LIMIT);
    const firstUser = podcastMessagesRef.current.find(
      (m) => m.role === "user" && !m.id.startsWith("temp-")
    );
    const topic = podcastTopicRef.current || (firstUser ? firstUser.content : "");
    const note = podcastPendingNotesRef.current.join("\n");
    podcastPendingNotesRef.current = [];

    // UI: bubble paling bawah nempel ke streaming (bubble streaming DOBEL
    // diperedam lewat gating di bawah).
    let streamBubbleId: string | null = null;
    if (stick || turnIndex === turnsCommittedRef.current) {
      if (turnIndex >= turnsCommittedRef.current) {
        turnsCommittedRef.current = turnIndex + 1;
        setPodcastTurnCount(turnIndex + 1);
        // JANGAN set podcastActiveSpeaker di sini — itu bakal nge-trigger
        // indikator "sedang bicara" padahal AI masih mikir (generating).
        // Speaker aktif di-set di podcastNextTurn saat chunk audio pertama diputar.
      }
      streamBubbleId = tempId;
      setPodcastStreamingId(tempId);
      // Set loading indicator: AI lagi generate teks untuk speaker ini
      setPodcastLoadingId(tempId);
      setMessages((prev) => [
        ...prev,
        { id: tempId, role: "assistant", speaker, content: "", attachments: [] },
      ]);
    }

    const abort = new AbortController();
    podcastTurnAbortRef.current = abort; // abort terbaru — stop/cleanup

    let fullText = "";
    let modelName: string | null = null;

    // Ordered push: request TTS paralel, tapi penayangan ke channel dijaga
    // urutan kalimat via chain. Chunk gagal TTS di-skip (kind=failed) supaya
    // kalimat berikutnya tetap diputar — BUKAN menghentikan turn.
    let pushChain: Promise<void> = Promise.resolve();
    const pushOrdered = (p: Promise<string | null>) => {
      const itemP = p.then((url): ChannelItem => (url ? { kind: "chunk", url } : { kind: "failed" }));
      const itemPromise = itemP.catch((): ChannelItem => ({ kind: "failed" }));
      pushChain = pushChain.then(() => itemPromise).then((item) => { channelPush(turnIndex, item); });
    };

    (async () => {
      let sentenceBuffer = "";
      try {
        const res = await fetch("/api/podcast/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            sessionId,
            speaker,
            topic,
            history,
            note: note || undefined,
            names: podcastConfigRef.current.names,
          }),
        });
      modelName = res.headers.get("x-llm-model");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        sentenceBuffer += chunk;

          let match: RegExpMatchArray | null;
          while ((match = sentenceBuffer.match(SENTENCE_RE)) !== null) {
            const idx = match.index! + match[0].length;
            const sentence = sentenceBuffer.slice(0, idx).trim();
            sentenceBuffer = sentenceBuffer.slice(idx);
            if (!sentence) continue;
            // Skip TTS kalau kalimatnya jelas echo instruksi (model lemah
            // kadang nulis ulang system prompt sebagai "ucapan").
            if (isInstructionEcho(sentence)) continue;
            pushOrdered(fetchTtsChunk(sentence, speaker, abort.signal));
          }

          if (streamBubbleId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamBubbleId
                  ? { ...m, content: cleanTurnText(fullText) }
                  : m
              )
            );
          }
        }
      decoder.decode();

        const remaining = sentenceBuffer.trim();
        if (remaining && !isInstructionEcho(remaining)) {
          pushOrdered(fetchTtsChunk(remaining, speaker, abort.signal));
        }

        // Teks final di-clean dari echo instruksi sebelum dipakai display/simpan.
        parallelTextsRef.current[turnIndex] = {
          speaker,
          content: cleanTurnText(fullText),
        };

        // Lookahead trigger #2: teks turn ini udah final → langsung spawn turn
        // berikutnya, biar generate-nya overlap sama TTS + playback turn ini
        // (konteks turn ini juga udah masuk ke history-nya). Guard di helper
        // cegah dobel spawn — trigger #1 (chunk audio pertama diputar) bisa
        // aja udah duluan manggil.
        ensureNextTurnSpawnedRef.current?.(turnIndex);

        // End marker di-push SETELAH semua chunk chain selesai → nggak mendahului.
        void pushChain.then(() => { channelPush(turnIndex, { kind: "end" }); });
      } catch (err) {
        if (abort.signal.aborted) {
          if (streamBubbleId) {
            setMessages((prev) => prev.filter((m) => m.id !== streamBubbleId));
            setPodcastStreamingId(null);
          }
          void pushChain.then(() => { channelPush(turnIndex, { kind: "end" }); });
          return;
        }
        console.error("podcast turn error:", err);
        fullText += `\n\n_❌ ${err instanceof Error ? err.message : String(err)}_`;
        parallelTextsRef.current[turnIndex] = { speaker, content: fullText };
        if (streamBubbleId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === streamBubbleId ? { ...m, content: fullText } : m))
          );
        }
        void pushChain.then(() => { channelPush(turnIndex, { kind: "end" }); });
      }
    })();

    // Daftarkan ke registry — player loop cukup ngeliat ini, tanpa spawn ulang.
    spawnedTurnsRef.current[turnIndex] = {
      turnIndex, speaker, tempId, isTopBubble: !!streamBubbleId, abort,
      finalize: () => finalize(),
    };

    const finalize = async (): Promise<Message | null> => {
      if (!parallelTextsRef.current[turnIndex]) return null; // belum selesai / abort
      const content = parallelTextsRef.current[turnIndex].content?.trim();
      // Jika konten kosong setelah clean (semua di-filter sebagai echo instruksi),
      // jangan save ke DB — return null biar loop lanjut tanpa stop.
      if (!content) {
        console.warn(`[Podcast] Turn ${turnIndex} (${speaker}): empty content after clean, skipping persist`);
        return null;
      }
      const saved = await saveMessage(sessionId, "assistant", content, modelName ?? undefined, null, null, speaker);
      if (saved) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === streamBubbleId);
          if (exists && streamBubbleId) {
            return prev.map((m) => (m.id === streamBubbleId ? saved : m));
          }
          if (prev.some((m) => m.id === saved.id)) return prev;
          return [...prev, saved];
        });
      }
      return saved;
    };

    // Kembalikan entry registry yang sudah didaftarkan di atas.
    return spawnedTurnsRef.current[turnIndex];
  }, [fetchTtsChunk, channelPush, saveMessage]);

  const podcastNextTurn = useCallback(async () => {
    const sessionId = podcastSessionIdRef.current;
    if (!sessionId) return;
    if (podcastStateRef.current.status !== "running") return;

    // Lookahead: spawn turn berikutnya secepat mungkin. Dua trigger:
    //  #1 chunk audio pertama turn ini mulai diputar (di loop bawah),
    //  #2 teks turn ini SELESAI di-generate (di spawnTurn) — overlap lebih
    //    besar buat model yang lambat, dan konteks turn ini udah masuk.
    // Guard `spawnedTurnsRef` bikin trigger mana pun yang duluan yang jalan.
    ensureNextTurnSpawnedRef.current = (afterTurn: number) => {
      const nextTurn = afterTurn + 1;
      if (podcastStateRef.current.status !== "running") return;
      if (nextTurn >= podcastConfigRef.current.maxTurns) return;
      if (spawnedTurnsRef.current[nextTurn]) return;
      spawnCursorRef.current = Math.max(spawnCursorRef.current, nextTurn);
      spawnTurn(nextTurn, false);
    };

    let turn = spawnCursorRef.current;

    while (true) {
      const s = podcastStateRef.current.status;
      if (s !== "running") return;
      if (turn >= podcastConfigRef.current.maxTurns) {
        podcastStateRef.current = { ...podcastStateRef.current, status: "stopped" };
        setPodcastStatus("stopped");
        setPodcastActiveSpeaker(null);
        resetPodcastPipeline();
        return;
      }

      // Spawn turn ini kalau belum — stick=true → bubble streaming-nempel.
      let spawned: SpawnedTurn | undefined = spawnedTurnsRef.current[turn];
      if (!spawned) {
        spawned = spawnTurn(turn, true) || undefined;
        if (!spawned) return;
      }

      if (spawned.isTopBubble) setPodcastStreamingId(null);

      // Play tiap chunk audio turn ini begitu siap.
      let hasTriggeredNextSpawn = false;
      let firstChunkPlayed = false;
      while (true) {
        const chunk = await channelTake(turn);
        if (chunk.turn !== turn) return; // batal / cleanup
        if (chunk.item.kind === "end") break; // audio turn ini habis

        if (chunk.item.kind === "failed") continue; // skip kalimat gagal

        const s2 = podcastStateRef.current.status;
        if (s2 !== "running") { URL.revokeObjectURL(chunk.item.url); continue; }

        // First chunk: clear loading, set active speaker, start playing
        if (!firstChunkPlayed) {
          firstChunkPlayed = true;
          setPodcastLoadingId(null);
          setPodcastActiveSpeaker(spawned.speaker);
        }
        setPodcastPlayingId(spawned.tempId);

        // SAAT TURN N MULAI MEMUTAR AUDIO: Trigger generate Turn N+1 di background!
        // Trigger #1 dari dua trigger lookahead (yang lain: teks final di spawnTurn).
        if (!hasTriggeredNextSpawn) {
          hasTriggeredNextSpawn = true;
          ensureNextTurnSpawnedRef.current?.(turn);
        }

        await playPodcastAudio(chunk.item.url);
      }
      setPodcastPlayingId(null);
      setPodcastActiveSpeaker(null);

      // Jaga-jaga kalau turn ini tidak punya chunk audio sama sekali
      if (!hasTriggeredNextSpawn) {
        ensureNextTurnSpawnedRef.current?.(turn);
      }

      // Teks final — confirm + persist. Kalau error → stop.
      const finalText = parallelTextsRef.current[turn]?.content ?? "";
      if (finalText.includes("_❌")) {
        podcastStateRef.current = { ...podcastStateRef.current, status: "stopped" };
        setPodcastStatus("stopped");
        setPodcastActiveSpeaker(null);
        resetPodcastPipeline();
        return;
      }
      const saved = await spawned.finalize();
      // finalize return null jika content kosong (di-filter semua echo instruksi).
      // Jangan stop, lanjut ke turn berikutnya.
      if (!saved) {
        console.log(`[Podcast] Turn ${turn} skipped (empty after clean), continuing...`);
      }

      turn += 1;

      if (podcastStateRef.current.status !== "running") return;
    }
  }, [saveMessage, playPodcastAudio, resetPodcastPipeline, channelPush, channelTake, spawnTurn]);
  useEffect(() => {
    podcastNextTurnRef.current = podcastNextTurn;
  }, [podcastNextTurn]);

  // Mulai podcast baru: bikin session mode podcast + simpan topik, lalu jalankan loop.
  const handleStartPodcast = useCallback(
    async (topic: string, config: PodcastConfig) => {
      const trimmed = topic.trim();
      if (!trimmed) return;
      podcastStopRequestedRef.current = false;
      podcastConfigRef.current = config;
      setPodcastConfig(config);
      resetPodcastPipeline();
      turnsCommittedRef.current = 0;
      spawnCursorRef.current = 0;
      podcastTopicRef.current = trimmed;

      try {
        let session: Session;
        const currentSession = sessions.find((s) => s.id === activeSessionId);
        const isCurrentEmpty = messages.length === 0;

        if (currentSession && isCurrentEmpty) {
          // Reuse active empty session instead of creating a duplicate session
          const res = await fetch(`/api/sessions/${activeSessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: trimmed.slice(0, 40),
              mode: "podcast",
              podcastConfig: JSON.stringify(config),
            }),
          });
          if (!res.ok) throw new Error("Failed to update podcast session");
          session = await res.json();
          setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? session : s))
          );
        } else {
          // Create new podcast session
          const res = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: trimmed.slice(0, 40),
              mode: "podcast",
              podcastConfig: JSON.stringify(config),
            }),
          });
          if (!res.ok) throw new Error("Failed to create podcast session");
          session = await res.json();
          setSessions((prev) => [session, ...prev]);
        }

        setActiveSessionId(session.id);
        podcastSessionIdRef.current = session.id;

        setMessages([]);
        podcastMessagesRef.current = [];

        const saved = await saveMessage(session.id, "user", trimmed);
        if (saved) {
          setMessages([saved]);
          podcastMessagesRef.current = [saved];
        }

        podcastStateRef.current = {
          status: "running",
          turnCount: 0,
          config,
        };
        setPodcastStatus("running");
        setPodcastTurnCount(0);
        await podcastNextTurn();
      } catch (err) {
        console.error("handleStartPodcast error:", err);
      }
    },
    [activeSessionId, messages.length, saveMessage, podcastNextTurn, resetPodcastPipeline, sessions]
  );

  // Lanjutkan sesi podcast yang udah ada (dari history).
  
  // Lanjut dari bubble tertentu: baca bubble yang diklik + bubble-bubble di
  // bawahnya yang belum pernah diputar, baru setelah habis → generate giliran
  // baru. NGGAK truncate — kelanjutan yang udah ada tetep dibaca dulu.
  // Prefetch audio pesan BERIKUTNYA selama pesan sekarang diputar (seamless).
  // Putar ulang semua turn on-air dari transkrip — prefetch pesan BERIKUTNYA
  // selama pesan sekarang diputar, jadi transisi antar-bubble seamless.
  const handleReplayPodcast = useCallback(async () => {
    const turns = podcastMessagesRef.current.filter(
      (m) =>
        m.role === "assistant" &&
        m.speaker &&
        !m.id.startsWith("temp-") &&
        !m.id.startsWith("assist-") &&
        !m.id.startsWith("error-")
    );
    podcastStopRequestedRef.current = false;
    setPodcastReplaying(true);
    try {
      let nextPrefetch: Promise<string | null> | null =
        turns.length > 1 ? prefetchMessageAudio(turns[1]) : null;

      for (let i = 0; i < turns.length; i++) {
        if (podcastStopRequestedRef.current) break;
        const msg = turns[i];
        const speaker = (msg.speaker as Speaker) ?? "host";

        const currentPrefetch =
          i === 0
            ? prefetchMessageAudio(msg) // pertama: langsung fetch sendiri
            : (nextPrefetch ?? prefetchMessageAudio(msg)); // lainnya: prefetch sudah jalan

        setPodcastLoadingId(msg.id);

        // Selama menunggu bubble ini siap, mulai prefetch bubble BERIKUTNYA.
        if (i + 1 < turns.length) {
          nextPrefetch = prefetchMessageAudio(turns[i + 1]);
        } else {
          nextPrefetch = null;
        }

        const url = await currentPrefetch;
        setPodcastLoadingId(null);
        if (!url) {
          console.warn("[Podcast] replay: audio null", msg.id);
          continue;
        }
        setPodcastActiveSpeaker(speaker);
        setPodcastPlayingId(msg.id);
        await playPodcastAudio(url);
        setPodcastPlayingId(null);
        setPodcastActiveSpeaker(null);
      }
    } finally {
      setPodcastReplaying(false);
    }
  }, [playPodcastAudio, prefetchMessageAudio]);

  const handleStopPodcast = useCallback(() => {
    podcastStopRequestedRef.current = true;
    podcastStateRef.current = { ...podcastStateRef.current, status: "stopped" };
    setPodcastStatus("stopped");
    podcastTurnAbortRef.current?.abort();
    podcastAudioRef.current?.pause();
    podcastAudioResolveRef.current?.(false);
    podcastAudioResolveRef.current = null;
    const pending = pendingAudioRef.current;
    if (pending) {
      pending.resolve(false);
      pendingAudioRef.current = null;
    }
    setPodcastNeedsGesture(false);
    setPodcastStreamingId(null);
    setPodcastPlayingId(null);
    setPodcastLoadingId(null);
    resetPodcastPipeline();
  }, [resetPodcastPipeline]);

  // Interjeksi (prompter note) — di-persist sebagai pesan user (off-air),
  // lalu dikirim ke giliran berikutnya sebagai note produser.
  const handlePodcastNote = useCallback(async () => {
    const trimmed = podcastNoteInput.trim();
    const sessionId = podcastSessionIdRef.current;
    if (!trimmed || !sessionId) return;
    setPodcastNoteInput("");
    const saved = await saveMessage(sessionId, "user", trimmed);
    if (saved) {
      podcastPendingNotesRef.current.push(saved.content);
      setMessages((prev) => [...prev, saved]);
    }
  }, [podcastNoteInput, saveMessage]);

  // Pastikan loading indicator gak nyangkut kalo stop/pause dipanggil pas
  // audio lagi di-fetch (mis. user klik stop pas strip loading masih tampil).

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

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isPodcastSession = activeSession?.mode === "podcast";

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-900">
      {/* Sidebar di chat & podcast mode — designer auto fullscreen */}
      {viewMode !== "designer" && (
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
        {/* View toggle: Chat | Podcast | Designer */}
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
            onClick={() => setViewMode("podcast")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === "podcast"
                ? "bg-indigo-600 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
          >
            <Mic size={14} />
            Podcast
          </button>
          {hasGeneratedUI && (
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
          )}
        </div>

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
        ) : viewMode === "podcast" ? (
          <PodcastArea
            isPodcastSession={isPodcastSession}
            sessionTitle={activeSession?.title}
            messages={messages}
            podcastConfig={podcastConfig}
            podcastStatus={podcastStatus}
            podcastTurnCount={podcastTurnCount}
            podcastActiveSpeaker={podcastActiveSpeaker}
            podcastStreamingId={podcastStreamingId}
            podcastPlayingId={podcastPlayingId}
            podcastLoadingId={podcastLoadingId}
            podcastNeedsGesture={podcastNeedsGesture}
            podcastNoteInput={podcastNoteInput}
            podcastReplaying={podcastReplaying}
            isAudioPaused={isAudioPaused}
            onTogglePausePlay={togglePausePlayAudio}
            onNoteInputChange={setPodcastNoteInput}
            onSendNote={handlePodcastNote}
            onStart={handleStartPodcast}
            onReplay={handleReplayPodcast}
            onStop={handleStopPodcast}
            onResumeGesture={resumePodcastAudio}
          />
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
