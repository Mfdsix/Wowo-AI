"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles,
  Compass,
  BookOpen,
  HelpCircle,
  Save,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  Shuffle,
  Lightbulb,
  MessagesSquare,
  ScrollText,
  Star,
  BookMarked,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  VolumeX,
} from "lucide-react";
import MarkdownLite from "@/components/MarkdownLite";
import AuthModal from "@/components/AuthModal";

// Suara TTS yang di-allowlist di /api/tts (id-ID). Gadis = wanita, Ardi = pria.
const TTS_VOICE = "id-ID-GadisNeural";

// ─── Persistensi percakapan "Tanya tentang ini" ───────────────────
// Percakapan disimpan di localStorage (key per discoveryId) supaya tidak
// hilang saat reload/hot-reload. (DB migration dilarang, jadi pakai storage lokal.)
type QAPair = { q: string; a: string };
const answersKey = (id: string) => `curiosity:answers:${id}`;
const loadAnswers = (id?: string | null): QAPair[] => {
  if (!id) return [];
  try {
    const raw = localStorage.getItem(answersKey(id));
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.q === "string") : [];
  } catch {
    return [];
  }
};
const saveAnswers = (id: string, items: QAPair[]) => {
  try {
    localStorage.setItem(answersKey(id), JSON.stringify(items));
  } catch {
    /* ignore quota/serialization errors */
  }
};

