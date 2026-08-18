"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  FlaskConical,
  Home,
  BookOpen,
  Save,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  Shuffle,
  Lightbulb,
  MessagesSquare,
  ScrollText,
  BookMarked,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Volume2,
  VolumeX,
  ExternalLink,
} from "lucide-react";
import MarkdownLite from "@/components/MarkdownLite";
import AuthModal from "@/components/AuthModal";

const TTS_VOICE = "id-ID-GadisNeural";

type QAPair = { q: string; a: string };
const answersKey = (id: string) => `journal:answers:${id}`;
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
    /* ignore */
  }
};

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

type Discovery = { id: string; category: string; hook: string; teaser: string; question: string; status: string };
type SourceLink = {
  title: string;
  url: string | null;
  author?: string | null;
  publishedAt?: string | null;
  type?: string | null;
  trustLevel?: string | null;
  claimStatus?: string | null;
  confidence?: number | null;
  note?: string | null;
};
type Level = { level: number; title: string; content: string };
type RabbitQ = { question: string; order: number };

const JOURNAL_FIELD_LABEL: Record<string, string> = {
  cs: "Ilmu Komputer",
  stat: "Statistika",
  physics: "Fisika",
  "q-bio": "Biologi & Life Sciences",
  econ: "Ekonomi",
  math: "Matematika",
};

const GATEWAY_ERR = "LLM gateway error. Cek LLM_BASE_URL, LLM_API_KEY, LLM_MODEL di .env, lalu coba lagi.";

