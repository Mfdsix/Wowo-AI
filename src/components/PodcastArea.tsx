"use client";

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Play,
  Pause,
  Send,
  Volume2,
  Sparkles,
  RotateCcw,
  MessageSquarePlus,
} from "lucide-react";
import type { PodcastConfig, Speaker } from "@/lib/podcast";
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
  podcastNeedsGesture: boolean;
  podcastNoteInput: string;
  podcastReplaying: boolean;
  onNoteInputChange: (v: string) => void;
  onSendNote: () => void;
  onStart: (topic: string, config: PodcastConfig) => void;
  onResume: () => void;
  onReplay: () => void;
  onStop: () => void;
  onResumeGesture: () => void;
};

// Warna + ikon per speaker biar gampang dibedain di transkrip
const SPEAKER_STYLE: Record<Speaker, { dot: string; chip: string; icon: typeof Mic }> = {
  host: {
    dot: "bg-sky-400",
    chip: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    icon: Mic,
  },
  guestA: {
    dot: "bg-pink-400",
    chip: "bg-pink-500/10 text-pink-300 border-pink-500/30",
    icon: Mic,
  },
  guestB: {
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    icon: Mic,
  },
};

function SpeakerBubble({
  speaker,
  name,
  content,
  streaming,
  playing,
}: {
  speaker: Speaker;
  name: string;
  content: string;
  streaming?: boolean;
  playing?: boolean;
}) {
  const style = SPEAKER_STYLE[speaker];
  const Icon = style.icon;
  return (
    <div
      className={`flex gap-3 rounded-xl border px-4 py-3 ${
        playing
          ? "border-zinc-600 bg-zinc-800/60"
          : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
        <Icon size={15} className={style.dot === "bg-sky-400" ? "text-sky-400" : style.dot === "bg-pink-400" ? "text-pink-400" : "text-emerald-400"} />
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
            <span className="flex items-center gap-1 text-[10px] text-zinc-400">
              <Volume2 size={11} className="animate-pulse" />
              lagi bicara
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {content || (streaming ? "…" : "")}
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
  podcastNeedsGesture,
  podcastNoteInput,
  podcastReplaying,
  onNoteInputChange,
  onSendNote,
  onStart,
  onResume,
  onReplay,
  onStop,
  onResumeGesture,
}: PodcastAreaProps) {
  const [topic, setTopic] = useState("");
  const [namesDraft, setNamesDraft] = useState(podcastConfig.names);
  const [maxTurnsDraft, setMaxTurnsDraft] = useState(podcastConfig.maxTurns);
  const [prevConfig, setPrevConfig] = useState(podcastConfig);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset draft config saat config berubah (mis. ganti session).
  // Pola React "adjust state during render" — setState di dalam render itu legal,
  // nggak kayak setState dalam effect.
  if (prevConfig !== podcastConfig) {
    setPrevConfig(podcastConfig);
    setNamesDraft(podcastConfig.names);
    setMaxTurnsDraft(podcastConfig.maxTurns);
  }

  // Auto-scroll ke paling bawah pas ada pesan baru
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, podcastStreamingId, podcastPlayingId]);

  const onAirMessages = messages.filter(
    (m) =>
      m.role === "assistant" &&
      m.speaker &&
      !m.id.startsWith("temp-") &&
      !m.id.startsWith("error-")
  );
  const noteMessages = messages.filter(
    (m) => m.role === "user" && !m.id.startsWith("temp-") && !m.id.startsWith("error-")
  );
  const hasTurns = onAirMessages.length > 0;
  const running = podcastStatus === "running";

  const submitStart = () => {
    const t = topic.trim();
    if (!t) return;
    onStart(t, {
      names: {
        host: namesDraft.host.trim() || "Host",
        guestA: namesDraft.guestA.trim() || "Tamu A",
        guestB: namesDraft.guestB.trim() || "Tamu B",
      },
      maxTurns: Math.max(3, maxTurnsDraft),
    });
  };

  // ─── Setup screen (belum ada session podcast) ─────────────────
  if (!isPodcastSession) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400">
              <Mic size={22} />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100">Mode Podcast</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Kasih satu topik, AI bawa diskusi 3 suara. Ketik kapanpun buat
              interject, kayak prompter talkshow.
            </p>
          </div>

          <label className="mb-1.5 block text-xs font-medium text-zinc-400">
            Topik awal diskusi
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="Contoh: 'Dunia AI di 2026 — ngomongin startup lokal, deepfake, dan masa depan kerja…'"
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
          />

          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["host", "guestA", "guestB"] as Speaker[]).map((s) => (
              <div key={s}>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                  {s === "host" ? "Host" : s === "guestA" ? "Tamu A" : "Tamu B"}
                </label>
                <input
                  value={namesDraft[s]}
                  onChange={(e) =>
                    setNamesDraft((prev) => ({ ...prev, [s]: e.target.value }))
                  }
                  placeholder={s === "host" ? "Host" : s === "guestA" ? "Tamu A" : "Tamu B"}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-zinc-500">Max giliran:</label>
            <input
              type="number"
              min={3}
              max={60}
              value={maxTurnsDraft}
              onChange={(e) => setMaxTurnsDraft(Number(e.target.value) || 24)}
              className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            onClick={submitStart}
            disabled={!topic.trim()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={16} />
            Mulai Podcast
          </button>
        </div>
      </div>
    );
  }

  // ─── Session podcast: transkrip + kontrol ─────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Mic size={15} className="text-indigo-400" />
          <span className="truncate text-sm font-medium text-zinc-200">
            {sessionTitle || "Podcast"}
          </span>
          {running && podcastActiveSpeaker && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE · {podcastConfig.names[podcastActiveSpeaker] ?? "Giliran"} lagi bicara
            </span>
          )}
          <span className="text-[11px] text-zinc-500">
            Giliran {podcastTurnCount}/{podcastConfig.maxTurns}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              <Pause size={13} />
              Stop
            </button>
          ) : (
            hasTurns && (
              <>
                <button
                  onClick={onReplay}
                  disabled={podcastReplaying}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  <RotateCcw size={13} />
                  {podcastReplaying ? "Memutar…" : "Putar Ulang"}
                </button>
                <button
                  onClick={onResume}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  <Play size={13} />
                  Lanjutkan
                </button>
              </>
            )
          )}
        </div>
      </div>

      {/* Transkrip */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* Pemicu awal */}
        {noteMessages.length > 0 && (
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <Sparkles size={12} />
              {noteMessages.length > 1 ? "Pemicu & interjeksi (off-air)" : "Pemicu awal (off-air)"}
            </div>
            {noteMessages.map((m) => (
              <p key={m.id} className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
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
            />
          );
        })}

        {!hasTurns && !running && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MessageSquarePlus size={28} className="text-zinc-700" />
            <p className="text-sm text-zinc-500">
              Belum ada giliran. Tekan <span className="text-zinc-300">Lanjutkan</span> buat mulai
              diskusi dari topik ini.
            </p>
          </div>
        )}

        {podcastNeedsGesture && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center">
            <p className="text-xs text-amber-300">
              Browser butuh interaksi buat mulai audio.
            </p>
            <button
              onClick={onResumeGesture}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400"
            >
              <Play size={13} />
              Klik buat lanjut audio
            </button>
          </div>
        )}
      </div>

      {/* Prompter input — ketik kapanpun selama sesi */}
      <div className="shrink-0 border-t border-zinc-800 p-3">
        <div className="flex items-end gap-2">
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
            className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={onSendNote}
            disabled={!podcastNoteInput.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
            title="Kirim note"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
