import { NextRequest, NextResponse } from "next/server";
import { synthesize } from "@/lib/tts";
import { sanitizeForTts } from "@/lib/podcast";
import { maybeSyncGoogleTtsUsage } from "@/lib/googleMonitoring";

export const dynamic = "force-dynamic";

// Allowlist suara — jaga biar client gak bisa synthesize voice sembarangan.
// Edge (Microsoft) + Google Cloud TTS WaveNet id-ID.
const ALLOWED_VOICES = new Set([
  "id-ID-ArdiNeural",
  "id-ID-GadisNeural",
  "id-ID-Wavenet-A",
  "id-ID-Wavenet-B",
  "id-ID-Wavenet-C",
  "id-ID-Wavenet-D",
]);

const MAX_TEXT_LENGTH = 3000;

export async function POST(req: NextRequest) {
  let body: { text?: unknown; voice?: unknown; pitchShift?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request harus JSON: { text, voice }" },
      { status: 400 }
    );
  }

  const text = typeof body.text === "string" ? sanitizeForTts(body.text) : "";
  const voice = typeof body.voice === "string" ? body.voice : "";
  const pitchShift =
    typeof body.pitchShift === "number" && Number.isFinite(body.pitchShift)
      ? body.pitchShift
      : 0;

  if (!text) {
    return NextResponse.json({ error: "text wajib diisi" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text terlalu panjang (maks ${MAX_TEXT_LENGTH} karakter)` },
      { status: 400 }
    );
  }
  if (!ALLOWED_VOICES.has(voice)) {
    return NextResponse.json(
      { error: `voice tidak dikenali: ${voice}` },
      { status: 400 }
    );
  }
  if (Math.abs(pitchShift) > 12) {
    return NextResponse.json(
      { error: "pitchShift maksimal ±12 semitone" },
      { status: 400 }
    );
  }

  try {
    // Reconcile usage dari Google secara berkala (lazy, lewat interval).
    // Fire-and-forget: gak nge-block TTS, gak bikin error kalau gagal.
    void maybeSyncGoogleTtsUsage();

    const audio = await synthesize(text, voice, { pitchShift });
    // Uint8Array baru (bukan Buffer) biar type-check sama BodyInit
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[TTS] synthesis error:", err);
    return NextResponse.json(
      { error: `TTS gagal: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
