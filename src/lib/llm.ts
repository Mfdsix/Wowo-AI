// ─── Server-side LLM gateway helper ─────────────────────────────
// Robustness pattern borrowed from app/api/podcast/suggest-personas:
// some gateway models (e.g. qwen via OmniRoute) wrap JSON in <think>
// blocks or force SSE output even with stream:false, so we strip
// reasoning and extract the first balanced JSON object, retrying a few
// times. Returns raw text; use callLLMJson for typed structured output.

// Buang blok reasoning yang kadang dibuka model (<think>...</think>, dll).
function stripReasoningBlocks(text: string): string {
  let out = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/\[think\][\s\S]*?\[\/think\]/gi, "")
    .trim();
  // Tag pembuka tak tertutup → buang sisa setelahnya.
  const unclosed = out.match(/<(?:think|thinking|reasoning)>|\[think\]/i);
  if (unclosed && unclosed.index != null) {
    out = out.slice(0, unclosed.index).trim();
  }
  return out;
}

// Bersihkan "echos" prompt/system-instruction yang sering kebocor ke jawaban
// (terutama model qwen: ia mengulang ulang "Subject (Discovery L0): ...",
// "Write the ... depth level", "TULISLAH dalam Bahasa Indonesia", dsb) dan juga
// sisa blok <think> yang tak terbungkus tag. Ini bikin output lebih readable.
function stripPromptEchoes(text: string): string {
  let out = text;
  // 0) Model sering "bocor" ke plaintext: seluruh chain-of-thought TANPA tag,
  //    berupa deretan baris "Analyze User Input:", "Identify Key Subject:",
  //    "Check Constraints:", "Draft Construction (...):" lalu baru jawaban.
  //    Potong SEMUA teks sebelum label jawaban pertama ("Draft Construction",
  //    "Mental Refinement", "Final Answer", "Jawaban:"). Jika tak ada label
  //    jawaban tapi ada pola "Analyze/Identify/Check Constraints" di awal,
  //    buang hingga baris kosong pertama SETELAH blok itu.
  const answerMarker =
    /\n\s*(?:draft\s*construction|mental\s*refinement|thinking\s*process|final\s*answer|jawaban\s*:)\b[^:\n]*:/i;
  const marker = out.search(answerMarker);
  if (marker !== -1) {
    // Simpan teks setelah label (termasuk label itu sendiri akan dibersihkan
    // oleh langkah labelPrefix di bawah). Potong PREamble thinking.
    out = out.slice(marker).trim();
  } else if (
    /^\s*(?:analyze|identify|check|subject|context|initial question|category|user prompt|role\/constraints|given the|here'?s (?:a |my ))/i.test(
      out
    )
  ) {
    // Tidak ada label jawaban, tapi awalnya pola thinking → buang hingga
    // baris kosong pertama.
    const blank = out.search(/\n\s*\n/);
    if (blank !== -1) out = out.slice(blank).trim();
  }
  // 1) Buang blok <think> ... baik yang rapi (ada </think>) maupun
  //    terbuka (lupa tutup). Pendekatan: hapus SEMUA segmen yang dimulai
  //    dengan <think> hingga ditemukan baris kosong pemisah ATAU akhir teks.
  //    Jika <think> muncul di awal tanpa baris kosong, potong sampai baris
  //    kosong berikutnya; jawaban asli biasanya baru muncul setelah \n\n.
  let guarded = 0;
  let prev;
  do {
    prev = out;
    // Hapus <think>...</think> yang rapi.
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Hapus <think>... sampai baris kosong berikutnya (thinking lalu jawaban).
    out = out.replace(/<think>[\s\S]*?(?=\n\s*\n)/i, "").trim();
    // Sisa <think> tanpa baris kosong → itu thinking murni, buang sampai akhir.
    const m = out.match(/<think>[\s\S]*/i);
    if (m && m.index != null) {
      out = out.slice(0, m.index).trim();
    }
    guarded++;
  } while (out !== prev && guarded < 5);
  // 2) Baris yang merupakan pengulangan instruksi prompt (diawali kata kunci ini).
  const echoStart = /^\s*(subject\s*\(discovery\s*l0\)|subjek\s*\(penemuan\)|context\s*:|konteks\s*:|initial question\s*:|pertanyaan awal\s*:|category\s*:|kategori\s*:|task\s*:|write the|tulis level|depth level|format\s*:|requirements\s*:|analyz\w*|here'?s a thinking|berikut adalah|draft\s*construction|mental\s*refinement|thinking\s*process|mental\s*refinement\s*in|\d+\.\s*\*\*)[\s:)\-]/i;
  // Label "berpikir" seperti "Draft Construction (Mental Refinement in
  // Indonesian): <jawaban>" — buang HANYA label-nya, jawaban di baris yang
  // sama tetap dipertahankan.
  const labelPrefix = /^\s*(?:draft\s*construction|mental\s*refinement|thinking\s*process)\b[^:\n]*:\s*/i;
  out = out
    .split(/\n+/)
    .map((line) => line.replace(labelPrefix, "").trim())
    .filter((line) => !echoStart.test(line))
    .join("\n")
    .trim();
  // 3) Hapus outline "berpikir" di awal: baris bernomor "1. **Analyze...**"
  //    atau "1.  **Analyze User Input:**" — baik yang diikuti isi maupun tidak.
  //    Potong dari awal teks sampai baris kosong pertama SETELAH blok thinking,
  //    agar jawaban asli (yang biasanya baru muncul setelah \n\n) tetap utuh.
  out = out.replace(/^\s*(?:\d+\.\s+\*\*[^*]*\*\*\s*:?[\s\S]*?)(?=\n\s*\n|$)/, "").trim();
  // 3b) Sisa baris bernomor di awal (tanpa blank line pemisah) — buang baris demi baris.
  out = out
    .split(/\n+/)
    .filter((line, i) => {
      if (i === 0 && /^\s*\d+\.\s+\*\*/.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
  return out.trim();
}

// Ambil object JSON paling luar dengan brace-matching manual (hormati
// string literal + array). Model qwen sering: (1) nge-wrap JSON di markdown
// ```json ... ```, (2) nambahin teks penjelasan SETELAH JSON, atau (3)
// memotong output (truncation). Strategi: cari "{" paling luar yang balanced
// SAMPAI "}" terakhir yang seimbang — ini robust terhadap trailing text.
function extractJsonObject(text: string): string {
  // Coba ambil dari dalam markdown code fence dulu.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const search = fence ? fence[1] : text;

  const first = search.indexOf("{");
  if (first === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = first; i < search.length; i++) {
    const ch = search[i];
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
      if (depth === 0) end = i; // posisi "}" paling luar yang seimbang
    }
  }
  // Jika balanced ditemukan, return itu (buang trailing text setelahnya).
  if (end >= 0) return search.slice(first, end + 1);
  // Jika tidak balanced (kemungkinan truncation), kembalikan dari "{" ke
  // "}" terakhir yang ada — parse tetap akan gagal, tapi pesan error lebih jelas.
  const last = search.lastIndexOf("}");
  return last > first ? search.slice(first, last + 1) : search.slice(first);
}

export function llmConfig() {
  return {
    baseURL: process.env.LLM_BASE_URL?.trim() || "http://localhost:11434/v1",
    apiKey: process.env.LLM_API_KEY?.trim() || "",
    model: process.env.LLM_MODEL?.trim() || "gpt-3.5-turbo",
  };
}

async function fetchRaw(opts: {
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { baseURL, apiKey, model } = llmConfig();
  const base = baseURL.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      temperature: opts.temperature,
      stream: false,
      max_tokens: opts.maxTokens,
      // Matiin chain-of-thought di gateway (OmniRoute/qwen). PENTING: pakai
      // "reasoning_effort":"none" — satu-satunya yang benar-benar mematikan
      // thinking TANPA mengganti model. Field "thinking":false / "think":false
      // "reasoning" justru: (a) 400 unsupported, atau (b) diam-diam
      // merutekan ke model lain (llama). Kalau gateway tak paham, diabaikan
      // & regex cleanup di bawah jadi safety net.
      reasoning_effort: "none",
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = (await res.text()).slice(0, 300);
    throw new Error(`Gateway HTTP ${res.status}: ${errBody}`);
  }

  const raw = (await res.text()).trim();

  // Kasus 1: body SSE (gateway paksa stream walau diminta non-streaming).
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
        // baris SSE invalid → skip
      }
    }
    return text;
  }

  // Kasus 2: JSON biasa (chat.completion).
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

export async function callLLM(opts: {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const temperature = opts.temperature ?? 0.8;
  const maxTokens = opts.maxTokens ?? 2000;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await fetchRaw({
        system: opts.system,
        prompt: opts.prompt,
        temperature,
        maxTokens,
        signal: opts.signal,
      });
      const cleaned = stripPromptEchoes(text);
      // Fallback: kalau strip menghabiskan seluruh teks (edge case model
      // aneh), kembalikan teks asli yang sudah di-trim而不是 kosong.
      if (cleaned.trim()) return cleaned;
      if (text.trim()) return text.trim();
      lastErr = new Error("Empty LLM response");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function callLLMJson<T>(opts: {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const temperature = opts.temperature ?? 0.8;
  const baseTokens = opts.maxTokens ?? 2000;
  let lastErr: unknown = null;
  // Beberapa model (qwen) suka memotong JSON di batas token, atau nambahin
  // teks setelah JSON. Coba sampai 3x: naikkan budget token tiap gagal.
  for (let attempt = 0; attempt < 3; attempt++) {
    const maxTokens = baseTokens + attempt * 1024; // 0, +1k, +2k
    try {
      const raw = await callLLM({ ...opts, temperature, maxTokens });
      const cleaned = stripReasoningBlocks(raw);
      const json = extractJsonObject(cleaned);
      return JSON.parse(json) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
