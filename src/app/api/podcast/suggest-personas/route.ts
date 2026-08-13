import { NextRequest, NextResponse } from "next/server";
import { isPlaceholderValue } from "@/lib/podcast";

export const dynamic = "force-dynamic";

// ─── Parsing bantu ─────────────────────────────────────────────────

// Buang blok reasoning yang kadang dibuka model (mis. qwen3.x nulis
// <think>...</think> berisi proses berpikir SEBELUM jawaban JSON).
function stripReasoningBlocks(text: string): string {
  let out = text
    // Hapus blok yang TERTUTUP: <think>...</think>, <thinking>, <reasoning>, [think]
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/\[think\][\s\S]*?\[\/think\]/gi, "")
    .trim();
  // Kalau masih ada tag pembuka yang TAK tertutup (model lupa nulis </think>),
  // buang mulai dari tag pembuka itu sampai akhir — kalau tidak, `{` di dalam
  // blok reasoning bisa salah tangkap sebagai awal JSON.
  const unclosed = out.match(/<(?:think|thinking|reasoning)>|\[think\]/i);
  if (unclosed && unclosed.index != null) {
    out = out.slice(0, unclosed.index).trim();
  }
  return out;
}

// Ambil object JSON pertama dari teks yang mungkin punya teks tambahan
// sebelum `{` atau setelah `}` (model suka nulis kalimat pembuka/penutup).
// Brace-matching manual: hormati string literal & escape supaya `}` di dalam
// string tidak dianggap penutup, dan teks sisa di luar object dibuang.
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function cleanSuggestion(value: unknown): string {
  if (typeof value !== "string") return "";
  return isPlaceholderValue(value) ? "" : value.trim();
}

// Ambil teks dari satu entri speaker. Model gak konsisten bentuknya:
//   - "Rahmadita Sari"                          (string langsung)
//   - { "name": "Rahmadita Sari" }              (object ber-name)
//   - { "name": "...", "persona": "..." }     (object lengkap)
function speakerValue(v: unknown): string {
  if (typeof v === "string") return cleanSuggestion(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return cleanSuggestion(o.name ?? o.nama);
  }
  return "";
}

// Normalisasi nilai names/personas ke { host, guestA, guestB }.
// Model gak selalu patuh: kadang balik object keyed ({"host": "..."}), kadang
// ARRAY ([host, guestA, guestB]), kadang flat tanpa wrapper, kadang nested
// ({"host": {"name": "...", "persona": "..."}}). Semua dipetakan.
function toSpeakerMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = { host: "", guestA: "", guestB: "" };
  if (Array.isArray(value)) {
    // Array → urut sesuai SPEAKER order
    out.host = speakerValue(value[0]);
    out.guestA = speakerValue(value[1]);
    out.guestB = speakerValue(value[2]);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    out.host = speakerValue(obj.host);
    out.guestA = speakerValue(obj.guestA ?? obj.guest_a);
    out.guestB = speakerValue(obj.guestB ?? obj.guest_b);
  }
  return out;
}

// ─── Panggil gateway LLM langsung ──────────────────────────────────
// Kenapa tidak lewat AI SDK streamText? Karena combo model reasoning
// (mis. qwen via OmniRoute) menulis blok <think> panjang yang bikin respons
// terpotong sebelum JSON keluar. Test live membuktikan request dengan
// stream:false balas JSON BERSIH. Sebagai jaring pengaman, kalau gateway
// tetap memaksa format SSE (beberapa provider tidak menghormati stream:false),
// respons diparse manual dua-duanya.
async function fetchChatText(opts: {
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<string> {
  const base = opts.baseURL.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      stream: false,
      // Perlu cukup besar: model hybrid-reasoning (mis. qwen via OmniRoute)
      // nulis blok <think> panjang DULU, baru JSON. Kalau terlalu kecil, respons
      // terpotong di tengah think block tanpa JSON sama sekali.
      max_tokens: 4000,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = (await res.text()).slice(0, 300);
    throw new Error(`Gateway HTTP ${res.status}: ${errBody}`);
  }

  const raw = (await res.text()).trim();

  // Kasus 1: body SSE (data: {...}\ndata: {...}) — gateway streaming walau
  // diminta non-streaming. Gabungkan delta content.
  if (raw.startsWith("data:")) {
    let text = "";
    for (const line of raw.split("\n")) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (payload === "[DONE]") break;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
        const full = chunk.choices?.[0]?.message?.content;
        if (typeof full === "string" && !delta) text += full;
      } catch {
        // baris SSE yang gak valid — skip
      }
    }
    return text;
  }

  // Kasus 2: JSON biasa (chat.completion)
  let data: { choices?: { message?: { content?: unknown } }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Respons gateway bukan JSON valid: ${raw.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Respons gateway tanpa content");
  }
  return content;
}

