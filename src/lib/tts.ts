import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// ─── Edge-TTS wrapper ───────────────────────────────────────────────
// Bikin mp3 dari teks pake Microsoft Edge neural voices (gratis, no API key).
// Kalau butuh suara beda dari voice yang sama, dipitch-shift via ffmpeg.

export interface TtsOptions {
  /** Semitone shift (negatif = lebih dalam, positif = lebih tinggi). 0 = normal. */
  pitchShift?: number;
}

// Cache in-memory (hash key = voice + pitch + teks) biar replay/ulang gratis.
// Cap sederhana biar gak bocor memory di sesi panjang.
const CACHE_MAX = 200;
const ttsCache = new Map<string, Buffer>();

const PYTHON = process.env.EDGE_TTS_PYTHON ?? "python3";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const MAX_RETRIES = 2;

function cacheKey(text: string, voice: string, shift: number): string {
  return `${voice}|${shift}|${text}`;
}

/**
 * Synthesize text jadi mp3 buffer.
 * 1. tulis teks ke temp file → `python3 -m edge_tts --file <txt> --voice <v> --write-media <mp3>`
 * 2. kalau pitchShift != 0 → ffmpeg asetrate/aresample/atempo (turunin pitch tanpa ubah durasi)
 * 3. baca buffer, bersihin temp, cache.
 */
export async function synthesize(
  text: string,
  voice: string,
  opts: TtsOptions = {}
): Promise<Buffer> {
  const shift = opts.pitchShift ?? 0;
  const key = cacheKey(text, voice, shift);
  const hit = ttsCache.get(key);
  if (hit) return hit;

  const dir = await mkdtemp(join(tmpdir(), "wowo-tts-"));
  const txtPath = join(dir, "input.txt");
  const rawPath = join(dir, "raw.mp3");
  const outPath = join(dir, "out.mp3");
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
        // Jeda kecil antar retry biar endpoint Microsoft gak kena rate-limit
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;

    let finalPath = rawPath;
    if (shift !== 0) {
      // Asetrate turunin pitch, aresample normalisasi sample rate, atempo balikin durasi.
      const factor = Math.pow(2, -shift / 12);
      const atempo = 1 / factor;
      const filter = `asetrate=48000*${factor.toFixed(6)},aresample=44100,atempo=${atempo.toFixed(6)}`;
      await execFileAsync(
        FFMPEG,
        ["-y", "-loglevel", "error", "-i", rawPath, "-af", filter, outPath],
        { timeout: 30000 }
      );
      finalPath = outPath;
    }

    const buf = await readFile(finalPath);
    if (ttsCache.size >= CACHE_MAX) {
      const oldest = ttsCache.keys().next().value;
      if (oldest !== undefined) ttsCache.delete(oldest);
    }
    ttsCache.set(key, buf);
    return buf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
