import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import {
  analyzeFile,
  AttachmentValidationError,
  buildUserContentParts,
  MAX_FILES,
  pickModelConfig,
  type AnalyzedAttachment,
} from "@/lib/attachments";

export const dynamic = "force-dynamic";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request harus multipart/form-data" },
      { status: 400 }
    );
  }

  // ─── Parse messages (JSON string di field "messages") ────────
  const messagesStr = formData.get("messages");
  if (typeof messagesStr !== "string" || !messagesStr.trim()) {
    return NextResponse.json(
      { error: "messages wajib dikirim (JSON string)" },
      { status: 400 }
    );
  }

  let messages: unknown;
  try {
    messages = JSON.parse(messagesStr);
  } catch {
    return NextResponse.json({ error: "Invalid JSON messages" }, { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages harus array dengan minimal 1 item" },
      { status: 400 }
    );
  }

  // ─── Parse replyTo (optional) ────────────────────────────────
  const replyToStr = formData.get("replyTo");
  let replyTo: { content?: unknown } | null = null;
  if (typeof replyToStr === "string" && replyToStr.trim()) {
    try {
      replyTo = JSON.parse(replyToStr);
    } catch {}
  }

  // ─── Parse & analisa files ───────────────────────────────────
  const files = formData
    .getAll("files")
    .filter((e): e is File => typeof e !== "string");

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_FILES} file per pesan` },
      { status: 400 }
    );
  }

  let analyzed: AnalyzedAttachment[] = [];
  if (files.length > 0) {
    try {
      analyzed = await Promise.all(files.map((f) => analyzeFile(f)));
    } catch (err) {
      if (err instanceof AttachmentValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("Analyze attachment error:", err);
      return NextResponse.json({ error: "Gagal memproses file" }, { status: 400 });
    }
  }

  const hasImage = analyzed.some((a) => a.kind === "image");

  // ─── Pilih model: vision kalau ada gambar, text model untuk biasa ─
  const config = pickModelConfig(hasImage);
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 400 });
  }
  const { openai, modelName } = config;

  // ─── Bangun ulang konten pesan user terakhir jadi parts ──────
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (!last || last.role !== "user") {
    return NextResponse.json(
      { error: "Pesan terakhir harus dari user" },
      { status: 400 }
    );
  }

  // Inject reply reference — kasih tau AI bahwa user mereferensi pertanyaan sebelumnya
  const replyPrefix =
    replyTo?.content && typeof replyTo.content === "string" && replyTo.content.trim()
      ? `[User mereferensi pertanyaan sebelumnya: "${replyTo.content}"]\n\n`
      : "";

  const parts = buildUserContentParts({
    userText: typeof last.content === "string" ? last.content : "",
    replyPrefix,
    attachments: analyzed,
  });

  if (parts.length === 0) {
    return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
  }

  const finalMessages = [...messages];
  finalMessages[lastIdx] = { ...last, content: parts };

  // ─── Stream response dari LLM ────────────────────────────────
  try {
    const result = streamText({
      model: openai.chat(modelName),
      messages: finalMessages,
      maxRetries: 0,
    });

    // Ambil stream aslinya dulu biar error-nya ketangkep
    const textStream = result.textStream;
    if (!textStream) {
      return NextResponse.json(
        { error: "Gagal bikin stream dari LLM" },
        { status: 502 }
      );
    }

    // Convert stream async iterator ke ReadableStream,
    // plus error handling biar error apapun kaga tembus ke client
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of textStream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (err) {
          console.error("LLM stream error:", err);
          const msg = errorMessage(err);
          const errMsg = msg.includes("Cannot connect")
            ? "LLM endpoint unreachable. Cek LLM_BASE_URL & koneksi jaringan."
            : msg.includes("401")
            ? "LLM API key invalid. Cek LLM_API_KEY."
            : msg.includes("404")
            ? "LLM endpoint atau model not found. Cek URL & LLM_MODEL."
            : msg.includes("Cannot read properties")
            ? "LLM ngasih response format yang gak sesuai. Cek kompatibilitas model."
            : `LLM error: ${msg || "Unknown error"}`;
          // Kirim error message sebagai teks di stream biar user liat
          controller.enqueue(
            new TextEncoder().encode(`\n\n_❌ ${errMsg}_`)
          );
        } finally {
          // Stream harus ditutup biar client gak nunggu forever
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
    console.error("LLM setup error:", error);
    return NextResponse.json(
      { error: `LLM error: ${errorMessage(error)}` },
      { status: 502 }
    );
  }
}
