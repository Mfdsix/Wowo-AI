import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordChars, isOverCutoff } from "@/lib/ttsUsage";

const execFileAsync = promisify(execFile);

// ─── Provider selection ─────────────────────────────────────────────
// "google" (Cloud TTS, primary) kalau GOOGLE_TTS_API_KEY ter-set, selain
// itu / dipaksa → "edge" (Microsoft Edge-TTS, gratis no-key fallback).
export function getTtsProvider(): "google" | "edge" {
  const forced = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (forced === "edge") return "edge";
  if (forced === "google") return "google";
  // Default: pakai Google kalau key ada, else edge.
  return process.env.GOOGLE_TTS_API_KEY?.trim() ? "google" : "edge";
}

export interface TtsOptions {
  /** Semitone shift (negatif = lebih dalam, positif = lebih tinggi). 0 = normal. */
  pitchShift?: number;
}

// Cache in-memory (hash key = provider|voice|pitch|teks) biar replay/ulang gratis.
// Cap sederhana biar gak bocor memory di sesi panjang.
const CACHE_MAX = 200;
const ttsCache = new Map<string, Buffer>();

const PYTHON = process.env.EDGE_TTS_PYTHON ?? "python3";
const MAX_RETRIES = 2;

// Cache key pakai pitch 0 buat hasil Google (Google gak dipitch-shift),
// pakai shift asli buat Edge.
function cacheKey(text: string, voice: string, shift: number): string {
  const effShift = getTtsProvider() === "google" && voice.startsWith("id-ID-Wavenet")
    ? 0
    : shift;
  return `${getTtsProvider()}|${voice}|${effShift}|${text}`;
}

// ─── Edge-TTS wrapper (fallback) ────────────────────────────────────
// pitchShift saat ini DIMATIIN (lihat catatan di synthesize) → param diabaikan.
async function synthesizeEdge(
  text: string,
  voice: string,
  _pitchShift = 0
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "wowo-tts-"));
  const txtPath = join(dir, "input.txt");
  const rawPath = join(dir, "raw.mp3");
  try {
    await writeFile(txtPath, text, "utf8");
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await execFileAsync(
          PYTHON,
          ["-m", "edge_tts", "--file", txtPath, "--voice", voice, "--write-media", rawPath],
          { timeout: 30000 }
        );
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
    // PITCH SHIFT DIMATIIN. Balikin ke raw audio original dari Edge-TTS.
    return await readFile(rawPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ─── Google Cloud TTS (primary) ─────────────────────────────────────
// REST API: POST https://texttospeech.googleapis.com/v1/text:synthesize?key=API_KEY
// Response: { audioContent: <base64 mp3> }. No SDK → pakai fetch bawaan Node.
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

async function synthesizeGoogle(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY belum di-set");

  const res = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "id-ID", name: voice },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google TTS HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error("Google TTS: audioContent kosong");
  return Buffer.from(data.audioContent, "base64");
}

// Mapping voice Google (id-ID-Wavenet-*) → Edge-TTS biar fallback tetep
// beda gender/suara yang mirip.
function googleVoiceToEdge(voice: string): string {
  switch (voice) {
    case "id-ID-Wavenet-A":
    case "id-ID-Wavenet-C":
      return "id-ID-GadisNeural"; // wanita
    case "id-ID-Wavenet-B":
    case "id-ID-Wavenet-D":
      return "id-ID-ArdiNeural"; // pria
    default:
      return "id-ID-ArdiNeural";
  }
}

/**
 * Synthesize text jadi mp3 buffer.
 * - Provider primary = Google (kalau aktif).
 * - SEBELUM call Google: cek cutoff → kalau lewat threshold, langsung fallback
 *   ke Edge-TTS (gak charge Google sama sekali).
 * - Kalau Google gagal (network/key/quota 4xx), fallback ke Edge-TTS secara
 *   transparan (podcast tetep jalan).
 */
export async function synthesize(
  text: string,
  voice: string,
  opts: TtsOptions = {}
): Promise<Buffer> {
  const shift = opts.pitchShift ?? 0;
  const provider = getTtsProvider();
  const key = cacheKey(text, voice, shift);
  const hit = ttsCache.get(key);
  if (hit) return hit;

  let buf: Buffer;
  if (provider === "google") {
    let useGoogle = false;
    try {
      if (isOverCutoff(text.length)) {
        console.warn(
          "[TTS] cutoff terlampaui → fallback Edge-TTS (Google gak di-charge)"
        );
      } else {
        // Catat pemakaian DULU. Record cuma update counter lokal; kalau gagal
        // (jarang) kita tetep lanjut fallback edge biar podcast gak mati.
        recordChars(text.length);
        useGoogle = true;
      }
    } catch (err) {
      console.warn("[TTS] cutoff check error, lanjut fallback edge:", err);
    }

    if (useGoogle) {
      try {
        buf = await synthesizeGoogle(text, voice);
      } catch (err) {
        console.warn(
          "[TTS] Google gagal, fallback ke Edge-TTS:",
          err instanceof Error ? err.message : err
        );
        buf = await synthesizeEdge(text, googleVoiceToEdge(voice), shift);
      }
    } else {
      buf = await synthesizeEdge(text, googleVoiceToEdge(voice), shift);
    }
  } else {
    buf = await synthesizeEdge(text, voice, shift);
  }

  if (ttsCache.size >= CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    if (oldest !== undefined) ttsCache.delete(oldest);
  }
  ttsCache.set(key, buf);
  return buf;
}
