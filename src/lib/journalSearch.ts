// ─── Journal Search Layer — real peer-reviewed paper retrieval ──
// Cari jurnal ilmiah NYATA dari API publik gratis (tanpa wajib API key):
//   1. arXiv            → export.arxiv.org/api/query   (no key, nyata)
//   2. Semantic Scholar → graph/v1/paper/search        (no key, rate-limited)
//   3. OpenAlex         → api.openalex.org/works       (no key, polite pool)
// Hasil dinormalisasi ke JournalPaper lalu di-dedupe (by DOI/title).
// Tidak ada package baru — murni fetch + regex (Node global).

export type JournalSource = "arxiv" | "semantic" | "openalex";

export type JournalPaper = {
  title: string;
  authors: string[];
  abstract: string;
  url: string; // landing page / abs page
  doi?: string;
  publishedYear?: number;
  citationCount?: number;
  pdfUrl?: string;
  source: JournalSource;
};

// Subfield jurnal (bukan kategori curiosity umum). Default di .env JOURNAL_FIELDS.
export const JOURNAL_FIELDS = (process.env.JOURNAL_FIELDS ?? "cs,stat,physics,q-bio,econ,math")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const JOURNAL_FIELD_LABEL: Record<string, string> = {
  cs: "Ilmu Komputer",
  stat: "Statistika",
  physics: "Fisika",
  "q-bio": "Biologi & Life Sciences",
  econ: "Ekonomi",
  math: "Matematika",
  "q-fin": "Keuangan",
  "eess": "EE & Sinyal",
  psy: "Psikologi",
  neuro: "Neurosains",
};

const SEMANTIC_KEY = process.env.JOURNAL_SEMANTIC_KEY?.trim() || "";
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO?.trim() || "";

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function dedupeKey(p: JournalPaper): string {
  return (p.doi ?? p.title).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

// ─── arXiv (Atom XML) ──────────────────────────────────────────
async function searchArxiv(keyword: string, cat?: string, max = 10): Promise<JournalPaper[]> {
  const q = cat
    ? `all:${encodeURIComponent(keyword)}+AND+cat:${encodeURIComponent(cat)}`
    : `all:${encodeURIComponent(keyword)}`;
  const url = `http://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${max}&sortBy=relevance`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const xml = await res.text();

  // Split per <entry>...</entry>
  const entries = xml.split(/<entry>/i).slice(1);
  const out: JournalPaper[] = [];
  for (const e of entries) {
    const grab = (tag: string): string => {
      const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? cleanText(m[1].replace(/<[^>]+>/g, "")) : "";
    };
    const title = grab("title");
    const abstract = grab("summary");
    if (!title || !abstract) continue;
    const idMatch = e.match(/<id>([\s\S]*?)<\/id>/i);
    const url = idMatch ? cleanText(idMatch[1]) : "";
    const published = grab("published"); // 2021-09-15T...
    const year = published ? Number(published.slice(0, 4)) : undefined;
    const authors = (e.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/gi) ?? [])
      .map((a) => cleanText(a.replace(/<[^>]+>/g, "")))
      .filter(Boolean);
    const doiM = e.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i);
    const doi = doiM ? cleanText(doiM[1]) : undefined;
    const pdfM =
      e.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i) ??
      e.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/pdf"/i);
    const pdfUrl = pdfM ? pdfM[1] : undefined;
    out.push({
      title,
      authors,
      abstract: abstract.slice(0, 1800),
      url,
      doi,
      publishedYear: year,
      pdfUrl,
      source: "arxiv",
    });
  }
  return out;
}


