import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { prisma } from "@/lib/prisma";
import {
  connectNeedMCP,
  fetchDesignSystemBrief,
  type NeedMCPConnection,
} from "@/lib/needmcp";
import {
  analyzeFile,
  AttachmentValidationError,
  buildUserContentParts,
  MAX_FILES,
  pickModelConfig,
  type AnalyzedAttachment,
} from "@/lib/attachments";
import {
  getMaxVisionPdfPages,
  renderPdfPages,
  type ResolvedPdf,
} from "@/lib/documentRouter";
import { runPaddleOcr } from "@/lib/ocrClient";
import { embeddingEnabled } from "@/lib/embeddings";
import {
  findIndexedAttachment,
  retrieveChunks,
  RETRIEVAL_MIN_CHUNKS,
  RETRIEVAL_TOP_K,
} from "@/lib/retrieval";
import type { RetrievalSource } from "@/lib/types";
import { ThinkingSplitter } from "@/lib/thinkStream";

export const dynamic = "force-dynamic";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Gabung halaman chunk jadi string singkat buat kutip sumber.
// Contoh: [1,2,3,3,5,7] → "1-3, 5, 7"
function summarizePages(
  hits: Array<{ pageStart: number; pageEnd: number }>
): string {
  const ranges: Array<[number, number]> = [];
  const sorted = [...hits].sort((a, b) => a.pageStart - b.pageStart);
  for (const h of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && h.pageStart <= last[1] + 1) {
      last[1] = Math.max(last[1], h.pageEnd);
    } else {
      ranges.push([h.pageStart, h.pageEnd]);
    }
  }
  return ranges.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(", ");
}

