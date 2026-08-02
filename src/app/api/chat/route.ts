import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, replyTo } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages harus array dengan minimal 1 item" },
      { status: 400 }
    );
  }

  // Inject reply reference — kasih tau AI bahwa user mereferensi pertanyaan sebelumnya
  let finalMessages = messages;
  if (replyTo?.content && typeof replyTo.content === "string" && replyTo.content.trim()) {
    finalMessages = [...messages];
    const lastIdx = finalMessages.length - 1;
    if (lastIdx >= 0 && finalMessages[lastIdx].role === "user") {
      finalMessages[lastIdx] = {
        ...finalMessages[lastIdx],
        content:
          `[User mereferensi pertanyaan sebelumnya: "${replyTo.content}"]\n\n` +
          finalMessages[lastIdx].content,
      };
    }
  }

  const openai = createOpenAI({
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    apiKey: process.env.LLM_API_KEY || "",
  });

  const modelName = process.env.LLM_MODEL || "gpt-3.5-turbo";

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
        } catch (err: any) {
          console.error("LLM stream error:", err?.message || err);
          const errMsg = err?.message?.includes("Cannot connect")
            ? "LLM endpoint unreachable. Cek LLM_BASE_URL & koneksi jaringan."
            : err?.message?.includes("401")
            ? "LLM API key invalid. Cek LLM_API_KEY."
            : err?.message?.includes("404")
            ? "LLM endpoint atau model not found. Cek URL & LLM_MODEL."
            : err?.message?.includes("Cannot read properties")
            ? "LLM ngasih response format yang gak sesuai. Cek kompatibilitas model."
            : `LLM error: ${err?.message || "Unknown error"}`;
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
      },
    });
  } catch (error: any) {
    console.error("LLM setup error:", error?.message || error);
    return NextResponse.json(
      { error: `LLM error: ${error?.message || "Unknown error"}` },
      { status: 502 }
    );
  }
}
