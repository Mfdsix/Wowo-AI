// ─── Journal Engine — peer-reviewed discovery pipeline ─────────
// Beda dari Curiosity: sumber diambil dari API jurnal NYATA (journalSearch),
// LLM HANYA merangkai hook/teaser/question dari abstrak yang valid.
// Pipeline: searchPapers → selectPaper → composeJournalCard → score → persist.
// Reuse helper dari curiosity: getLearnerContext, persistDiscovery,
// recordEvent, saveDiscovery, askDiscovery, generateRabbitHoles, getOrGenerateLevel.

import { prisma } from "@/lib/prisma";
import { callLLM, callLLMJson } from "@/lib/llm";
import {
  getLearnerContext,
  persistDiscovery,
  recordEvent,
  saveDiscovery,
  askDiscovery,
  generateRabbitHoles,
  getOrGenerateLevel,
  type CandidateDiscovery,
} from "@/lib/curiosity";
import {
  searchPapers,
  pickJournalField,
  type JournalPaper,
} from "@/lib/journalSearch";

export const JOURNAL_CATEGORIES = [
  "cs",
  "stat",
  "physics",
  "q-bio",
  "econ",
  "math",
  "neuro",
  "psy",
] as const;
export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

export const MAX_DEPTH = 4;

export type JournalCandidate = CandidateDiscovery & {
  paper: JournalPaper;
};

// ─── 1. Pilih paper yang menarik (anti-repetition + variasi) ────
function scorePaperInterest(
  p: JournalPaper,
  recentHooks: string[]
): number {
  // Anti-repetition: tolak kalau judul/penulis mirip dengan yang baru dilihat.
  const recent = recentHooks.join(" ").toLowerCase();
  const overlap = (p.title.toLowerCase().match(/\b\w{5,}\b/g) ?? []).filter((w) =>
    recent.includes(w)
  ).length;
  if (overlap >= 2) return -1;

  // Favoritkan citation menengah (bukan 0, bukan raksasa) → "menarik & valid".
  const c = p.citationCount ?? 0;
  const citationScore = c === 0 ? 0.3 : Math.min(1, 0.4 + c / 200);
  // Ada akses terbuka = bonus (bisa dibaca user).
  const openAccess = p.pdfUrl ? 0.2 : 0;
  // Ada DOI/url = wajib validitas.
  const validity = p.doi || p.url ? 0.2 : 0;
  return citationScore + openAccess + validity;
}

