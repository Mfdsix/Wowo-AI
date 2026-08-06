import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import {
  connectNeedMCP,
  fetchDesignSystemBrief,
  type NeedMCPConnection,
} from "@/lib/needmcp";

export const dynamic = "force-dynamic";

// Deteksi error "model/server gak support function calling" biar bisa retry tanpa tools
function looksLikeToolError(err: unknown): boolean {
  const msg = `${(err as Error)?.message ?? ""}`.toLowerCase();
  return /tool|function/.test(msg);
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, replyTo, designer, designerContext, sessionId, designStyle } = body;

  // Section yang lagi fokus — biar follow-up ("gambarnya nabrak, benerin")
  // otomatis lanjut ke section yang sama, bukan dianggap whole page.
  const activeSection =
    designerContext?.activeSection && typeof designerContext.activeSection === "string"
      ? designerContext.activeSection
      : null;

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

  // ─── Designer mode: inject canvas state + chat history ────
  // biar AI paham apa yang lagi ada di canvas (layer + HTML) & konteks percakapan
  if (designer && designerContext?.pages?.length) {
    const lastIdx = finalMessages.length - 1;
    const lastUser = finalMessages[lastIdx];

    const canvasBlock = designerContext.pages
      .map(
        (p: { number: number; name: string; html: string }) =>
          `Page ${p.number} (${p.name}):\n\`\`\`html\n${p.html}\n\`\`\``
      )
      .join("\n\n");

    const chatBlock = designerContext.chatHistory?.length
      ? `\n\n[Recent conversation]\n${designerContext.chatHistory.join("\n")}`
      : "";

    const sectionBlock = activeSection
      ? `\n\n[ACTIVE SECTION — the section the user is currently working on]\n${activeSection}\n` +
        `If the user's request does NOT name a section, assume they still mean this section and apply the change to it.`
      : "";

    const contextPrompt =
      `[CURRENT CANVAS STATE — the pages currently on the designer canvas]\n` +
      canvasBlock +
      sectionBlock +
      chatBlock +
      `\n\n[USER REQUEST]\n${lastUser.content}`;

    if (lastIdx >= 0) {
      finalMessages[lastIdx] = { ...lastUser, content: contextPrompt };
    }
  }

  // ─── NeedMCP integration ───────────────────────────────────
  // Style yang lagi di-lock: DB adalah sumber kebenaran, body designStyle cuma hint
  // (fallback kalo client gak kirim sessionId).
  let lockedStyle: string | null =
    typeof designStyle === "string" && designStyle ? designStyle : null;
  if (process.env.NEEDMCP_API_KEY && sessionId) {
    try {
      const s = await prisma.session.findUnique({
        where: { id: String(sessionId) },
        select: { designStyle: true },
      });
      if (s?.designStyle) lockedStyle = s.designStyle;
    } catch (err) {
      console.error("[NeedMCP] read designStyle failed:", (err as Error)?.message ?? err);
    }
  }

  // NeedMCP cuma AKTIF kalau ada style yang di-lock (dipilih manual via dropdown).
  // Default (tanpa style) → gak connect NeedMCP, tools gak dipasang,
  // model pake bawaan/design system sendiri.
  const needsMCP = !!process.env.NEEDMCP_API_KEY && !!lockedStyle;

  // ─── Connect NeedMCP + pre-lock style + pre-fetch design tokens ───
  // Dilakuin SEBELUM nyusun instructions biar token brief bisa di-inject ke prompt.
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
        console.error("[NeedMCP] pre-lock failed:", (err as Error)?.message ?? err);
      }
      // Pre-fetch design tokens → di-inject ke prompt biar output grounded
      // walau model gak bisa ngerampungin tool-call loop.
      tokenBrief = await fetchDesignSystemBrief(mcp.client, lockedStyle);
      if (tokenBrief) console.log("[NeedMCP] design tokens loaded:", tokenBrief.length, "chars");
    }
  }

  // System prompt: guide AI buat generate HTML standalone
  // NOTE: AI SDK v7 GAK terima role "system" di messages — harus pake option `instructions`
  const INSTRUCTIONS = designer
    ? // Designer mode: satu halaman HTML, output HANYA code block (mudah di-extract)
      "You are a web designer working on a multi-page canvas. " +
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
    : // Chat mode: general HTML generation instruction
      "You can generate HTML files for the user. Always output your HTML inside a single " +
      "HTML fenced code block (```html ... ```). " +
      "You MAY use Tailwind CSS via CDN by including: " +
      "<script src=\"https://cdn.tailwindcss.com\"></script> in the <head>. " +
      "The HTML must render standalone in a browser when opened directly. " +
      "Do NOT write any JavaScript besides the Tailwind CDN script. " +
      "IMPORTANT — follow the user's intent exactly: " +
      "If the user asks to BUILD/CREATE/MAKE a landing page, website, or UI design, " +
      "output a COMPLETE, fully-styled, production-ready page with real content, colors, typography, and layout " +
      "(NOT a wireframe). " +
      "Only output a wireframe mockup (light gray boxes, dashed borders, placeholder labels like Navbar/Hero/Features/Footer) " +
      "if the user EXPLICITLY asks for a WIREFRAME or MOCKUP.";

  // Tambahan guidance MCP: dikasih ke model cuma kalo tools-nya aktif.
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

  const openai = createOpenAI({
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    apiKey: process.env.LLM_API_KEY || "",
  });

  const modelName = process.env.LLM_MODEL || "gpt-3.5-turbo";

  try {
    // Kalau model milih style lain via select-style-tool, simpan ke session
    const onStepEnd = async (event: any) => {
      try {
        const sel = event.toolCalls?.find(
          (tc: any) => tc.toolName === "select-style-tool"
        );
        if (sel?.input?.selected && sessionId && sel.input.selected !== lockedStyle) {
          await prisma.session.update({
            where: { id: String(sessionId) },
            data: { designStyle: String(sel.input.selected) },
          });
          lockedStyle = String(sel.input.selected);
          console.log("[NeedMCP] persisted style:", lockedStyle);
        }
      } catch (err) {
        console.error("[NeedMCP] persist style failed:", (err as Error)?.message ?? err);
      }
    };

    // Beberapa model hallucinate nama tool (underscore vs dash), e.g. get_style_tokens_tool.
    // Kalau tool gak ketemu, repair nama-nya ke bentuk dash biar tool-nya tetep kejalanin.
    const repairToolCall = async (options: any) => {
      const { toolCall, tools } = options;
      const corrected = toolCall?.toolName?.replace(/_/g, "-");
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

    // Convert stream async iterator ke ReadableStream,
    // plus error handling biar error apapun kaga tembus ke client
    const readableStream = new ReadableStream({
      async start(controller) {
        let attemptTools = !!mcp;
        let emittedAny = false;
        try {
          while (true) {
            try {
              const result = buildStream(attemptTools);
              for await (const chunk of result.textStream) {
                emittedAny = true;
                controller.enqueue(new TextEncoder().encode(chunk));
              }
            } catch (err: any) {
              // Model/server gak support function calling → retry sekali tanpa tools
              if (attemptTools && !emittedAny && looksLikeToolError(err)) {
                console.error("[NeedMCP] tools unsupported, retrying without:", err?.message);
                attemptTools = false;
                continue;
              }
              throw err;
            }

            // Stream kelar tapi gak ada teks sama sekali pas tools aktif
            // (mis. model cuma emit tool call terus gak lanjut) → retry tanpa tools
            if (attemptTools && !emittedAny) {
              console.error("[NeedMCP] empty stream with tools, retrying without");
              attemptTools = false;
              continue;
            }
            break;
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