// ─── TTS button: synthesize teks via /api/tts lalu putar ──────────
function TtsButton({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };

  const toggle = async () => {
    if (playing) {
      stop();
      return;
    }
    setError(null);
    try {
      setLoading(true);
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: TTS_VOICE }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `TTS gagal (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
        audioRef.current = null;
        setError("Gagal memutar audio.");
      };
      await audio.play();
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "TTS gagal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading || !text.trim()}
      title={playing ? "Stop" : "Dengarkan (TTS)"}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors duration-150 disabled:opacity-40"
    >
      {playing ? <VolumeX size={13} /> : <Volume2 size={13} />}
      <span>{loading ? "..." : playing ? "Stop" : "Dengar"}</span>
      {error && <span className="text-red-400 ml-1">{error}</span>}
    </button>
  );
}

// ─── Curiosity Engine — Discovery Card (PRD §17) ─────────────
// UI minimal, discovery-first. Tidak ada sidebar / feed / gamification.

type Discovery = {
  id: string;
  category: string;
  hook: string;
  teaser: string;
  question: string;
  status: string;
};

type Scores = {
  surprise: number;
  curiosity: number;
  credibility: number;
  depthPotential: number;
  composite: number;
  personalNovelty: number;
  finalScore: number;
  flagged: string | null;
  attempts: number;
};

type Level = { level: number; title: string; content: string };
type RabbitQ = { question: string; order: number };

const CATEGORY_LABEL: Record<string, string> = {
  history: "Sejarah",
  science: "Sains",
  technology: "Teknologi",
  "human-behavior": "Perilaku Manusia",
  geography: "Geografi",
  culture: "Budaya",
  "ancient-civilizations": "Peradaban Kuno",
  space: "Luar Angkasa",
  engineering: "Teknik",
  language: "Bahasa",
  economics: "Ekonomi",
  philosophy: "Filsafat",
  nature: "Alam",
  art: "Seni",
  "unexpected-connections": "Koneksi Tak Terduga",
};

const GATEWAY_ERR =
  "LLM gateway error. Cek LLM_BASE_URL, LLM_API_KEY, LLM_MODEL di .env, lalu coba lagi.";

export default function CuriosityPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);

  const [questions, setQuestions] = useState<RabbitQ[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [levels, setLevels] = useState<Record<number, Level>>({});
  const [loadingLevel, setLoadingLevel] = useState<number | null>(null);

  const [saved, setSaved] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);

  // ─── Contextual Ask (§10) ───────────────────────────────────
  const [askInput, setAskInput] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);

  // ─── Auth: butuh kode akses (sama dengan chat) ──────────────
  // Curiosity di-scope per-user (history & simpan), jadi halaman ini juga
  // di-gate: kalau belum punya kode di cookie, tampilkan modal unlock.
  const [code, setCode] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = (await res.json()) as { code: string | null };
        if (data.code) {
          setCode(data.code);
        } else {
          setShowAuthModal(true);
        }
      } catch {
        setShowAuthModal(true);
      }
    })();
  }, []);

  const handleAuthenticated = (c: string) => {
    setCode(c);
    setShowAuthModal(false);
  };

  const reset = () => {
    setDiscovery(null);
    setScores(null);
    setQuestions([]);
    setLevels({});
    setOpenLevel(null);
    setSaved(false);
    setFeedbackGiven(null);
    setError(null);
    setAskInput("");
    setAnswers([]); // percakapan lokal di-clear (sudah ter-persist per id)
  };

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    reset();
    try {
      const res = await fetch("/api/curiosity/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "Curiosity generate error: Gateway HTTP"
            ? GATEWAY_ERR
            : data.error || "Gagal generate."
        );
        return;
      }
      setDiscovery(data.discovery);
      setScores(data.scores);
      setAnswers(loadAnswers(data.discovery.id)); // muat percakapan tersimpan
    } catch {
      setError("Network error. Cek koneksi ke server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const explore = useCallback(async () => {
    if (!discovery) return;
    void fetch(`/api/curiosity/${discovery.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "explore_clicked", level: 1 }),
    });
    setLoadingLevel(1);
    setLoadingQuestions(true);
    try {
      const [lvlRes, qRes] = await Promise.all([
        fetch(`/api/curiosity/${discovery.id}/level`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: 1 }),
        }),
        fetch(`/api/curiosity/${discovery.id}/rabbit-hole`, { method: "POST" }),
      ]);
      const lvl = await lvlRes.json();
      if (lvlRes.ok) setLevels((p) => ({ ...p, 1: lvl }));
      const qs = await qRes.json();
      if (qRes.ok) setQuestions(qs.questions ?? []);
      setOpenLevel(1);
    } catch {
      /* silent */
    } finally {
      setLoadingLevel(null);
      setLoadingQuestions(false);
    }
  }, [discovery]);

  const openDepthLevel = useCallback(
    async (level: number) => {
      if (!discovery) return;
      if (openLevel === level) {
        setOpenLevel(null);
        return;
      }
      setOpenLevel(level);
      if (levels[level]) return;
      setLoadingLevel(level);
      const res = await fetch(`/api/curiosity/${discovery.id}/level`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      const data = await res.json();
      if (res.ok) setLevels((p) => ({ ...p, [level]: data }));
      setLoadingLevel(null);
      if (level > 1) {
        void fetch(`/api/curiosity/${discovery.id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "level_reached", level }),
        });
      }
    },
    [discovery, openLevel, levels]
  );

  const onSave = useCallback(async () => {
    if (!discovery) return;
    await fetch(`/api/curiosity/${discovery.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setSaved(true);
  }, [discovery]);

  const onFeedback = useCallback(
    async (type: "already_knew" | "not_interested" | "didnt_know") => {
      if (!discovery) return;
      await fetch(`/api/curiosity/${discovery.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      setFeedbackGiven(type);
    },
    [discovery]
  );

  // ─── Sumber (§16) ───────────────────────────────────────────
  const [sources, setSources] = useState<
    {
      title: string;
      url?: string | null;
      author?: string | null;
      publishedAt?: string | null;
      type: string;
      trustLevel: string;
      claimStatus: string;
      confidence: number;
      note?: string | null;
    }[]
  >([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const loadSources = useCallback(async () => {
    if (!discovery) return;
    setLoadingSources(true);
    try {
      const res = await fetch(`/api/curiosity/${discovery.id}/sources`);
      const data = await res.json();
      if (res.ok) setSources(data.sources ?? []);
      setShowSources(true);
    } finally {
      setLoadingSources(false);
    }
  }, [discovery]);


  const ask = useCallback(
    async (overrideQ?: string) => {
      const q = (overrideQ ?? askInput).trim();
      if (!discovery || !q || asking) return;
      setAsking(true);
      if (!overrideQ) setAskInput("");
    try {
      const res = await fetch(`/api/curiosity/${discovery.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, priorAnswers: answers.map((x) => x.a) }),
      });
      const data = await res.json();
      const entry =
        !res.ok
          ? { q, a: data.error || "Gagal menjawab." }
          : { q, a: data.answer };
      setAnswers((p) => {
        const next = [...p, entry];
        saveAnswers(discovery.id, next); // persist supaya gak hilang saat reload
        return next;
      });
    } catch {
      setAnswers((p) => {
        const next = [...p, { q, a: "Error jaringan." }];
        saveAnswers(discovery.id, next);
        return next;
      });
    } finally {
      setAsking(false);
    }
  }, [discovery, askInput, asking, answers]);

  // ─── Daily Lubang Kelinci (§14) ────────────────────────────────
  type DailyStep = { topic: string; blurb: string; category: string };
  const [daily, setDaily] = useState<{ title: string; theme: string; steps: DailyStep[] } | null>(null);
  const [loadingDaily, setLoadingDaily] = useState(false);

  const loadDaily = useCallback(async () => {
    setLoadingDaily(true);
    try {
      const res = await fetch("/api/curiosity/daily", { method: "POST" });
      const data = await res.json();
      if (res.ok) setDaily(data);
    } finally {
      setLoadingDaily(false);
    }
  }, []);

  // ─── History & Saves (§12 / §19) ───────────────────────────
  type HistItem = {
    id: string;
    hook: string;
    category: string;
    question: string;
    outcome: string;
    maxDepth: number;
    saved: boolean;
    deliveredAt: string;
  };
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/curiosity/history?saved=1`);
      const data = await res.json();
      if (res.ok) setHistory(data.items ?? []);
      setShowHistory(true);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  return (
    <>
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-2 text-zinc-300">
          <Sparkles size={18} className="text-amber-400" />
          <span className="text-sm font-medium tracking-wide">Curiosity Engine</span>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          <Shuffle size={14} /> Baru
        </button>
      </div>

      <div className="w-full max-w-xl">
        {!discovery && !loading && !error && (
          <div className="text-center py-20">
            <Compass size={40} className="mx-auto text-zinc-600 mb-4" />
            <p className="text-zinc-400 mb-6">
              Sesuatu yang tak kau tahu tapi ingin kau pelajari.
            </p>
            <button
              onClick={generate}
              className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
            >
              Temukan
            </button>
          </div>
        )}

        {loading && (
          <div className="text-center py-20 text-zinc-500">
            <div className="animate-pulse">Mencari sesuatu yang menarik...</div>
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-red-400 mb-4 text-sm">{error}</p>
            <button
              onClick={generate}
              className="px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
            >
              Coba lagi
            </button>
          </div>
        )}

        {discovery && !loading && (
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl">
            <div className="text-[11px] uppercase tracking-widest text-amber-400/80 mb-3">
              {CATEGORY_LABEL[discovery.category] ?? discovery.category}
            </div>

            <h1 className="text-2xl font-semibold leading-snug mb-4">
              {discovery.hook}
            </h1>

            <p className="text-zinc-300 text-[15px] leading-relaxed mb-5">
              {discovery.teaser}
            </p>

            <p className="text-amber-300/90 text-sm italic mb-3">
              {discovery.question}
            </p>

            {scores && (
              <p className="text-[11px] text-zinc-600 mb-6">
                {scores.flagged === "low_credibility"
                  ? "⚠️ Kepercayaan sumber rendah — baca dengan hati-hati."
                  : `Kejutan ${Math.round(scores.surprise * 100)}% · Kredibilitas ${Math.round(
                      scores.credibility * 100
                    )}% · Kebaruan ${Math.round(scores.personalNovelty * 100)}%`}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={explore}
                disabled={loadingLevel === 1}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors disabled:opacity-60"
              >
                Jelajahi <ArrowRight size={16} />
              </button>
              <button
                onClick={onSave}
                disabled={saved}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm disabled:opacity-50"
              >
                <Save size={15} /> {saved ? "Tersimpan" : "Simpan"}
              </button>
              <button
                onClick={generate}
                className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
              >
                Mungkin lainnya
              </button>
            </div>

            <div className="mt-6 space-y-2">
              {[1, 2, 3, 4].map((lv) => {
                const meta = ["", "Konteks", "Mengapa", "Koneksi", "Selami Dalam"][lv];
                const isOpen = openLevel === lv;
                const isLoading = loadingLevel === lv;
                return (
                  <div key={lv} className="rounded-lg border border-zinc-800 overflow-hidden">
                    <button
                      onClick={() => openDepthLevel(lv)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/60"
                    >
                      <BookOpen size={14} className="text-zinc-500" />
                      <span className="font-medium">
                        L{lv} · {meta}
                      </span>
                      {isOpen ? (
                        <span className="ml-auto text-zinc-500 text-xs">▲</span>
                      ) : (
                        <span className="ml-auto text-zinc-600 text-xs">▼</span>
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 text-[14px] leading-relaxed text-zinc-300">
                        {isLoading ? (
                          <span className="text-zinc-500 animate-pulse">Memuat...</span>
                        ) : levels[lv] ? (
                          <MarkdownLite>{levels[lv].content}</MarkdownLite>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {questions.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-500 mb-2">
                  <HelpCircle size={13} /> Lubang Kelinci
                </div>
                <ul className="space-y-1.5">
                  {questions.map((q, i) => (
                    <li
                      key={i}
                      onClick={() => ask(q.question)}
                      className="text-sm text-zinc-300 bg-zinc-800/40 rounded-lg px-3 py-2 cursor-pointer hover:bg-zinc-700/60 transition-colors duration-150"
                      title="Tanya ini di bagian bawah"
                    >
                      {q.question}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loadingQuestions && (
              <div className="mt-3 text-xs text-zinc-500 animate-pulse">
                Mencari jalur untuk dijelajahi...
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center gap-3 text-sm">
              <Lightbulb size={15} className="text-zinc-500" />
              <span className="text-zinc-500">Tahu ini?</span>
              <button
                disabled={!!feedbackGiven}
                onClick={() => onFeedback("didnt_know")}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
              >
                <ThumbsUp size={14} /> Baru bagi saya
              </button>
              <button
                disabled={!!feedbackGiven}
                onClick={() => onFeedback("already_knew")}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
              >
                <ThumbsUp size={14} className="rotate-180" /> Tahu itu
              </button>
              <button
                disabled={!!feedbackGiven}
                onClick={() => onFeedback("not_interested")}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
              >
                <ThumbsDown size={14} /> Bukan untuk saya
              </button>
            </div>

            {/* Sumber & Trust (§16) */}
            <div className="mt-5 pt-4 border-t border-zinc-800">
              <button
                onClick={loadSources}
                disabled={loadingSources || showSources}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                <ScrollText size={14} /> {showSources ? "Sumber" : "Tampilkan sumber & kepercayaan"}
              </button>
              {showSources && (
                <div className="mt-3 space-y-2">
                  {sources.length === 0 && (
                    <p className="text-xs text-zinc-600">No sources recorded.</p>
                  )}
                  {sources.map((s, i) => {
                    const trustColor =
                      s.trustLevel === "high"
                        ? "text-emerald-400"
                        : s.trustLevel === "low"
                        ? "text-red-400"
                        : "text-amber-400";
                    const claimIcon =
                      s.claimStatus === "disputed" ? (
                        <AlertTriangle size={13} className="text-red-400" />
                      ) : s.claimStatus === "interpretation" ? (
                        <HelpCircle size={13} className="text-amber-400" />
                      ) : (
                        <CheckCircle2 size={13} className="text-emerald-400" />
                      );
                    return (
                      <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                        <div className="flex items-start gap-2">
                          {claimIcon}
                          <div className="min-w-0">
                            <a
                              href={s.url || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-zinc-200 font-medium hover:underline"
                            >
                              {s.title}
                            </a>
                            <div className="text-[11px] text-zinc-500 mt-0.5">
                              {[s.author, s.type, s.publishedAt?.slice(0, 4)]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <span className={`ml-auto text-[11px] ${trustColor} whitespace-nowrap`}>
                            {`Kepercayaan ${s.trustLevel}`}
                          </span>
                        </div>
                        <div className="text-[11px] mt-1.5 flex gap-2 text-zinc-500">
                          <span className="capitalize">{s.claimStatus.replace("_", " ")}</span>
                          <span>·</span>
                          <span>{`Kepercayaan ${Math.round(s.confidence * 100)}%`}</span>
                        </div>
                        {s.note && <p className="text-[11px] text-zinc-600 mt-1">{s.note}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Contextual Ask (§10) */}
            <div className="mt-5 pt-4 border-t border-zinc-800">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-500 mb-2">
                <MessagesSquare size={13} /> Tanya tentang ini
              </div>
              <div className="relative flex flex-col">
                <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {answers.map((a, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-zinc-400">
                      <span className="text-zinc-600">Q: </span>
                      {a.q}
                    </p>
                    <div className="mt-1 text-zinc-300">
                      <MarkdownLite>{a.a}</MarkdownLite>
                    </div>
                    <div className="mt-1">
                      <TtsButton text={a.a} />
                    </div>
                  </div>
                ))}
                <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 flex gap-2">
                  <input
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") ask();
                    }}
                    placeholder="Tunggu, mengapa mereka melakukan itu?"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    onClick={() => ask()}
                    disabled={asking || !askInput.trim()}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm disabled:opacity-50"
                  >
                    {asking ? "…" : "Tanya"}
                  </button>
                </div>
                </div>
              </div>
            </div>
          </article>
        )}
      </div>

      {/* Daily Lubang Kelinci (§14) */}
      <div className="w-full max-w-xl mt-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-zinc-300">
            <Star size={16} className="text-amber-400" />
            <span className="text-sm font-medium">Daily Lubang Kelinci</span>
          </div>
          <button
            onClick={loadDaily}
            disabled={loadingDaily}
            className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            {daily ? "Ambil ulang" : "Buat"} {loadingDaily ? "…" : ""}
          </button>
        </div>
        {daily && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="font-semibold text-zinc-100">{daily.title}</h2>
            {daily.theme && (
              <p className="text-xs text-zinc-500 mt-0.5 mb-3">{daily.theme}</p>
            )}
            <ol className="space-y-2 mt-3">
              {daily.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-amber-400 text-sm font-mono mt-0.5">{i + 1}</span>
                  <div>
                    <p className="text-sm text-zinc-200 font-medium">{s.topic}</p>
                    <p className="text-[13px] text-zinc-400">{s.blurb}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* History & Saves (§12 / §19) */}
      <div className="w-full max-w-xl mt-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-zinc-300">
            <BookMarked size={16} className="text-amber-400" />
            <span className="text-sm font-medium">Eksplorasi kamu</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadHistory}
              disabled={loadingHistory}
              className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              {showHistory ? "Segarkan" : "Muat"} {loadingHistory ? "…" : ""}
            </button>
          </div>
        </div>
        {showHistory && (
          <div className="space-y-1.5">
            {history.length === 0 && (
              <p className="text-xs text-zinc-600">
                Belum ada yang kamu simpan. Tekan \u201cBaru\u201d untuk mulai.
              </p>
            )}
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  reset();
                  setDiscovery({
                    id: h.id,
                    category: h.category,
                    hook: h.hook,
                    teaser: "",
                    question: h.question,
                    status: "approved",
                  } as Discovery);
                  setScores(null);
                  setAnswers(loadAnswers(h.id)); // muat percakapan tersimpan
                }}
                className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 hover:bg-zinc-800/60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-amber-400/70">
                    {CATEGORY_LABEL[h.category] ?? h.category}
                  </span>
                </div>
                <p className="text-sm text-zinc-200 truncate">{h.hook}</p>
                <p className="text-[11px] text-zinc-500">
                  d capai L{h.maxDepth} · {h.outcome}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Anti-doomscroll summary (§18) */}
      <div className="w-full max-w-xl mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-center">
        <CheckCircle2 size={22} className="mx-auto text-emerald-400 mb-2" />
        <p className="text-sm text-zinc-300">
          Success isn&apos;t time spent here — it&apos;s what you learned and carried with you.
        </p>
        <button
          onClick={generate}
          className="mt-4 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm"
        >
          Satu hal lagi
        </button>
      </div>


      <p className="mt-10 text-xs text-zinc-600 max-w-xl text-center">
        Tak dioptimalkan untuk waktu layar. Temukan hal menarik, pelajari, lalu jalani hidupmu.
      </p>
    </main>

    {/* Modal unlock (uncoseable) — wajib punya kode sebelum pakai fitur */}
    {showAuthModal && !code && (
      <AuthModal onAuthenticated={(c) => handleAuthenticated(c)} />
    )}
    </>
  );
}

