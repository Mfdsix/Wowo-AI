import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { pickModelConfig } from "@/lib/attachments";
import {
  buildHistoryForModel,
  buildPodcastSystemPrompt,
  DEFAULT_PODCAST_CONFIG,
  SPEAKER_ORDER,
  type PodcastHistoryEntry,
  type Speaker,
} from "@/lib/podcast";

export const dynamic = "force-dynamic";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// POST /api/podcast/turn — generate SATU giliran bicara buat speaker tertentu.
// Body JSON: { sessionId, speaker, topic, history, note?, names? }
// History: array { role: "user"|"assistant", speaker?, content } — turn on-air + prompt/note user.
export async function POST(req: NextRequest) {
  let body: {
    sessionId?: unknown;
    speaker?: unknown;
    topic?: unknown;
    history?: unknown;
    note?: unknown;
    names?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request harus JSON" },
      { status: 400 }
    );
  }

  const speaker = body.speaker as Speaker;
  if (!SPEAKER_ORDER.includes(speaker)) {
    return NextResponse.json(
      { error: `speaker harus salah satu dari: ${SPEAKER_ORDER.join(", ")}` },
      { status: 400 }
    );
  }

  const topic =
    typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : "";
  const note =
    typeof body.note === "string" && body.note.trim() ? body.note.trim() : "";

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: PodcastHistoryEntry[] = rawHistory
    .filter(
      (h): h is PodcastHistoryEntry =>
        typeof h === "object" &&
        h !== null &&
        (h.role === "user" || h.role === "assistant") &&
        typeof h.content === "string"
    )
    .slice(-30); // cap konteks biar gak meledak di window

  // Nama speaker — dari request (frontend kirim sesuai podcastConfig session), fallback default.
  const names: Record<Speaker, string> = {
    ...DEFAULT_PODCAST_CONFIG.names,
    ...(body.names &&
    typeof body.names === "object" &&
    !Array.isArray(body.names)
      ? (body.names as Partial<Record<Speaker, string>>)
      : {}),
  };

  const systemPrompt = buildPodcastSystemPrompt(speaker, names, topic);

  const transcript = buildHistoryForModel(history, names);
  const userPrompt = [
    topic ? `Topik / awal diskusi:\n${topic}` : "",
    `Transkrip sejauh ini:\n${transcript}`,
    note ? `[CATATAN PRODUSER]: ${note}` : "",
    `Sekarang giliran ${names[speaker]}. Tulis ucapan dia.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const modelConfig = pickModelConfig(false);
  if ("error" in modelConfig) {
    return NextResponse.json({ error: modelConfig.error }, { status: 500 });
  }
  const openai = modelConfig.openai;
  const modelName =
    process.env.PODCAST_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    "gpt-3.5-turbo";

  try {
    // Simpan pilihan model di header supaya client bisa nampilin (dan persist ke message).
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const result = streamText({
            model: openai.chat(modelName),
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            maxRetries: 0,
            abortSignal: req.signal,
          });
          for await (const chunk of result.textStream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (err) {
          console.error("[Podcast] LLM stream error:", err);
          const msg = errorMessage(err);
          const errMsg = msg.includes("Cannot connect")
            ? "LLM endpoint unreachable. Cek LLM_BASE_URL & koneksi jaringan."
            : msg.includes("401")
              ? "LLM API key invalid. Cek LLM_API_KEY."
              : msg.includes("404")
                ? "LLM endpoint atau model not found. Cek URL & PODCAST_MODEL."
                : `LLM error: ${msg || "Unknown error"}`;
          controller.enqueue(
            new TextEncoder().encode(`\n\n_❌ ${errMsg}_`)
          );
        } finally {
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-llm-model": modelName,
      },
    });
  } catch (error) {
    console.error("[Podcast] setup error:", error);
    return NextResponse.json(
      { error: `LLM error: ${errorMessage(error)}` },
      { status: 502 }
    );
  }
}