// ─── Semantic Scholar (JSON) ───────────────────────────────────
async function searchSemantic(keyword: string, max = 10): Promise<JournalPaper[]> {
  const fields =
    "title,abstract,authors,year,citationCount,externalIds,openAccessPdf,url,publicationDate";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
    keyword
  )}&limit=${max}&fields=${fields}${SEMANTIC_KEY ? `&api_key=${SEMANTIC_KEY}` : ""}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as {
    data?: {
      title?: string;
      abstract?: string | null;
      authors?: { name?: string }[];
      year?: number | null;
      citationCount?: number | null;
      externalIds?: { DOI?: string };
      openAccessPdf?: { url?: string } | null;
      url?: string;
    }[];
  };
  const data = json?.data ?? [];
  return data
    .filter((d) => d.title && d.abstract)
    .map((d) => ({
      title: cleanText(d.title),
      authors: (d.authors ?? []).map((a) => cleanText(a.name)).filter(Boolean),
      abstract: cleanText(d.abstract).slice(0, 1800),
      url: d.url || (d.externalIds?.DOI ? `https://doi.org/${d.externalIds.DOI}` : ""),
      doi: d.externalIds?.DOI,
      publishedYear: d.year ?? undefined,
      citationCount: d.citationCount ?? undefined,
      pdfUrl: d.openAccessPdf?.url,
      source: "semantic" as JournalSource,
    }));
}

// ─── OpenAlex (JSON; abstract disusun ulang dari inverted index) ─
function reconstructAbstract(inv?: Record<string, number[]> | null): string {
  if (!inv) return "";
  const arr: { w: string; p: number }[] = [];
  for (const [w, positions] of Object.entries(inv)) {
    for (const p of positions) arr.push({ w, p });
  }
  arr.sort((a, b) => a.p - b.p);
  return cleanText(arr.map((x) => x.w).join(" "));
}

async function searchOpenAlex(keyword: string, max = 10): Promise<JournalPaper[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(
    keyword
  )}&per_page=${max}&select=title,abstract_inverted_index,authorships,doi,publication_year,cited_by_count,id,best_oa_location${
    OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(OPENALEX_MAILTO)}` : ""
  }`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as {
    results?: {
      title?: string;
      abstract_inverted_index?: Record<string, number[]> | null;
      authorships?: { author?: { display_name?: string } }[];
      doi?: string | null;
      publication_year?: number | null;
      cited_by_count?: number | null;
      id?: string;
      best_oa_location?: { landing_page_url?: string; pdf_url?: string } | null;
    }[];
  };
  const results = json?.results ?? [];
  return results
    .filter((r) => r.title && r.abstract_inverted_index)
    .map((r) => ({
      title: cleanText(r.title),
      authors: (r.authorships ?? [])
        .map((a) => cleanText(a.author?.display_name))
        .filter(Boolean),
      abstract: reconstructAbstract(r.abstract_inverted_index).slice(0, 1800),
      url: r.doi ? `https://doi.org/${r.doi}` : r.id || "",
      doi: r.doi ?? undefined,
      publishedYear: r.publication_year ?? undefined,
      citationCount: r.cited_by_count ?? undefined,
      pdfUrl: r.best_oa_location?.pdf_url,
      source: "openalex" as JournalSource,
    }));
}

// ─── Orkestrasi: jalankan semua provider, gabung & dedupe ───────
export async function searchPapers(opts: {
  keyword: string;
  category?: string;
  maxPerProvider?: number;
}): Promise<JournalPaper[]> {
  const { keyword, category, maxPerProvider = 10 } = opts;
  const cat = JOURNAL_FIELDS.includes(category ?? "") ? category : undefined;

  const tasks = [
    searchArxiv(keyword, cat, maxPerProvider),
    searchSemantic(keyword, maxPerProvider),
    searchOpenAlex(keyword, maxPerProvider),
  ] as const;

  const settled = await Promise.allSettled(tasks);
  const all: JournalPaper[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") all.push(...s.value);
  }

  // Dedupe by DOI/title, pertahankan entry pertama (biasanya arXiv/semantic).
  const seen = new Set<string>();
  const deduped: JournalPaper[] = [];
  for (const p of all) {
    const k = dedupeKey(p);
    if (k && !seen.has(k)) {
      seen.add(k);
      deduped.push(p);
    }
  }
  return deduped;
}

// Pilih subfield acak buat variasi antar generate.
export function pickJournalField(): { field: string; label: string } {
  const f = JOURNAL_FIELDS[Math.floor(Math.random() * JOURNAL_FIELDS.length)];
  return { field: f, label: JOURNAL_FIELD_LABEL[f] ?? f };
}
