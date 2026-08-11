import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

const NEEDMCP_URL = "https://needmcp.com/mcp";

// Bentuk minimal hasil tool call MCP — responsenya gak di-type oleh SDK
type ToolResult = {
  content?: Array<{ text?: string }>;
  structuredContent?: unknown;
};

type StyleItem = {
  slug?: unknown;
  name?: unknown;
  styleSlug?: unknown;
};

export type NeedMCPConnection = {
  client: MCPClient;
  tools: Awaited<ReturnType<MCPClient["tools"]>>;
  close: () => Promise<void>;
};

// Returns null (never throws) when no key or on connect failure → graceful no-op.
// Never cache at module scope: MCP session state (select-style-tool lock) is
// per-connection, jadi bikin client baru per request dan close kalo udah selesai.
export async function connectNeedMCP(): Promise<NeedMCPConnection | null> {
  const apiKey = process.env.NEEDMCP_API_KEY;
  if (!apiKey) return null;

  try {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: NEEDMCP_URL,
        headers: { "X-API-Key": apiKey },
      },
    });
    const tools = await client.tools();

    let closed = false;
    return {
      client,
      tools,
      close: async () => {
        if (closed) return; // idempotent — finally + cancel() bisa dua-duanya kepanggil
        closed = true;
        await client.close();
      },
    };
  } catch (err) {
    console.error("[NeedMCP] connect failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// Host-mediated call — dipake buat pre-lock style & feedback
export async function callNeedMCPTool(
  client: MCPClient,
  name: string,
  args: Record<string, unknown> = {}
) {
  return client.callTool({ name, arguments: args });
}

// Section design-system YAML yang berguna buat grounding prompt (skip components yg gede).
const TOKEN_SECTIONS = new Set([
  "colors",
  "colors-dark",
  "typography",
  "spacing",
  "rounded",
  "display-xl",
  "display-lg",
  "body-md",
  "body-sm",
  "button-md",
  "button-sm",
  "caption",
  "code-md",
]);

// Pre-fetch design tokens buat style tertentu (get-design-system-tool) dan
// ekstrak versi ringkas (colors, typography, spacing, rounded) buat di-inject
// langsung ke prompt — biar output grounded walau model-nya gak reliable pake tools.
// Response shape (verified): content[0].text = JSON `{ styleSlug, designSystem: "<yaml>" }`.
export async function fetchDesignSystemBrief(
  client: MCPClient,
  styleSlug: string
): Promise<string | null> {
  try {
    const res = await client.callTool({
      name: "get-design-system-tool",
      arguments: { styleSlug },
    });
    const toolRes = res as unknown as ToolResult;
    let parsed: unknown = toolRes.structuredContent ?? toolRes.content?.[0]?.text;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    const yaml: unknown = (parsed as { designSystem?: unknown })?.designSystem;
    if (typeof yaml !== "string" || !yaml.trim()) return null;

    // Ambil cuma section token yang berguna, potong di batas section (bukan motong nilai)
    const lines = yaml.split("\n");
    const out: string[] = [];
    let keep = false;
    for (const line of lines) {
      const top = line.match(/^([a-zA-Z][\w-]*):\s*$/);
      if (top) keep = TOKEN_SECTIONS.has(top[1]);
      if (keep) out.push(line);
    }
    const brief = out.join("\n");
    return brief.length > 6000 ? brief.slice(0, 6000) : brief;
  } catch (err) {
    console.error("[NeedMCP] fetch design system brief failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// Buat style picker: list semua style yang tersedia dari get-styles-tool.
// Response shape (verified live): CallToolResult.content[0].text = JSON string
// `{ data: [{ id, name, slug, category, componentsCount }], pagination }`.
export async function listNeedMCPStyles(): Promise<{ slug: string; name: string }[]> {
  const conn = await connectNeedMCP();
  if (!conn) return [];

  try {
    const res = await conn.client.callTool({
      name: "get-styles-tool",
      arguments: { page: 1, limit: 50 },
    });
    const toolRes = res as unknown as ToolResult;

    // Normalize list style dari berbagai shape yang mungkin dikeluarin server.
    // Prefer raw text (sering berisi full list) dari pada structuredContent.
    const extract = (raw: unknown): unknown[] => {
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return [];
        }
      }
      if (Array.isArray(raw)) return raw;
      const data = (raw as { data?: unknown })?.data;
      if (Array.isArray(data)) return data;
      if ((raw as { styleSlug?: unknown })?.styleSlug) return [raw]; // single style object
      return [];
    };

    const fromText = extract(toolRes.content?.[0]?.text);
    const fromStructured = extract(toolRes.structuredContent);
    // Pilih yang paling banyak item-nya (biasanya text = full list)
    const list = fromText.length >= fromStructured.length ? fromText : fromStructured;

    if (list.length === 0) {
      console.error("[NeedMCP] unexpected get-styles-tool result:", JSON.stringify(toolRes).slice(0, 400));
      return [];
    }

    return (list as StyleItem[])
      .map((s) => ({
        slug: String(s?.slug ?? s?.styleSlug ?? ""),
        name: String(s?.name ?? s?.slug ?? s?.styleSlug ?? ""),
      }))
      .filter((s) => s.slug);
  } catch (err) {
    console.error("[NeedMCP] list styles failed:", (err as Error)?.message ?? err);
    return [];
  } finally {
    await conn.close();
  }
}