// Deteksi error "model/server gak support function calling" biar bisa retry tanpa tools
function looksLikeToolError(err: unknown): boolean {
  const msg = `${(err as Error)?.message ?? ""}`.toLowerCase();
  return /tool|function/.test(msg);
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

  // ─── Parse field designer (multipart) ────────────────────────
  const designerStr = formData.get("designer");
  const designer = designerStr === "true" || designerStr === "1";

  let designerContext: {
    pages?: Array<{ number: number; name: string; html: string }>;
    activePage?: string | null;
    activeSection?: string | null;
    chatHistory?: string[];
  } | null = null;
  const dcStr = formData.get("designerContext");
  if (typeof dcStr === "string" && dcStr.trim()) {
    try {
      designerContext = JSON.parse(dcStr);
    } catch {}
  }

  const sessionIdVal = formData.get("sessionId");
  const sessionId =
    typeof sessionIdVal === "string" && sessionIdVal ? sessionIdVal : null;
  const designStyleVal = formData.get("designStyle");
  const designStyle =
    typeof designStyleVal === "string" && designStyleVal ? designStyleVal : null;

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

  // ─── Retrieval mode: dokumen besar yang udah ke-index → jawab dari chunk ──
  // Dokumen besar (index ≥ RETRIEVAL_MIN_CHUNKS chunk) dijawab dari potongan
  // yang relevan sama pertanyaan, BUKAN nge-stuff seluruh teks ke konteks.
  // Cuma dokumen yang cocok sama attachment ready di DB (filename+size+type) —
  // ini berarti file-nya udah di-upload & di-index pipeline background.
  const questionText = (() => {
    const li = messages.length - 1;
    const lm = messages[li];
    return lm && lm.role === "user" && typeof lm.content === "string"
      ? lm.content
      : "";
  })();
  const retrievalMap = new Map<string, string>(); // filename → kutipan retrieved
  const sources: RetrievalSource[] = []; // filename → halaman (dikirim via header x-retrieval-sources)
  if (sessionId && embeddingEnabled() && questionText.trim()) {
    const sid = String(sessionId);
    for (const a of analyzed) {
      if (a.kind === "image") continue;
      try {
        const db = await findIndexedAttachment({
          sessionId: sid,
          filename: a.filename,
          size: a.size,
          mimeType: a.mimeType,
        });
        // Kecil → teks lengkap inline lebih baik (exact). Baru retrieve kalau beneran besar.
        if (!db || db._count.chunks < RETRIEVAL_MIN_CHUNKS) continue;
        const hits = await retrieveChunks({
          sessionId: sid,
          attachmentId: db.id,
          question: questionText,
          topK: RETRIEVAL_TOP_K,
        });
        if (hits.length === 0) continue;
        sources.push({ filename: a.filename, pages: summarizePages(hits) });
        retrievalMap.set(
          a.filename,
          hits
            .map(
              (h) =>
                `[Dokumen: ${h.filename} — halaman ${h.pageStart}` +
                (h.pageEnd !== h.pageStart ? `-${h.pageEnd}` : "") +
                `]\n${h.text}`
            )
            .join("\n\n")
        );
      } catch (err) {
        console.error(`[Retrieval] gagal buat "${a.filename}":`, err);
      }
    }
  }

  // ─── Resolve PDF scan: render halaman → vision, atau → OCR service ──
  // Document Router udah nge-route di analyzeFile (route: native/vision/ocr).
  // native → teks langsung (jalur default). Di sini cuma handle yang
  // butuh render: vision → gambar halaman; ocr → PaddleOCR (fallback vision).
  // PDF yang udah ke-index & di-handle via retrievalMap di-skip — gak perlu
  // render/OCR ulang.
  const OCR_BASE_URL = process.env.OCR_BASE_URL?.trim();
  const OCR_LANG = process.env.OCR_LANGUAGE?.trim() || "ch";
  const maxPages = getMaxVisionPdfPages();

  const resolvedPdfs: ResolvedPdf[] = [];
  for (const a of analyzed.filter(
    (x) =>
      x.kind === "pdf" &&
      x.route &&
      x.route !== "native" &&
      !retrievalMap.has(x.filename)
  )) {
    try {
      const pages = await renderPdfPages(a.data, { maxPages });
      if (pages.length === 0) continue;

      if (a.route === "ocr" && OCR_BASE_URL) {
        try {
          const ocrPages = await runPaddleOcr(pages, OCR_BASE_URL, OCR_LANG);
          const ocrText = ocrPages.map((p) => p.text).filter(Boolean).join("\n\n");
          resolvedPdfs.push({
            filename: a.filename,
            route: "ocr",
            pageCount: a.profile?.pageCount,
            pages,
            ocrText,
            ocrConfidence:
              ocrPages.length > 0
                ? ocrPages.reduce((s, p) => s + p.confidence, 0) / ocrPages.length
                : undefined,
          });
          continue;
        } catch (err) {
          console.error(
            `[DocumentRouter] OCR gagal buat "${a.filename}", fallback ke vision:`,
            err instanceof Error ? err.message : err
          );
        }
      }

      // vision (atau ocr yang fallback)
      console.log(
        `[DocumentRouter] "${a.filename}" → ${a.route}: render ${pages.length} halaman ke vision`
      );
      resolvedPdfs.push({
        filename: a.filename,
        route: "vision",
        pageCount: a.profile?.pageCount,
        pages,
      });
    } catch (err) {
      console.error(
        `[DocumentRouter] Gagal render "${a.filename}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const needsVision = hasImage || resolvedPdfs.some((p) => p.route === "vision");

  // ─── Pilih model: vision kalau butuh lihat gambar, text model untuk biasa ─
  const config = pickModelConfig(needsVision);
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 400 });
  }
  const { openai, modelName } = config;

  // ─── Bangun ulang konten pesan user terakhir ─────────────────
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (!last || last.role !== "user") {
    return NextResponse.json(
      { error: "Pesan terakhir harus dari user" },
      { status: 400 }
    );
  }

  const userText = typeof last.content === "string" ? last.content : "";
  const finalMessages = [...messages];

  // Inject reply reference — kasih tau AI bahwa user mereferensi pertanyaan sebelumnya
  const replyPrefix =
    replyTo?.content && typeof replyTo.content === "string" && replyTo.content.trim()
      ? `[User mereferensi pertanyaan sebelumnya: "${replyTo.content}"]\n\n`
      : "";

  // Designer mode: inject canvas state + chat history biar AI paham konteksnya
  if (designer && designerContext?.pages?.length) {
    const canvasBlock = designerContext.pages
      .map(
        (p) => `Page ${p.number} (${p.name}):\n\`\`\`html\n${p.html}\n\`\`\``
      )
      .join("\n\n");

    const chatBlock = designerContext.chatHistory?.length
      ? `\n\n[Recent conversation]\n${designerContext.chatHistory.join("\n")}`
      : "";

    const activeSection =
      designerContext?.activeSection && typeof designerContext.activeSection === "string"
        ? designerContext.activeSection
        : null;

    const sectionBlock = activeSection
      ? `\n\n[ACTIVE SECTION — the section the user is currently working on]\n${activeSection}\n` +
        `If the user's request does NOT name a section, assume they still mean this section and apply the change to it.`
      : "";

    const contextPrompt =
      `[CURRENT CANVAS STATE — the pages currently on the designer canvas]\n` +
      canvasBlock +
      sectionBlock +
      chatBlock +
      `\n\n[USER REQUEST]\n${userText}`;

    finalMessages[lastIdx] = { ...last, content: contextPrompt };
  } else {
    // Chat mode: gabung teks user + dokumen + reply reference → parts
    const parts = buildUserContentParts({
      userText,
      replyPrefix,
      attachments: analyzed,
      resolvedPdfs,
      retrievalContext: [...retrievalMap.values()].join("\n\n"),
      retrievalNames:
        retrievalMap.size > 0 ? new Set(retrievalMap.keys()) : undefined,
    });

    if (parts.length === 0) {
      return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
    }

    finalMessages[lastIdx] = { ...last, content: parts };
  }

  // ─── NeedMCP integration ───────────────────────────────────
  // Style yang lagi di-lock: DB adalah sumber kebenaran, body designStyle cuma hint
  let lockedStyle: string | null = designStyle;
  if (process.env.NEEDMCP_API_KEY && sessionId) {
    try {
      const s = await prisma.session.findUnique({
        where: { id: String(sessionId) },
        select: { designStyle: true },
      });
      if (s?.designStyle) lockedStyle = s.designStyle;
    } catch (err) {
      console.error("[NeedMCP] read designStyle failed:", errorMessage(err));
    }
  }

  // NeedMCP cuma AKTIF kalau ada style yang di-lock (dipilih manual via dropdown)
  const needsMCP = !!process.env.NEEDMCP_API_KEY && !!lockedStyle;

  // Connect NeedMCP + pre-lock style + pre-fetch design tokens
  let mcp: NeedMCPConnection | null = null;
  let tokenBrief: string | null = null;
  if (needsMCP) {
    mcp = await connectNeedMCP();
    if (mcp && lockedStyle) {
      try {
        await mcp.client.callTool({
          name: "select-style-tool",
          arguments: { selected: lockedStyle },
        });
        console.log("[NeedMCP] pre-locked style:", lockedStyle);
      } catch (err) {
        console.error("[NeedMCP] pre-lock failed:", errorMessage(err));
      }
      tokenBrief = await fetchDesignSystemBrief(mcp.client, lockedStyle);
      if (tokenBrief) console.log("[NeedMCP] design tokens loaded:", tokenBrief.length, "chars");
    }
  }

  // System prompt: guide AI buat generate HTML standalone
  const INSTRUCTIONS = designer
    ? "You are a web designer working on a multi-page canvas. " +
      (designerContext?.activePage
        ? `The user is currently editing page: ${designerContext.activePage}. `
        : "") +
      "The conversation contains the current canvas state (each page's name and full HTML). " +
      "Use it as context to understand existing pages and what to modify. " +
      "IMPORTANT: by default, MODIFY the user's currently active page (" +
      (designerContext?.activePage || "the last page") +
      ") by adding/changing sections WITHIN its existing HTML structure. " +
      "ONLY generate a brand-new page if the user EXPLICITLY asks to create/add a new page. " +
      "Do not create a new page when the user asks to 'add a section', 'tambah section', or modify an existing design. " +
      "If the user refers to a specific existing page (by 'page N' or its name), generate the COMPLETE updated HTML for THAT page. " +
      "SECTION-TARGETED EDITS: if the user targets a SPECIFIC section of the page " +
      "(e.g. 'section hero', 'ubah bagian testimonial', 'edit navbar', or describes a specific heading/text in the page), " +
      "ONLY modify that one section's HTML. Preserve the rest of the page EXACTLY as-is — " +
      "keep the <head>, styles, and every other section byte-for-byte unchanged. " +
      "Surgical edits only; do not restructure, rewrite, or regenerate sections the user did not mention. " +
      "SECTION CONTINUITY: the conversation may include an '[ACTIVE SECTION]' note. " +
      "If the user's current request does NOT name a section, they are still referring to that active section — " +
      "apply the change there, not to the whole page. " +
      "Follow-up instructions like 'gambarnya nabrak, benerin' continue the previously named section. " +
      "Based on the user's request, generate ONE complete standalone HTML page (with embedded CSS or Tailwind CDN). " +
      "Use the Tailwind CSS CDN when useful: " +
      "<script src=\"https://cdn.tailwindcss.com\"></script> in the <head>. " +
      "The HTML must render standalone in a browser when opened directly. " +
      "Output ONLY the HTML inside a single fenced code block (```html ... ```). " +
      "Do NOT include any explanation, commentary, or additional text before or after the code block."
    : "You are wowo.ai — a GENERAL-PURPOSE AI assistant that helps with ANYTHING: " +
      "answering questions, explaining concepts, brainstorming, writing, analysis, math, " +
      "planning, coding in any language, and yes — also building web/UI designs when asked. " +
      "You are NOT limited to web/UI work. Always respond to the user's actual request in " +
      "plain, helpful prose (Bahasa Indonesia unless they switch languages). " +
      "Do NOT assume the user wants a website, landing page, or UI. Do NOT open with offers " +
      "to build landing pages/websites/UI designs. " +
      "HTML generation is an OPTIONAL capability: ONLY output HTML inside a single " +
      "fenced code block (```html ... ```) when the user EXPLICITLY asks to BUILD/CREATE/MAKE " +
      "a landing page, website, or UI design. " +
      "When you do generate HTML: use the Tailwind CSS CDN " +
      "(<script src=\"https://cdn.tailwindcss.com\"></script> in the <head>), " +
      "make it render standalone in a browser when opened directly, and write NO JavaScript " +
      "besides the Tailwind CDN script. Output a COMPLETE, fully-styled, production-ready page " +
      "with real content, colors, typography, and layout (NOT a wireframe). " +
      "Only output a wireframe mockup (light gray boxes, dashed borders, placeholder labels like " +
      "Navbar/Hero/Features/Footer) if the user EXPLICITLY asks for a WIREFRAME or MOCKUP.";

  // Tambahan guidance MCP: dikasih ke model cuma kalo tools-nya aktif
  const MCP_GUIDE = needsMCP
    ? "\n\nYou have access to NeedMCP design tools: get-styles-tool, get-design-system-tool, get-style-tokens-tool, " +
      "get-components-tool, get-layouts-tool, get-wireframes-tool, get-wireframe-tool, select-style-tool, send-feedback-tool. " +
      `Currently locked style: ${lockedStyle ?? "none"}. ` +
      "IMPORTANT: tool names use DASHES, not underscores (e.g. get-design-system-tool, get-style-tokens-tool). " +
      "Discover available styles with get-styles-tool first (slugs look like the locked style, e.g. a brand slug). " +
      "Use get-design-system-tool, get-style-tokens-tool, and get-components-tool (passing the locked styleSlug) " +
      "to ground colors, typography, spacing, and components — never invent design tokens. " +
      "Use get-wireframe-tool / get-layouts-tool for layout/structure references when the user asks for a wireframe or structure. " +
      "To change the design language, call select-style-tool({ selected: <slug> }) first; the choice is saved. " +
      "Keep the existing output rules (single ```html block)." +
      (tokenBrief
        ? `\n\n[LOCKED STYLE DESIGN TOKENS — use these EXACT values for colors, typography, spacing, and radii]\n${tokenBrief}`
        : "")
    : "";
  const INSTRUCTIONS_MCP = INSTRUCTIONS + MCP_GUIDE;

  // ─── Stream response dari LLM ────────────────────────────────
  try {
    // Kalau model milih style lain via select-style-tool, simpan ke session
    const onStepEnd = async (event: {
      toolCalls?: Array<{ toolName?: string; input?: unknown }>;
    }) => {
      try {
        const sel = event.toolCalls?.find(
          (tc) => tc.toolName === "select-style-tool"
        );
        const selected = (sel?.input as { selected?: string } | undefined)?.selected;
        if (selected && sessionId && selected !== lockedStyle) {
          await prisma.session.update({
            where: { id: String(sessionId) },
            data: { designStyle: String(selected) },
          });
          lockedStyle = selected;
          console.log("[NeedMCP] persisted style:", lockedStyle);
        }
      } catch (err) {
        console.error("[NeedMCP] persist style failed:", errorMessage(err));
      }
    };

    // Beberapa model hallucinate nama tool (underscore vs dash), e.g. get_style_tokens_tool.
    // Kalau tool gak ketemu, repair nama-nya ke bentuk dash biar tool-nya tetep kejalanin.
    const repairToolCall = async (options: {
      toolCall: LanguageModelV4ToolCall;
      tools: Record<string, unknown>;
    }): Promise<LanguageModelV4ToolCall | null> => {
      const { toolCall, tools } = options;
      const corrected = toolCall.toolName.replace(/_/g, "-");
      if (corrected && corrected !== toolCall.toolName && tools[corrected]) {
        console.log("[NeedMCP] repaired tool name:", toolCall.toolName, "→", corrected);
        return { ...toolCall, toolName: corrected };
      }
      return null;
    };

    // Tools aktif → INSTRUCTIONS_MCP + tools; kaga → INSTRUCTIONS polos (behavior lama)
    const buildStream = (useTools: boolean) =>
      streamText({
        model: openai.chat(modelName),
        messages: finalMessages,
        instructions: useTools ? INSTRUCTIONS_MCP : INSTRUCTIONS,
        tools: useTools && mcp ? mcp.tools : undefined,
        maxRetries: 0,
        abortSignal: req.signal,
        ...(useTools && mcp ? { onStepEnd, repairToolCall } : {}),
      });

    // Convert stream async iterator ke ReadableStream.
    // Tiap chunk dilewatkan ke ThinkingSplitter: blok <think> dipisah jadi
    // event "think" (UI toggle "Pemikiran wowo"), sisanya event "answer".
    // Error handling biar error apapun kaga tembus ke client.
    const splitter = new ThinkingSplitter();
    const enc = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        const enqueueEvent = (ev: { type: "think" | "answer"; text: string }) => {
          controller.enqueue(enc.encode(`data:${JSON.stringify(ev)}\n\n`));
        };
        let attemptTools = !!mcp;
        let emittedAny = false;
        try {
          while (true) {
            try {
              const result = buildStream(attemptTools);
              for await (const chunk of result.textStream) {
                if (typeof chunk === "string" && chunk) {
                  emittedAny = true;
                  for (const ev of splitter.transform(chunk)) enqueueEvent(ev);
                }
              }
            } catch (err) {
              // Model/server gak support function calling → retry sekali tanpa tools
              if (attemptTools && !emittedAny && looksLikeToolError(err)) {
                console.error("[NeedMCP] tools unsupported, retrying without:", errorMessage(err));
                attemptTools = false;
                continue;
              }
              throw err;
            }

            // Stream kelar tapi gak ada teks sama sekali pas tools aktif
            if (attemptTools && !emittedAny) {
              console.error("[NeedMCP] empty stream with tools, retrying without");
              attemptTools = false;
              continue;
            }
            break;
          }
          for (const ev of splitter.flush()) enqueueEvent(ev);
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
          // Kirim error message sebagai teks di stream biar user lihat
          enqueueEvent({ type: "answer", text: `\n\n_❌ ${errMsg}_` });
        } finally {
          // Sinyal akhir stream biar client tahu udah kelar.
          try { controller.enqueue(enc.encode("data:[DONE]\n\n")); } catch {}
          // Stream harus ditutup biar client gak nunggu forever
          try { await mcp?.close(); } catch {}
          try { controller.close(); } catch {}
        }
      },
      cancel() {
        // Client abort mid-stream → teardown MCP session
        void mcp?.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-llm-model": modelName,
        // Sumber RAG (filename + halaman) — client nampilin note di bawah jawaban
        "x-retrieval-sources":
          sources.length > 0 ? JSON.stringify(sources) : "",
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
