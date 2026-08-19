import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getTtsProvider } from "@/lib/tts";

// ─── Local TTS usage tracker (counter lokal) ────────────────────────
// Dipakai buat ENFORCE cutoff real-time (yang beneran nyegah charge Google)
// + display sisa free tier. Gak pakai DB (prisma migrate dilarang) → file JSON
// di .data/ (di-ignore .gitignore). Counter ini di-reconcile berkala dari
// Google Cloud Monitoring API (lihat googleMonitoring.ts) biar akurat walau
// ada pemakaian app lain / lag data Google.

// Quota free tier bulanan per model (karakter). WaveNet id-ID = 4 juta/bulan.
export const GOOGLE_FREE_QUOTA = 4_000_000;

// Threshold cutoff default (karakter) — bisa di-override via env.
// Lewat batas ini → synthesize otomatis fallback ke Edge-TTS (gak charge G).
function cutoffThreshold(): number {
  const env = Number(process.env.TTS_GOOGLE_CUTOFF_CHARS);
  if (Number.isFinite(env) && env > 0) return env;
  return 3_500_000; // default 87.5% dari quota WaveNet
}

function cutoffEnabled(): boolean {
  // Default ON selama threshold valid. Matiin via TTS_GOOGLE_CUTOFF=false.
  const env = process.env.TTS_GOOGLE_CUTOFF?.trim().toLowerCase();
  if (env === "false") return false;
  return true;
}

interface UsageState {
  year: number;
  month: number; // 1-12
  chars: number;
  googleChars: number; // hasil reconcile dari Google API (bisa lebih akurat)
  lastSyncedAt: number | null; // epoch ms
}

const DATA_DIR = join(process.cwd(), ".data");
const USAGE_FILE = join(DATA_DIR, "tts-usage.json");

async function loadState(): Promise<UsageState> {
  const now = new Date();
  const fresh: UsageState = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    chars: 0,
    googleChars: 0,
    lastSyncedAt: null,
  };
  try {
    if (!existsSync(USAGE_FILE)) return fresh;
    const raw = await readFile(USAGE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<UsageState>;
    // Reset otomatis kalau beda bulan/tahun.
    if (parsed.year !== fresh.year || parsed.month !== fresh.month) return fresh;
    return {
      year: fresh.year,
      month: fresh.month,
      chars: parsed.chars ?? 0,
      googleChars: parsed.googleChars ?? 0,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
    };
  } catch {
    return fresh;
  }
}

async function saveState(state: UsageState): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(USAGE_FILE, JSON.stringify(state), "utf8");
  } catch (err) {
    console.warn("[TTS usage] gagal simpan state:", err);
  }
}

/**
 * Catat pemakaian N karakter ke counter lokal. Aman dipanggil sebelum TTS.
 * Return void — jangan throw biar podcast gak mati gara-gara tracker.
 */
export async function recordChars(n: number): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  try {
    const state = await loadState();
    state.chars += Math.floor(n);
    await saveState(state);
  } catch (err) {
    console.warn("[TTS usage] recordChars error:", err);
  }
}

/**
 * Cek apakah nambah `additional` karakter bakal melewati threshold cutoff.
 * True = jangan call Google, fallback ke Edge-TTS.
 */
export function isOverCutoff(additional: number): boolean {
  if (!cutoffEnabled()) return false;
  const threshold = cutoffThreshold();
  // Pakai max(local, google) biar reconcile Google ikut nge-guard.
  // (googleChars dibaca sinkron dari file; murah & aman.)
  const localMax = readMaxCharsSync();
  return localMax + additional > threshold;
}

// Baca nilai max(chars, googleChars) secara sinkron (best-effort, tanpa await)
// buat guard di path hot. Kalau file gak kebaca → fallback ke 0 (aman).
function readMaxCharsSync(): number {
  try {
    if (!existsSync(USAGE_FILE)) return 0;
    const raw = readFileSync(USAGE_FILE, "utf8");
    const s = JSON.parse(raw) as UsageState;
    const now = new Date();
    if (s.year !== now.getFullYear() || s.month !== now.getMonth() + 1) return 0;
    return Math.max(s.chars ?? 0, s.googleChars ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Reconcile: terima nilai chars hasil query Google API, simpan sebagai
 * googleChars (bisa lebih akurat dari local kalau ada pemakaian app lain).
 */
export async function reconcileGoogleChars(googleChars: number): Promise<void> {
  try {
    const state = await loadState();
    state.googleChars = Math.max(0, Math.floor(googleChars));
    state.lastSyncedAt = Date.now();
    await saveState(state);
  } catch (err) {
    console.warn("[TTS usage] reconcile error:", err);
  }
}

export interface TtsUsageView {
  provider: "google" | "edge";
  usedChars: number;
  quotaChars: number;
  remainingChars: number;
  cutoffEnabled: boolean;
  cutoffChars: number;
  lastSyncedAt: number | null;
}

export async function getUsage(): Promise<TtsUsageView> {
  const state = await loadState();
  const used = Math.max(state.chars, state.googleChars);
  const quota = GOOGLE_FREE_QUOTA;
  return {
    provider: getTtsProvider(),
    usedChars: used,
    quotaChars: quota,
    remainingChars: Math.max(0, quota - used),
    cutoffEnabled: cutoffEnabled(),
    cutoffChars: cutoffThreshold(),
    lastSyncedAt: state.lastSyncedAt,
  };
}