function parseNote(note?: string | null): { doi?: string; citations?: string; pdf?: string } {
  if (!note) return {};
  const doi = note.match(/DOI:\s*([^\s·]+)/)?.[1];
  const citations = note.match(/(\d+)\s*sitasi/)?.[1];
  const pdf = note.match(/PDF:\s*(\S+)/)?.[1];
  return { doi, citations, pdf };
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function JournalPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [questions, setQuestions] = useState<RabbitQ[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [levels, setLevels] = useState<Record<number, Level>>({});
  const [loadingLevel, setLoadingLevel] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [askInput, setAskInput] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [history, setHistory] = useState<Discovery[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = (await res.json()) as { code: string | null };
        if (data.code) setCode(data.code);
        else setShowAuthModal(true);
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
    setSources([]);
    setShowSources(false);
    setLoadingSources(false);
    setQuestions([]);
    setLevels({});
    setOpenLevel(null);
    setSaved(false);
    setFeedbackGiven(null);
    setError(null);
    setAskInput("");
    setAnswers([]);
  };

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    reset();
    try {
      const res = await fetch("/api/journal/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "Journal generate error: Gateway HTTP" ? GATEWAY_ERR : data.error || "Gagal generate."
        );
        return;
      }
      setDiscovery(data.discovery);
      setSources(data.sources ?? []);
      setAnswers(loadAnswers(data.discovery.id));
    } catch {
      setError("Network error. Cek koneksi ke server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    if (!discovery) return;
    setLoadingSources(true);
    try {
      const res = await fetch(`/api/journal/${discovery.id}/sources`);
      const data = await res.json();
      if (res.ok) setSources(data.sources ?? []);
      setShowSources(true);
    } finally {
      setLoadingSources(false);
    }
  }, [discovery]);

  const explore = useCallback(async () => {
    if (!discovery) return;
    void fetch(`/api/journal/${discovery.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "explore_clicked", level: 1 }),
    });
    setLoadingLevel(1);
    setLoadingQuestions(true);
    try {
      const [lvlRes, qRes] = await Promise.all([
        fetch(`/api/journal/${discovery.id}/level`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: 1 }),
        }),
        fetch(`/api/journal/${discovery.id}/rabbit-hole`, { method: "POST" }),
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
      const res = await fetch(`/api/journal/${discovery.id}/level`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      const data = await res.json();
      if (res.ok) setLevels((p) => ({ ...p, [level]: data }));
      setLoadingLevel(null);
      if (level > 1) {
        void fetch(`/api/journal/${discovery.id}/feedback`, {
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
    await fetch(`/api/journal/${discovery.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setSaved(true);
  }, [discovery]);

  const onFeedback = useCallback(
    async (type: "already_knew" | "not_interested" | "didnt_know") => {
      if (!discovery) return;
      await fetch(`/api/journal/${discovery.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      setFeedbackGiven(type);
    },
    [discovery]
  );

  const onAsk = useCallback(async () => {
    if (!discovery || !askInput.trim()) return;
    const q = askInput.trim();
    setAsking(true);
    setAskInput("");
    try {
      const res = await fetch(`/api/journal/${discovery.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, priorAnswers: answers.map((a) => a.a) }),
      });
      const data = await res.json();
      if (res.ok) {
        const next = [...answers, { q, a: data.answer }];
        setAnswers(next);
        saveAnswers(discovery.id, next);
      }
    } finally {
      setAsking(false);
    }
  }, [discovery, askInput, answers]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/journal/history?saved=1`);
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
          <div className="flex items-center gap-3 text-zinc-300">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
              title="Beranda"
            >
              <Home size={16} /> Home
            </Link>
            <div className="flex items-center gap-2">
              <FlaskConical size={18} className="text-sky-400" />
              <span className="text-sm font-medium tracking-wide">Journal Engine</span>
              <span className="text-[10px] uppercase tracking-wider text-sky-400/70 bg-sky-400/10 px-1.5 py-0.5 rounded">
                Peer-reviewed
              </span>
            </div>
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
              <BookOpen size={40} className="mx-auto text-zinc-600 mb-4" />
              <p className="text-zinc-400 mb-6">
                Temukan jurnal ilmiah asli — langsung dari arXiv, Semantic Scholar, & OpenAlex.
              </p>
              <button
                onClick={generate}
                className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold"
              >
                Cari Jurnal
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center py-20 text-zinc-500">
              <div className="animate-pulse">Mencari paper peer-reviewed...</div>
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
              <div className="text-[11px] uppercase tracking-widest text-sky-400/80 mb-3">
                🔬 Jurnal Ilmiah · {JOURNAL_FIELD_LABEL[discovery.category] ?? discovery.category}
              </div>

              <h1 className="text-2xl font-semibold leading-snug mb-4">{discovery.hook}</h1>

              <p className="text-zinc-300 text-[15px] leading-relaxed mb-5">{discovery.teaser}</p>

              <p className="text-sky-300/90 text-sm italic mb-3">{discovery.question}</p>

              {discovery.status === "rejected" && (
                <p className="text-[11px] text-red-400 mb-4">
                  ⚠️ Paper ini gagal verifikasi sumber — baca dengan hati-hati.
                </p>
              )}

              <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                <button
                  onClick={loadSources}
                  disabled={loadingSources || showSources}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                >
                  <ScrollText size={12} /> {showSources ? "Sumber & Kepercayaan" : "Tampilkan sumber & kepercayaan"}
                </button>
                {showSources && (
                  <div className="mt-3 space-y-2">
                    {sources.length === 0 && (
                      <p className="text-xs text-zinc-600">Tidak ada sumber tercatat.</p>
                    )}
                    {sources.map((s, i) => {
                      const { doi, citations, pdf } = parseNote(s.note);
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
                                {[s.author, doi ? `DOI: ${doi}` : null, citations ? `${citations} sitasi` : null, s.publishedAt?.slice(0, 4)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px]">
                                {s.url && (
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                                  >
                                    <ExternalLink size={11} /> Buka paper
                                  </a>
                                )}
                                {pdf && (
                                  <a
                                    href={pdf}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                                  >
                                    <ExternalLink size={11} /> PDF
                                  </a>
                                )}
                              </div>
                            </div>
                            <span className={`ml-auto text-[11px] ${trustColor} whitespace-nowrap`}>
                              {`Kepercayaan ${s.trustLevel ?? "n/a"}`}
                            </span>
                          </div>
                          <div className="text-[11px] mt-1.5 flex gap-2 text-zinc-500">
                            <span className="capitalize">{(s.claimStatus ?? "known_fact").replace("_", " ")}</span>
                            <span>·</span>
                            <span>{`Kepercayaan ${Math.round((s.confidence ?? 0.5) * 100)}%`}</span>
                          </div>
                          {s.note && <p className="text-[11px] text-zinc-600 mt-1">{s.note}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <TtsButton text={`${discovery.hook} ${discovery.teaser}`} />
                <button
                  onClick={explore}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 text-sm font-medium"
                >
                  Selami <ArrowRight size={14} />
                </button>
                <button
                  onClick={onSave}
                  disabled={saved}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-sm disabled:opacity-50"
                >
                  {saved ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Save size={14} />}
                  {saved ? "Tersimpan" : "Simpan"}
                </button>
              </div>

              <div className="mt-6 space-y-2">
                {[1, 2, 3, 4].map((lv) => (
                  <div key={lv}>
                    <button
                      onClick={() => openDepthLevel(lv)}
                      className="w-full flex items-center justify-between text-left px-4 py-2.5 rounded-lg border border-zinc-800 hover:bg-zinc-800/50 text-sm text-zinc-300"
                    >
                      <span>
                        L{lv} · {["", "Konteks", "Mengapa", "Koneksi", "Selami Dalam"][lv]}
                      </span>
                      {loadingLevel === lv ? (
                        <span className="text-xs text-zinc-500">...</span>
                      ) : (
                        <ChevronIcon open={openLevel === lv} />
                      )}
                    </button>
                    {openLevel === lv && levels[lv] && (
                      <div className="px-4 py-3 text-sm text-zinc-300 leading-relaxed">
                        <MarkdownLite>{levels[lv].content}</MarkdownLite>
                        <div className="mt-2">
                          <TtsButton text={levels[lv].content} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {questions.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
                    <Lightbulb size={12} /> Lubang Kelinci
                  </div>
                  <ul className="space-y-1.5">
                    {questions.map((q, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setAskInput(q.question)}
                          className="w-full text-left text-sm text-zinc-300 hover:text-sky-300 px-3 py-2 rounded-lg border border-zinc-800 hover:bg-zinc-800/40"
                        >
                          {q.question}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 border-t border-zinc-800 pt-4">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
                  <MessagesSquare size={12} /> Tanya tentang paper ini
                </div>
                <div className="flex gap-2">
                  <input
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onAsk()}
                    placeholder="Mis. metodologi mereka seperti apa?"
                    className="flex-1 bg-zinc-800 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-sky-500"
                  />
                  <button
                    onClick={onAsk}
                    disabled={asking || !askInput.trim()}
                    className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 text-sm font-medium disabled:opacity-50"
                  >
                    {asking ? "..." : "Tanya"}
                  </button>
                </div>
                {answers.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {answers.map((a, i) => (
                      <div key={i} className="text-sm text-zinc-300 leading-relaxed">
                        <p className="text-sky-300 font-medium mb-1">{a.q}</p>
                        <MarkdownLite>{a.a}</MarkdownLite>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!feedbackGiven && (
                <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500">
                  <span>Ini berguna?</span>
                  <button onClick={() => onFeedback("didnt_know")} className="inline-flex items-center gap-1 hover:text-emerald-400">
                    <ThumbsUp size={13} /> Tahu
                  </button>
                  <button onClick={() => onFeedback("already_knew")} className="inline-flex items-center gap-1 hover:text-zinc-300">
                    <CheckCircle2 size={13} /> Sudah tahu
                  </button>
                  <button onClick={() => onFeedback("not_interested")} className="inline-flex items-center gap-1 hover:text-red-400">
                    <ThumbsDown size={13} /> Lewati
                  </button>
                </div>
              )}
            </article>
          )}

          <div className="w-full max-w-xl mt-10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-zinc-300">
                <BookMarked size={16} className="text-sky-400" />
                <span className="text-sm font-medium">Jurnal tersimpan</span>
              </div>
              <button
                onClick={loadHistory}
                disabled={loadingHistory}
                className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                {showHistory ? "Segarkan" : "Muat"} {loadingHistory ? "..." : ""}
              </button>
            </div>
            {showHistory && (
              <div className="space-y-1.5">
                {history.length === 0 && (
                  <p className="text-xs text-zinc-600">Belum ada jurnal yang kamu simpan.</p>
                )}
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      reset();
                      const id = h.id;
                      setDiscovery({
                        id,
                        category: h.category,
                        hook: h.hook,
                        teaser: "",
                        question: h.question,
                        status: "approved",
                      } as Discovery);
                      // Ambil sumber tersimpan (karena teaser/sources tidak ikut di history list).
                      setLoadingSources(true);
                      void fetch(`/api/journal/${id}/sources`)
                        .then((r) => r.json())
                        .then((d) => setSources(d.sources ?? []))
                        .catch(() => {})
                        .finally(() => setLoadingSources(false));
                      setShowSources(true);
                    }}
                    className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 hover:bg-zinc-800/60"
                  >
                    <p className="text-sm text-zinc-200 truncate">{h.hook}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="mt-10 text-xs text-zinc-600 max-w-xl text-center">
            Sumber: arXiv · Semantic Scholar · OpenAlex. Paper peer-reviewed asli — baca langsung di sumbernya.
          </p>
        </div>
      </main>

      {showAuthModal && !code && (
        <AuthModal onAuthenticated={(c) => handleAuthenticated(c)} />
      )}
    </>
  );
}
