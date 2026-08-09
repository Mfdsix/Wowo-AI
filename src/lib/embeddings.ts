// ─── Embedding client (OpenAI-compatible /embeddings) ──────────
// Provider pakai base URL LLM yang sama (Ollama / LiteLLM / vLLM)
// → endpoint /embeddings. EMBEDDING_MODEL kosong = fitur RAG nonaktif
// (embeddingEnabled() false), app balik ke jalur inline sekarang.
//
// Response OpenAI-compat:
//   { data: [{ embedding: number[], index: number }], model, usage }

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getEmbeddingConfig(): EmbeddingConfig | null {
  const model = process.env.EMBEDDING_MODEL?.trim();
  if (!model) return null;
  return {
    baseUrl: (
      process.env.EMBEDDING_BASE_URL?.trim() ||
      process.env.LLM_BASE_URL?.trim() ||
      "http://localhost:11434/v1"
    ).replace(/\/+$/, ""),
    apiKey:
      process.env.EMBEDDING_API_KEY?.trim() ||
      process.env.LLM_API_KEY?.trim() ||
      "",
    model,
  };
}

export function embeddingEnabled(): boolean {
  return getEmbeddingConfig() !== null;
}

const DEFAULT_BATCH = 32;

// Embed daftar teks → array vektor. Throw kalau provider error /
// EMBEDDING_MODEL belum diset. Caller yang handle fallback.
export async function embedTexts(
  texts: string[],
  opts?: { batchSize?: number }
): Promise<number[][]> {
  const cfg = getEmbeddingConfig();
  if (!cfg) {
    throw new Error("EMBEDDING_MODEL belum diset di .env — fitur RAG nonaktif");
  }
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    results.push(...(await embedBatch(cfg, batch)));
  }
  return results;
}

async function embedBatch(
  cfg: EmbeddingConfig,
  texts: string[]
): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: texts }),
    });
  } catch (err) {
    throw new Error(
      `Embedding service unreachable di ${cfg.baseUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data?: { embedding?: number[] }[];
  };
  const out = (data.data ?? []).map((d) => d.embedding ?? []).filter((v) => v.length > 0);
  if (out.length !== texts.length) {
    throw new Error(
      `Embedding response kurang: minta ${texts.length} teks, dapat ${out.length}`
    );
  }
  return out;
}

// ─── float32 pack/unpack — simpen vektor sebagai BLOB (Prisma Bytes) ──
// Little-endian konsisten biar unpack balik sama.

export function packF32(vec: number[]): Uint8Array {
  const buf = new ArrayBuffer(vec.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < vec.length; i++) view.setFloat32(i * 4, vec[i], true);
  return new Uint8Array(buf);
}

export function unpackF32(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array<number>(view.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

// Cosine similarity — retrieval brute-force (skala lokal, ~500 chunk × 768 dim)
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
