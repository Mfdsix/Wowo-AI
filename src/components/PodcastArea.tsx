"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Mic,
  Play,
  Pause,
  Square,
  Send,
  Volume2,
  Sparkles,
  RotateCcw,
  MessageSquarePlus,
  Radio,
  List,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Music2,
} from "lucide-react";
import {
  isPlaceholderValue,
  type PodcastConfig,
  type Speaker,
} from "@/lib/podcast";
import type { Message } from "@/lib/types";

type PodcastAreaProps = {
  isPodcastSession: boolean;
  sessionTitle?: string;
  messages: Message[];
  podcastConfig: PodcastConfig;
  podcastStatus: "idle" | "running" | "stopped";
  podcastTurnCount: number;
  podcastActiveSpeaker: Speaker | null;
  podcastStreamingId: string | null;
  podcastPlayingId: string | null;
  podcastLoadingId: string | null;
  podcastNeedsGesture: boolean;
  podcastNoteInput: string;
  podcastReplaying: boolean;
  isAudioPaused: boolean;
  onTogglePausePlay: () => void;
  onNoteInputChange: (v: string) => void;
  onSendNote: () => void;
  onStart: (topic: string, config: PodcastConfig) => void;
  onReplay: () => void;
  onStop: () => void;
  onResumeGesture: () => void;
  onPersonasChange?: (personas: Record<Speaker, string>) => void;
};

// Colors & styles per speaker
const SPEAKER_CONFIG: Record<
  Speaker,
  {
    label: string;
    badge: string;
    waveColor: string;
    glow: string;
    border: string;
    textColor: string;
  }
> = {
  host: {
    label: "Host",
    badge: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    waveColor: "bg-sky-400",
    glow: "shadow-[0_0_20px_rgba(56,189,248,0.3)]",
    border: "border-sky-500/40",
    textColor: "text-sky-400",
  },
  guestA: {
    label: "Tamu A",
    badge: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    waveColor: "bg-pink-400",
    glow: "shadow-[0_0_20px_rgba(244,114,182,0.3)]",
    border: "border-pink-500/40",
    textColor: "text-pink-400",
  },
  guestB: {
    label: "Tamu B",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    waveColor: "bg-emerald-400",
    glow: "shadow-[0_0_20px_rgba(52,211,153,0.3)]",
    border: "border-emerald-500/40",
    textColor: "text-emerald-400",
  },
};

// Animated Audio Waveform Component
function SpeakerWaveform({
  speaker,
  isPlaying,
}: {
  speaker: Speaker | null;
  isPlaying: boolean;
}) {
  const current = speaker ? SPEAKER_CONFIG[speaker] : SPEAKER_CONFIG.host;

  return (
    <div className="flex items-center justify-center gap-1 h-7 py-0.5 px-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
      {[40, 75, 55, 90, 60, 85, 45, 70, 95, 50].map((h, i) => {
        let barColor = "bg-zinc-600";
        if (isPlaying && speaker) {
          barColor = current.waveColor;
        }

        return (
          <div
            key={i}
            className={`w-1 rounded-full transition-all duration-300 ${barColor} ${
              isPlaying
                ? "animate-[bounce_1.2s_infinite_ease-in-out]"
                : "opacity-40"
            }`}
            style={{
              height: isPlaying ? `${Math.max(20, (h * ((i % 3) + 1)) % 100)}%` : "20%",
              animationDelay: `${(i * 120) % 600}ms`,
            }}
          />
        );
      })}
    </div>
  );
}