export function selectPaper(
  papers: JournalPaper[],
  profile: Awaited<ReturnType<typeof getLearnerContext>>
): JournalPaper | null {
  if (papers.length === 0) return null;
  const ranked = papers
    .map((p) => ({ p, s: scorePaperInterest(p, profile.recentHooks) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  if (ranked.length === 0) return papers[0];
  // Ambil salah satu dari 3 teratas buat variasi (bukan selalu #1).
  const top = ranked.slice(0, Math.min(3, ranked.length));
  return top[Math.floor(Math.random() * top.length)].p;
}

// ─── 2. Compose card dari abstrak (LLM tidak boleh karang) ─────
const COMPOSE_SYSTEM = `Kamu adalah editor sains untuk aplikasi "Journal Engine" yang memperkenalkan jurnal ilmiah asli kepada pembaca awam maupun akademik. Kamu diberi JUDUL, PENULIS, TAHUN, dan ABSTRAK ASLI dari sebuah paper peer-reviewed.

Tugasmu: susun ringkasan yang memikat agar pembaca penasaran membaca paper-nya. ATURAN BESIP:
1. JANGAN pernah mengarang fakta di luar abstrak. Semua klaim harus berasal dari abstrak.
2. JANGAN tambahkan data, angka, atau hasil yang tidak ada di abstrak.
3. SELALU sertakan judul paper asli dan tahun terbit di dalam teks (natural).
4. Tulis dalam Bahasa Indonesia yang natural dan baku.
5. Keluarkan HANYA objek JSON mentah tanpa markdown, tanpa code fence, tanpa teks lain.`;

function buildComposePrompt(paper: JournalPaper): string {
  const authors = paper.authors.slice(0, 6).join(", ") || "penulis anonim";
  return `JUDUL: ${paper.title}
PENULIS: ${authors}
TAHUN: ${paper.publishedYear ?? "tidak diketahui"}
ABSTRAK ASLI:
"""
${paper.abstract}
"""

Buat SATU kandidat penemuan jurnal:
- "hook": 1 kalimat pembuka yang mengejutkan/memikat, sebutkan judul & tahun paper di dalamnya.
- "teaser": 2-3 kalimat yang merangkum inti abstrak dengan akurat (tanpa karang).
- "question": 1 pertanyaan pemicu rasa penasaran tentang paper ini.
- "topicName": judul paper (disingkat bila terlalu panjang).
- "topicSlug": slug url aman dari judul (huruf kecil, strip).
- "topicSummary": 1 kalimat ringkasan topik.
- "surprise", "curiosity", "credibility", "depthPotential": masing-masing angka 0.0-1.0 (credibility tinggi karena peer-reviewed).

Kembalikan TEPAT JSON:
{ "hook": string, "teaser": string, "question": string, "topicName": string, "topicSlug": string, "topicSummary": string, "surprise": number, "curiosity": number, "credibility": number, "depthPotential": number }`;
}


// ─── 2b. Generate kandidat dari paper terpilih ─────────────────
export async function composeJournalCard(
  paper: JournalPaper,
  signal?: AbortSignal
): Promise<JournalCandidate> {
  const raw = await callLLMJson<{
    hook: string;
    teaser: string;
    question: string;
    topicName: string;
    topicSlug: string;
    topicSummary: string;
    surprise: number;
    curiosity: number;
    credibility: number;
    depthPotential: number;
  }>({
    system: COMPOSE_SYSTEM,
    prompt: buildComposePrompt(paper),
    temperature: 0.7,
    maxTokens: 2000,
    signal,
  });

  const clamp = (n: unknown, d = 0.5) =>
    typeof n === "number" && isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
  const slug =
    typeof raw.topicSlug === "string" && raw.topicSlug.trim()
      ? raw.topicSlug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
      : paper.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60);

  // Sumber WAJIB = paper asli (bukan karangan LLM).
  const source = {
    title: paper.title,
    url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
    author: paper.authors.slice(0, 6).join(", ") || undefined,
    publishedAt: paper.publishedYear ? `${paper.publishedYear}-01-01` : undefined,
    type: "paper",
    trustLevel: "high" as const,
    claimStatus: "known_fact" as const,
    confidence: Math.min(1, 0.8 + (paper.citationCount ?? 0) / 1000),
    note:
      `Sumber: ${paper.source}` +
      (paper.doi ? ` · DOI: ${paper.doi}` : "") +
      (paper.citationCount != null ? ` · ${paper.citationCount} sitasi` : "") +
      (paper.pdfUrl ? ` · PDF: ${paper.pdfUrl}` : ""),
  };

  return {
    topicName: raw.topicName ?? paper.title,
    topicSlug: slug,
    category: "journal",
    topicSummary: raw.topicSummary ?? paper.abstract.slice(0, 200),
    hook: raw.hook,
    teaser: raw.teaser,
    question: raw.question,
    surprise: clamp(raw.surprise),
    curiosity: clamp(raw.curiosity),
    credibility: clamp(raw.credibility, 0.9),
    depthPotential: clamp(raw.depthPotential),
    sources: [source],
    paper,
  };
}

// ─── 3. Quality gate (paper harus punya link/DOI valid) ────────
export function scoreJournalCandidate(c: JournalCandidate) {
  const hasLink = !!(c.paper.doi || c.paper.url);
  const avgTrust = 1.0; // peer-reviewed → trust tinggi by default
  const flagged = !hasLink ? "no_source" : null;
  return { avgTrust, flagged };
}

// ─── 4. Orchestrator: generate satu discovery jurnal ──────────
export async function generateJournalDiscovery(
  profile: Awaited<ReturnType<typeof getLearnerContext>>,
  signal?: AbortSignal
) {
  const { field, label } = pickJournalField();
  const papers = await searchPapers({ keyword: label, category: field, maxPerProvider: 8 });
  if (papers.length === 0) {
    throw new Error("Tidak ada paper ditemukan dari sumber jurnal (arXiv/Semantic/OpenAlex).");
  }
  const paper = selectPaper(papers, profile);
  if (!paper) throw new Error("Tidak ada paper yang lolos seleksi.");

  const candidate = await composeJournalCard(paper, signal);
  const { flagged } = scoreJournalCandidate(candidate);
  const status = flagged ? "rejected" : "approved";
  const computedScore = candidate.surprise * candidate.curiosity * candidate.credibility * candidate.depthPotential;

  const discovery = await persistDiscovery(candidate, computedScore, status);
  return discovery;
}

// ─── Re-export helper dari curiosity biar route journal rapi ───
export {
  getLearnerContext,
  recordEvent,
  saveDiscovery,
  askDiscovery,
  generateRabbitHoles,
  getOrGenerateLevel,
  type CandidateDiscovery,
};
