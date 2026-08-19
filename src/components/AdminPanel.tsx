"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  MessageSquare,
  LayoutDashboard,
  FileText,
  Eye,
  Loader2,
  ShieldAlert,
  AudioLines,
} from "lucide-react";

type AdminSession = {
  id: string;
  title: string;
  ownerCode: string | null;
  mode: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number; designerPages: number; attachments: number };
};

type AdminUser = {
  code: string;
  sessions: number;
  messages: number;
};

type TtsUsage = {
  provider: "google" | "edge";
  usedChars: number;
  quotaChars: number;
  remainingChars: number;
  cutoffEnabled: boolean;
  cutoffChars: number;
  lastSyncedAt: number | null;
};

function formatNumber(n: number): string {
  return n.toLocaleString("id-ID");
}

function formatRelativeTime(ms: number | null): string {
  if (!ms) return "belum pernah";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// Panel super admin: list semua sesi yang pernah terbuat + tombol login-as.
export default function AdminPanel({
  onClose,
  onImpersonate,
}: {
  onClose: () => void;
  onImpersonate: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [ttsUsage, setTtsUsage] = useState<TtsUsage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sessions");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal memuat.");
        return;
      }
      setSessions(data.sessions ?? []);
      setUsers(data.users ?? []);
    } catch {
      setError("Kesalahan jaringan.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTtsUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tts-usage");
      if (res.ok) setTtsUsage(await res.json());
    } catch {
      // abaikan — panel tetep jalan walau usage gagal
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTtsUsage();
  }, [load, loadTtsUsage]);

  const impersonate = async (id: string) => {
    setActingId(id);
    try {
      const res = await fetch(`/api/admin/sessions/${id}/impersonate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal login-as.");
        return;
      }
      onImpersonate(id);
    } catch {
      setError("Kesalahan jaringan.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Super Admin — Semua Sesi
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            title="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        {/* Ringkasan user */}
        <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 px-5 py-3 sm:grid-cols-3 md:grid-cols-4">
          {users.map((u) => (
            <div
              key={u.code}
              className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
            >
              <p className="truncate font-mono text-xs text-indigo-300">
                {u.code === "__legacy__" ? "legacy" : u.code}
              </p>
              <p className="text-[11px] text-zinc-500">
                {u.sessions} sesi · {u.messages} pesan
              </p>
            </div>
          ))}
          {users.length === 0 && (
            <p className="col-span-full text-xs text-zinc-600">Belum ada sesi.</p>
          )}
        </div>

        {/* TTS Usage (Google Cloud) — pantau sisa free tier + status cutoff */}
        {ttsUsage && (
          <div className="border-b border-zinc-800 px-5 py-3">
            <div className="flex items-center gap-2 mb-2">
              <AudioLines size={14} className="text-sky-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                TTS Usage (Google Cloud)
              </span>
              <span
                className={`ml-auto rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  ttsUsage.provider === "google"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    : "bg-zinc-700/40 text-zinc-300 border border-zinc-700"
                }`}
              >
                {ttsUsage.provider === "google" ? "Google (primary)" : "Edge (fallback)"}
              </span>
            </div>

            {/* Progress bar: used / quota */}
            <div className="h-2.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  ttsUsage.usedChars >= ttsUsage.cutoffChars
                    ? "bg-red-500"
                    : ttsUsage.usedChars >= ttsUsage.cutoffChars * 0.75
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    (ttsUsage.usedChars / ttsUsage.quotaChars) * 100
                  )}%`,
                }}
              />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-zinc-400">
              <span>
                Terpakai:{" "}
                <span className="font-mono text-zinc-200">
                  {formatNumber(ttsUsage.usedChars)}
                </span>{" "}
                char
              </span>
              <span>
                Sisa free tier:{" "}
                <span className="font-mono text-emerald-300">
                  {formatNumber(ttsUsage.remainingChars)}
                </span>{" "}
                char
              </span>
              <span className="text-zinc-500">
                Quota: {formatNumber(ttsUsage.quotaChars)}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
              {ttsUsage.cutoffEnabled ? (
                <span className="flex items-center gap-1 text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  CUTOFF AKTIF @ {formatNumber(ttsUsage.cutoffChars)} char → auto-fallback Edge
                </span>
              ) : (
                <span className="flex items-center gap-1 text-zinc-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                  Cutoff nonaktif
                </span>
              )}
              <span className="text-zinc-500">
                Sync Google: {formatRelativeTime(ttsUsage.lastSyncedAt)}
              </span>
            </div>
          </div>
        )}

        {/* List sesi */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={22} className="animate-spin text-zinc-500" />
            </div>
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-zinc-100">{s.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                      <span className="font-mono text-indigo-400/80">
                        {s.ownerCode ?? "legacy"}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare size={11} /> {s._count.messages}
                      </span>
                      <span className="flex items-center gap-1">
                        <LayoutDashboard size={11} /> {s._count.designerPages}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText size={11} /> {s._count.attachments}
                      </span>
                      <span className="uppercase">{s.mode}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => void impersonate(s.id)}
                    disabled={actingId === s.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-600/30 disabled:opacity-50"
                    title="Login as (impersonate)"
                  >
                    {actingId === s.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Eye size={13} />
                    )}
                    Intip
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs text-zinc-600">Belum ada sesi.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
          <span>Total {sessions.length} sesi</span>
          <button
            onClick={() => {
              void load();
              void loadTtsUsage();
            }}
            className="text-zinc-400 hover:text-zinc-200"
          >
            Segarkan
          </button>
        </div>
      </div>
    </div>
  );
}