// Judul thumbnail yang kepanjangan → jalan horizontal (marquee) biar gak
// kepotong, dengan fade lembut di sisi kiri-kanan. Loop-nya seamless karena
// konten di-duplikat dan track digeser tepat -50%.
function MarqueeTitle({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;
    // Cek apakah lebar teks (track w-max) melebihi lebar container yang
    // kelihatan (toleransi 2px biar gak kepancing marquee buat selisih
    // sub-pixel).
    setOverflowing(track.scrollWidth > container.clientWidth + 2);
  }, [text]);

  const label = text || "Diskusi Podcast";

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden px-2 ${
        overflowing
          ? "[mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]"
          : ""
      }`}
    >
      <div
        ref={trackRef}
        className={`flex w-max whitespace-nowrap ${overflowing ? "" : "mx-auto"}`}
        style={
          overflowing
            ? {
                animation: `podcast-marquee ${Math.max(8, label.length * 0.3)}s linear infinite`,
              }
            : undefined
        }
      >
        <span className="px-4 text-sm font-bold text-zinc-100 leading-snug">
          {label}
        </span>
        {overflowing && (
          <span
            aria-hidden
            className="px-4 text-sm font-bold text-zinc-100 leading-snug"
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

// Mini HTML/SVG Visual Thumbnail Cover Art
function PodcastThumbnail({
  title,
  activeSpeaker,
  speakerName,
}: {
  title: string;
  activeSpeaker: Speaker | null;
  speakerName?: string;
}) {
  const speakerStyle = activeSpeaker ? SPEAKER_CONFIG[activeSpeaker] : null;

  return (
    <div className="relative w-full max-w-[280px] aspect-square rounded-2xl overflow-hidden border border-zinc-700/60 shadow-xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 flex flex-col justify-between p-5 group">
      {/* Background radial glow */}
      <div
        className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-40 transition-colors duration-700 ${
          activeSpeaker === "host"
            ? "bg-sky-500"
            : activeSpeaker === "guestA"
            ? "bg-pink-500"
            : activeSpeaker === "guestB"
            ? "bg-emerald-500"
            : "bg-indigo-500"
        }`}
      />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-violet-600/20 rounded-full blur-3xl" />

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px] opacity-10" />

      {/* Header Badge */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-700/60 backdrop-blur-md">
          <Radio size={13} className="text-red-500 animate-pulse" />
          <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-300">
            WOWO PODCAST
          </span>
        </div>
        <div className="h-8 w-8 rounded-full bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
          <Music2 size={16} />
        </div>
      </div>

      {/* Center Artwork Illustration */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center my-2">
        <div className="relative mb-2">
          <div
            className={`w-16 h-16 rounded-xl flex items-center justify-center border transition-all duration-500 ${
              speakerStyle
                ? `${speakerStyle.badge} ${speakerStyle.glow}`
                : "bg-indigo-600/20 border-indigo-500/40 text-indigo-400"
            }`}
          >
            <Mic size={28} />
          </div>
        </div>

        <MarqueeTitle text={title} />
      </div>

      {/* Footer / Active Speaker Badge */}
      <div className="relative z-10 flex items-center justify-between pt-2 border-t border-zinc-800/80">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
          ON AIR
        </span>
        {speakerStyle && speakerName ? (
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${speakerStyle.badge}`}
          >
            <span className={`w-2 h-2 rounded-full animate-ping ${speakerStyle.waveColor}`} />
            <span className="max-w-[110px] truncate">{speakerName}</span>
          </div>
        ) : (
          <span className="text-xs text-zinc-500">Standby</span>
        )}
      </div>
    </div>
  );
}

function SpeakerBubble({
  speaker,
  name,
  content,
  streaming,
  playing,
  loading,
}: {
  speaker: Speaker;
  name: string;
  content: string;
  streaming?: boolean;
  playing?: boolean;
  loading?: boolean;
}) {
  const style = SPEAKER_CONFIG[speaker];
  return (
    <div
      className={`group relative flex gap-3 rounded-xl border px-4 py-3 overflow-hidden ${
        playing || loading
          ? `${style.border} bg-zinc-900/80 shadow-md`
          : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
        <Mic size={15} className={style.textColor} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-200">{name}</span>
          {streaming && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              lagi mikir…
            </span>
          )}
          {playing && (
            <span className={`flex items-center gap-1 text-[10px] ${style.textColor}`}>
              <Volume2 size={11} className="animate-pulse" />
              lagi bicara
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {content || (
            <span className="text-zinc-600 italic">Menulis ucapan…</span>
          )}
        </p>
      </div>
    </div>
  );
}

export default function PodcastArea({
  isPodcastSession,
  sessionTitle,
  messages,
  podcastConfig,
  podcastStatus,
  podcastTurnCount,
  podcastActiveSpeaker,
  podcastStreamingId,
  podcastPlayingId,
  podcastLoadingId,
  podcastNeedsGesture,
  podcastNoteInput,
  podcastReplaying,
  isAudioPaused,
  onTogglePausePlay,
  onNoteInputChange,
  onSendNote,
  onStart,
  onReplay,
  onStop,
  onResumeGesture,
  onPersonasChange,
}: PodcastAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [topic, setTopic] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [names, setNames] = useState<Record<Speaker, string>>(
    podcastConfig.names
  );
  const [personas, setPersonas] = useState<Record<Speaker, string>>(
    podcastConfig.personas ?? { host: "", guestA: "", guestB: "" }
  );
  const [isSuggestingPersonas, setIsSuggestingPersonas] = useState(false);
  const [suggestNotice, setSuggestNotice] = useState("");

  // AI suggestion: 3 tokoh sesuai tema
  const handleSuggestPersonas = async () => {
    if (!topic.trim()) return;
    setSuggestNotice("");
    setIsSuggestingPersonas(true);
    try {
      const res = await fetch("/api/podcast/suggest-personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (res.ok) {
        const data = await res.json();

        // Ada gak nilai non-placeholder di respons? Dihitung dari data, bukan
        // dari dalam updater — React bisa men-defer eksekusi updater, jadi
        // membaca hasil di sana gak andal.
        const anyName = [
          data.names?.host,
          data.names?.guestA,
          data.names?.guestB,
        ].some((v) => !isPlaceholderValue(v));
        const anyPersona = [
          data.personas?.host,
          data.personas?.guestA,
          data.personas?.guestB,
        ].some((v) => !isPlaceholderValue(v));

        // Update pakai bentuk fungsional (prev) biar gak nimpa nilai yang
        // user ketik sambil nunggu fetch selesai (hindari stale closure).
        // Nilai placeholder (nyalin contoh prompt) diabaikan.
        setNames((prev) => ({
          host: isPlaceholderValue(data.names?.host)
            ? prev.host
            : String(data.names.host),
          guestA: isPlaceholderValue(data.names?.guestA)
            ? prev.guestA
            : String(data.names.guestA),
          guestB: isPlaceholderValue(data.names?.guestB)
            ? prev.guestB
            : String(data.names.guestB),
        }));
        setPersonas(() => ({
          host: isPlaceholderValue(data.personas?.host)
            ? ""
            : String(data.personas.host),
          guestA: isPlaceholderValue(data.personas?.guestA)
            ? ""
            : String(data.personas.guestA),
          guestB: isPlaceholderValue(data.personas?.guestB)
            ? ""
            : String(data.personas.guestB),
        }));

        if (!anyName && !anyPersona) {
          setSuggestNotice(
            "Model belum menghasilkan saran baru — coba lagi atau isi manual."
          );
          setTimeout(() => setSuggestNotice(""), 5000);
        }
      }
    } catch (err) {
      console.error("Suggest personas failed:", err);
      setSuggestNotice("Gagal memanggil saran persona. Coba lagi.");
      setTimeout(() => setSuggestNotice(""), 5000);
    } finally {
      setIsSuggestingPersonas(false);
    }
  };

  // Sinkronkan nama speaker & persona saat config berubah (mis. ganti session).
  // Pakai pola React "adjust state during render" biar gak kena
  // react-hooks/set-state-in-effect.
  const [prevConfig, setPrevConfig] = useState(podcastConfig);
  if (prevConfig !== podcastConfig) {
    setPrevConfig(podcastConfig);
    setNames(podcastConfig.names);
    setPersonas(
      podcastConfig.personas ?? { host: "", guestA: "", guestB: "" }
    );
    // Jangan panggil onPersonasChange di sini — itu setState parent saat
    // render, bisa memicu render loop. Sync config→state lokal cukup.
  }

  // Helper: update persona satu speaker + kabari parent (biar config di
  // session ikut ke-update & ke-persist).
  const updatePersona = (spk: Speaker, value: string) => {
    const next = { ...personas, [spk]: value };
    setPersonas(next);
    onPersonasChange?.(next);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, podcastStreamingId]);

  const submitStart = () => {
    if (!topic.trim()) return;
    onStart(topic, {
      names,
      personas,
      maxTurns: podcastConfig.maxTurns,
    });
  };

  const running = podcastStatus === "running";
  const activeSpeakerName = podcastActiveSpeaker
    ? names[podcastActiveSpeaker]
    : undefined;

  const onAirMessages = messages.filter(
    (m) =>
      m.role === "assistant" &&
      m.speaker &&
      !m.id.startsWith("temp-") &&
      !m.id.startsWith("assist-") &&
      !m.id.startsWith("error-")
  );
  const noteMessages = messages.filter((m) => m.role === "user");

  // ─── Setup View ───────────────────────────────────────────────
  if (!isPodcastSession) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto bg-zinc-900 p-6 md:p-10">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Mic size={28} />
            </div>
            <h2 className="text-2xl font-bold text-zinc-100">
              Mulai Sesi Podcast AI
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Masukkan tema diskusi, AI akan membuatkan 3 tokoh pembicara secara otomatis!
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-4 shadow-xl">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Tema / Topik Utama Diskusi
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Contoh: Diskusi integrasi AI ke sistem CRM perusahaan..."
                rows={3}
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-col items-end gap-2">
              {suggestNotice && (
                <p className="text-xs text-amber-400/90">{suggestNotice}</p>
              )}
              <button
                type="button"
                onClick={handleSuggestPersonas}
                disabled={!topic.trim() || isSuggestingPersonas}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 transition-colors text-xs font-semibold disabled:opacity-40"
              >
                {isSuggestingPersonas ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                Saran Tokoh & Persona AI
              </button>
            </div>

            <div className="space-y-3 pt-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Karakter & Persona Pembicara (Editable)
              </label>
              {(["host", "guestA", "guestB"] as Speaker[]).map((spk) => {
                const conf = SPEAKER_CONFIG[spk];
                return (
                  <div
                    key={spk}
                    className={`flex flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5 ${
                      isSuggestingPersonas ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${conf.badge}`}>
                        {conf.label}
                      </span>
                      <input
                        type="text"
                        value={names[spk]}
                        onChange={(e) =>
                          setNames((prev) => ({ ...prev, [spk]: e.target.value }))
                        }
                        disabled={isSuggestingPersonas}
                        placeholder={`Nama ${conf.label}`}
                        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
                      />
                    </div>
                    <textarea
                      value={personas[spk]}
                      onChange={(e) => updatePersona(spk, e.target.value)}
                      disabled={isSuggestingPersonas}
                      placeholder={`Persona ${conf.label} (gaya bicara / sudut pandang). Kosong = default AI.`}
                      rows={2}
                      className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
                    />
                  </div>
                );
              })}
            </div>

            <button
              onClick={submitStart}
              disabled={!topic.trim()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 font-semibold text-white transition-all hover:bg-indigo-500 disabled:opacity-40 shadow-lg shadow-indigo-600/30"
            >
              <Play size={18} />
              Mulai Sesi Podcast
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Active Music Player View ────────────────────────────────
  return (
    <div className="flex flex-1 flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 shrink-0 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="flex h-3 w-3 items-center justify-center">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                running ? "bg-emerald-500 animate-ping" : "bg-zinc-600"
              }`}
            />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-100 line-clamp-1">
              {sessionTitle || "Sesi Podcast"}
            </h2>
            <span className="text-[11px] text-zinc-400">
              {running ? "On Air • Smooth Lookahead Pipeline" : "Sesi Dihentikan"}
            </span>
          </div>
        </div>

        {/* Toggle Transcript Button */}
        <button
          onClick={() => setShowTranscript((prev) => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            showTranscript
              ? "bg-indigo-600 text-white border-indigo-500"
              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
          }`}
        >
          <List size={14} />
          <span>{showTranscript ? "Sembunyikan Riwayat" : "Lihat Riwayat Chat"}</span>
          {showTranscript ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Main Container — satu view aktif: player ATAU transkrip full-width */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Left/Center: Dynamic Music Player Interface */}
        {!showTranscript && (
        <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-y-auto bg-gradient-to-b from-zinc-900/60 to-zinc-950">
          <div className="w-full max-w-md flex flex-col items-center gap-4">
            {/* Visual Thumbnail */}
            <PodcastThumbnail
              title={sessionTitle || "Podcast AI Session"}
              activeSpeaker={podcastActiveSpeaker}
              speakerName={activeSpeakerName}
            />

            {/* Speaker Waveform Equalizer */}
            <div className="w-full flex flex-col items-center gap-1.5">
              <SpeakerWaveform
                speaker={podcastActiveSpeaker}
                isPlaying={running && !isAudioPaused}
              />
              <span className="text-xs text-zinc-400 font-medium">
                {running
                  ? podcastActiveSpeaker
                    ? `${names[podcastActiveSpeaker]} sedang berbicara`
                    : "Menyiapkan giliran..."
                  : "Audio dihentikan"}
              </span>
            </div>

            {/* Audio Controls (Play/Pause, Stop, Replay) */}
            <div className="flex items-center gap-3 py-1">
              <button
                onClick={onReplay}
                disabled={onAirMessages.length === 0}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-40"
                title="Putar Ulang Transkrip"
              >
                <RotateCcw size={16} />
              </button>

              <button
                onClick={onTogglePausePlay}
                disabled={!running}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 hover:bg-indigo-500 transition-all transform active:scale-95 disabled:opacity-40"
                title={isAudioPaused ? "Play" : "Pause"}
              >
                {isAudioPaused ? <Play size={22} className="ml-0.5" /> : <Pause size={22} />}
              </button>

              <button
                onClick={onStop}
                disabled={!running}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-red-400 hover:bg-red-950 hover:text-red-300 transition-colors disabled:opacity-40"
                title="Hentikan Podcast"
              >
                <Square size={16} />
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Transkrip full-width — ngeganti player view pas dibuka */}
        {showTranscript && (
          <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <List size={14} /> Transkrip Percakapan ({onAirMessages.length})
              </span>
              <button
                onClick={() => setShowTranscript(false)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 p-1"
              >
                <ChevronUp size={16} />
                Tutup
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 md:p-6">
              {noteMessages.length > 0 && (
                <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                    <Sparkles size={12} />
                    Catatan Produser (off-air)
                  </div>
                  {noteMessages.map((m) => (
                    <p key={m.id} className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">
                      💬 {m.content}
                    </p>
                  ))}
                </div>
              )}

              {onAirMessages.map((m) => {
                const speaker = (m.speaker as Speaker) ?? "host";
                return (
                  <SpeakerBubble
                    key={m.id}
                    speaker={speaker}
                    name={podcastConfig.names[speaker] ?? speaker}
                    content={m.content}
                    streaming={podcastStreamingId === m.id}
                    playing={podcastPlayingId === m.id}
                    loading={podcastLoadingId === m.id}
                  />
                );
              })}

              {onAirMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageSquarePlus size={24} className="text-zinc-700 mb-2" />
                  <p className="text-xs text-zinc-500">Belum ada giliran percakapan</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Prompter Box — Always available at the bottom */}
      <div className="shrink-0 border-t border-zinc-800 p-3 bg-zinc-900/90">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            value={podcastNoteInput}
            onChange={(e) => onNoteInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendNote();
              }
            }}
            rows={1}
            placeholder="📝 Note buat host… (ketik kapanpun, langsung dilempar ke diskusi)"
            className="flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={onSendNote}
            disabled={!podcastNoteInput.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 shadow-lg shadow-indigo-600/30"
            title="Kirim note ke host"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