// ─── Route ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let rawText = "";
  try {
    const { topic } = await req.json();
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "Topic wajib diisi" }, { status: 400 });
    }

    const baseURL =
      process.env.LLM_BASE_URL?.trim() || "http://localhost:11434/v1";
    const apiKey = process.env.LLM_API_KEY?.trim() || "";
    const model =
      process.env.PODCAST_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      "gpt-3.5-turbo";

    const system =
      "Kamu adalah produser podcast profesional yang merancang persona pembicara podcast Indonesia.";
    const prompt = `Kamu adalah produser podcast. Untuk topik berikut, rancang 3 tokoh pembicara yang menarik dan relevan:
TOPIK: "${topic.trim()}"

WAJIB: semua 6 nilai (3 nama + 3 persona) harus TERISI dengan konten asli buatanmu.
DILARANG KERAS: nilai kosong (""), nama generik ("Host", "Tamu A", "Nama Host"), placeholder, atau menyalin teks contoh.

Buat:
- "names": nama yang ORIGINAL dan spesifik (nama orang Indonesia atau tokoh fiktif yang pas dengan topik).
- "personas": 1-2 kalimat deskripsi gaya bicara/sudut pandang tiap tokoh, spesifik ke topik ini.

Contoh FORMAT (hanya bentuk struktur JSON — nilai di bawah cuma ilustrasi, jangan ditiru):
{
  "names": { "host": "Bimo", "guestA": "Sekar", "guestB": "Joko" },
  "personas": { "host": "Penanya yang kritis dan lucu.", "guestA": "Praktisi yang suka kasih studi kasus.", "guestB": "Skeptis yang doyan ngedebat sehat." }
}

Gunakan object dengan KEY "host", "guestA", "guestB" (BUKAN array). Contoh struktur:
{
  "names": { "host": "...", "guestA": "...", "guestB": "..." },
  "personas": { "host": "...", "guestA": "...", "guestB": "..." }
}

Kembalikan HANYA JSON valid, tanpa markdown, tanpa komentar, tanpa teks di luar JSON.`;

    // Retry sampai 3x — model reasoning flaky (kadang cuma <think> tanpa JSON).
    let parsed: unknown = null;
    let lastErr: unknown = null;
    let text = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        text = await fetchChatText({
          baseURL,
          apiKey,
          model,
          system,
          prompt,
          signal: req.signal,
        });
        if (!text.trim()) throw new Error("Respons kosong");

        // Buang blok reasoning + markdown fence, lalu ambil object JSON-nya.
        const noThink = stripReasoningBlocks(text);
        const noFence = noThink
          .replace(/```json\s*([\s\S]*?)```/gi, "$1")
          .replace(/```/g, "")
          .trim();
        if (!noFence.includes("{")) {
          throw new Error("Respons cuma teks/reasoning tanpa JSON");
        }
        parsed = JSON.parse(extractJsonObject(noFence));

        // Validasi: minimal ada SATU nama non-placeholder → anggap sukses.
        const parsedObj = (parsed ?? {}) as Record<string, unknown>;
        const namesVal = parsedObj.names ?? parsedObj;
        const nameMap = toSpeakerMap(namesVal);
        const hasAnyName = [nameMap.host, nameMap.guestA, nameMap.guestB].some(
          (v) => !isPlaceholderValue(v)
        );
        if (!hasAnyName) {
          throw new Error("JSON tanpa nama yang berguna");
        }

        rawText = text;
        console.log(
          `[Suggest Personas] success (attempt ${attempt}) raw:`,
          text.slice(0, 300)
        );
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[Suggest Personas] attempt ${attempt} failed:`, err);
        console.warn(`[Suggest Personas] attempt ${attempt} raw:`, text?.slice(0, 500));
      }
    }

    if (!parsed) {
      throw lastErr ?? new Error("Semua attempt gagal");
    }

    // Toleran terhadap format: model kadang balik object keyed, kadang ARRAY
    // ([host, guestA, guestB]), kadang flat tanpa wrapper.
    const parsedObj = (parsed ?? {}) as Record<string, unknown>;
    const names = toSpeakerMap(parsedObj.names ?? parsedObj);
    const personas = toSpeakerMap(parsedObj.personas);

    console.log("[Suggest Personas] parsed:", JSON.stringify({ names, personas }));
    return NextResponse.json({ names, personas });
  } catch (err) {
    console.error("[Suggest Personas Error]:", err);
    console.error("[Suggest Personas] raw text:", rawText.slice(0, 500));
    // Objek kosong → frontend gak nimpain apa-apa, user tetap pegang nilai lama.
    return NextResponse.json({ names: {}, personas: {} });
  }
}
