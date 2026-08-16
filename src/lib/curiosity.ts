// ─── Curiosity Engine — AI Discovery Generator pipeline (PRD §20) ──
// Flow: Source Pool → Discovery Generator → Quality / Fact-Check →
//       Personal Ranking → Discovery. Plus rabbit-hole + depth levels.
//
// Semua komunikasi LLM lewat src/lib/llm.ts (gateway fetch + JSON aman).

import { prisma } from "@/lib/prisma";
import { callLLMJson, callLLM } from "@/lib/llm";

export const CURIOSITY_CATEGORIES = [
  "history",
  "science",
  "technology",
  "human-behavior",
  "geography",
  "culture",
  "ancient-civilizations",
  "space",
  "engineering",
  "language",
  "economics",
  "philosophy",
  "nature",
  "art",
  "unexpected-connections",
] as const;

export type CuriosityCategory = (typeof CURIOSITY_CATEGORIES)[number];

export const MAX_DEPTH = 4; // L0 Hook → L4 Deep Dive (PRD §9)

export type CandidateDiscovery = {
  topicName: string;
  topicSlug: string;
  category: string;
  topicSummary: string;
  hook: string;
  teaser: string;
  question: string;
  surprise: number;
  curiosity: number;
  credibility: number;
  depthPotential: number;
  sources: {
    title: string;
    url?: string;
    author?: string;
    publishedAt?: string;
    type: string;
    trustLevel: string;
    claimStatus: string;
    confidence: number;
    note?: string;
  }[];
};

const DISCOVER_SYSTEM = `Kamu adalah peneliti teliti untuk "Curiosity Engine", sebuah aplikasi yang menunjukkan fakta nyata yang memukau kepada orang-orang — hal-hal yang tak mereka tahu tapi ingin mereka pelajari.
Tesis produk (PRD §3): rasa penasaran mendahului belajar; penemuan harus mendahului pencarian; kedalaman bersifat opsional.
Kamu menyajikan fakta yang mengejutkan, kredibel, dan sungguh dapat dipelajari — BUKAN trivia, BUKAN mitos urban, BUKAN budaya pop, BUKAN gosip olahraga/selebriti.
Setiap klaim WAJIB dapat diverifikasi dengan sumber nyata yang bisa dikutip. Utamakan sejarah, sains, teknik, alam, geografi, bahasa, ekonomi, filsafat, peradaban kuno, dan koneksi lintas-domain yang tak terduga.
TULISKAN semua teks (hook, teaser, question, topicName, topicSummary, dan sumber) dalam Bahasa Indonesia yang natural dan baku.

Keluarkan HANYA sebuah objek JSON, tanpa markdown, tanpa komentar.
KRITIS: JANGAN bungkus JSON dalam code fence (jangan pakai \`\`\`json). JANGAN menambahkan teks apa pun sebelum atau sesudah objek JSON. Keluarkan objek JSON mentah dan tidak lain.`;
function buildDiscoverPrompt(opts: {
  avoidTopics: string[];
  curiousAbout: string[];
  recentHooks: string[];
  depthPreference: string;
}): string {
  const avoid =
    opts.avoidTopics.length > 0
      ? `\nJANGAN hasilkan apa pun yang mirip dengan ini (pengguna menghindari / sudah pernah melihat):\n- ${opts.avoidTopics
          .slice(0, 15)
          .join("\n- ")}`
      : "";
  const curious =
    opts.curiousAbout.length > 0
      ? `\nCenderung ke minat berikut bila wajar:\n- ${opts.curiousAbout
          .slice(0, 15)
          .join("\n- ")}`
      : "";
  const recent =
    opts.recentHooks.length > 0
      ? `\nHINDARI mengulang hook yang baru ditampilkan ini (anti-pengulangan, PRD §12):\n- ${opts.recentHooks
          .slice(0, 20)
          .join("\n- ")}`
      : "";
  return `Buat SATU kandidat penemuan berkualitas tinggi.

${avoid}${curious}${recent}

Pilih satu subjek tunggal, spesifik, nyata, dan terdokumentasi baik. Ia harus:
1. MENGEJUTKAN — tidak mudah ditebak, tapi BENAR.
2. KREDIBEL — didukung minimal 2 sumber nyata yang bisa kamu sebut (buku, makalah, arsip, artikel terpercaya).
3. BERPOTENSI MENDALAM — bisa bercabang ke sejarah / mekanisme / koneksi / selami-dalam (PRD §9).

Kedalaman eksplorasi khas pengguna adalah "${opts.depthPreference}".

Kembalikan TEPAT dalam bentuk JSON ini (semua teks dalam Bahasa Indonesia):
{
  "topicName": string,
  "topicSlug": string,
  "category": string,
  "topicSummary": string,
  "hook": string,
  "teaser": string,
  "question": string,
  "surprise": number,
  "curiosity": number,
  "credibility": number,
  "depthPotential": number,
  "sources": [ { "title": string, "url": string | null, "author": string | null, "publishedAt": string | null, "type": string, "trustLevel": string, "claimStatus": string, "confidence": number, "note": string | null } ]
}`;
}

// ─── 1. Discover (PRD §21) ───────────────────────────────────────
export async function generateCandidate(
  profile: Awaited<ReturnType<typeof getLearnerContext>>,
  signal?: AbortSignal
): Promise<CandidateDiscovery> {
  const raw = await callLLMJson<CandidateDiscovery>({
    system: DISCOVER_SYSTEM,
    prompt: buildDiscoverPrompt({
      avoidTopics: profile.avoidTopics,
      curiousAbout: profile.curiousTopics,
      recentHooks: profile.recentHooks,
      depthPreference: profile.depthPreference,
    }),
    temperature: 0.9,
    maxTokens: 4096,
    signal,
  });

  const clamp = (n: unknown, d = 0.5) =>
    typeof n === "number" && isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
  const slug =
    typeof raw.topicSlug === "string" && raw.topicSlug.trim()
      ? raw.topicSlug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
      : raw.topicName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 60);

  return {
    topicName: raw.topicName,
    topicSlug: slug,
    category: CURIOSITY_CATEGORIES.includes(raw.category as CuriosityCategory)
      ? raw.category
      : "unexpected-connections",
    topicSummary: raw.topicSummary ?? "",
    hook: raw.hook,
    teaser: raw.teaser,
    question: raw.question,
    surprise: clamp(raw.surprise),
    curiosity: clamp(raw.curiosity),
    credibility: clamp(raw.credibility),
    depthPotential: clamp(raw.depthPotential),
    sources: (raw.sources ?? []).map((s) => ({
      title: s.title,
      url: s.url ?? undefined,
      author: s.author ?? undefined,
      publishedAt: s.publishedAt ?? undefined,
      type: s.type ?? "other",
      trustLevel: ["high", "medium", "low"].includes(s.trustLevel) ? s.trustLevel : "medium",
      claimStatus: ["known_fact", "interpretation", "disputed"].includes(s.claimStatus)
        ? s.claimStatus
        : "known_fact",
      confidence: clamp(s.confidence, 0.8),
      note: s.note ?? undefined,
    })),
  };
}

// ─── 2. Quality / Fact-Check (PRD §16, §20) ─────────────────────
export function scoreCandidate(c: CandidateDiscovery) {
  const composite = c.surprise * c.curiosity * c.credibility * c.depthPotential;
  const avgTrust =
    c.sources.reduce((acc, s) => {
      const t = s.trustLevel === "high" ? 1 : s.trustLevel === "low" ? 0.3 : 0.6;
      return acc + t * s.confidence;
    }, 0) / Math.max(1, c.sources.length);
  const flagged =
    c.credibility < 0.5 || c.sources.length < 2 || avgTrust < 0.4
      ? "low_credibility"
      : null;
  return { composite, avgTrust, flagged };
}

// ─── 3. Personal Ranking / Anti-Repetition (PRD §7, §11, §12) ───
export function personalNovelty(
  c: CandidateDiscovery,
  profile: Awaited<ReturnType<typeof getLearnerContext>>
): number {
  const known = new Set([
    ...profile.recentHooks.map((h) => h.toLowerCase()),
    ...profile.curiousTopics.map((t) => t.toLowerCase()),
    ...profile.avoidTopics.map((t) => t.toLowerCase()),
  ]);
  const words = c.hook.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  let overlap = 0;
  for (const w of words) if (known.has(w)) overlap++;
  const novelty = words.length ? 1 - overlap / words.length : 1;
  return Math.min(1, Math.max(0, novelty));
}

// ─── 4. Rabbit Hole questions (PRD §8) ──────────────────────────
export type RabbitBranch = { question: string; order: number };

export async function generateRabbitHoles(
  discovery: { hook: string; teaser: string; question: string; category: string },
  existingQuestions: string[] = [],
  signal?: AbortSignal
): Promise<RabbitBranch[]> {
  const existingNote =
    existingQuestions.length > 0
      ? `\nSudah ditanyakan (jangan ulangi):\n- ${existingQuestions.join("\n- ")}`
      : "";
  const sys = `Kamu merancang pertanyaan lanjutan "lubang kelinci" yang natural untuk aplikasi belajar. Setiap pertanyaan harus memperdalam rasa penasaran tentang subjek, bisa dijawab, dan terasa seperti pengguna memilih jalannya sendiri (PRD §8). TULISLAH pertanyaan dalam Bahasa Indonesia yang natural.`;
  const prompt = `Penemuan (L0): "${discovery.hook}"
Konteks: ${discovery.teaser}
Pertanyaan awal: ${discovery.question}
Kategori: ${discovery.category}
${existingNote}

Buat 3 pertanyaan lanjutan yang berbeda dan bercabang lebih dalam secara natural (mekanisme, sebab, perbandingan, koneksi). Kembalikan HANYA JSON:
{ "questions": [ { "question": string, "order": number } ] }`;
  const out = await callLLMJson<{ questions: RabbitBranch[] }>({
    system: sys,
    prompt,
    temperature: 0.7,
    maxTokens: 800,
    signal,
  });
  return (out.questions ?? [])
    .filter((q) => typeof q.question === "string" && q.question.trim())
    .slice(0, 3)
    .map((q, i) => ({ question: q.question.trim(), order: i }));
}

// ─── Depth levels L1–L4 (PRD §9) ──────────────────────────────
const LEVEL_META: Record<number, { key: string; title: string; brief: string }> = {
  1: { key: "context", title: "Konteks", brief: "Penjelasan singkat apa yang terjadi." },
  2: { key: "why", title: "Mengapa", brief: "Sebab & mekanisme mengapa ini terjadi." },
  3: { key: "connections", title: "Koneksi", brief: "Hubungan ke sejarah, sains, budaya, atau kejadian lain." },
  4: { key: "deep-dive", title: "Selami Dalam", brief: "Penjelasan mendalam: sumber, tokoh, konsep, perspektif berbeda." },
};

export async function getOrGenerateLevel(
  discovery: { id: string; hook: string; teaser: string; question: string; category: string },
  level: number,
  signal?: AbortSignal
) {
  if (level < 1 || level > MAX_DEPTH) {
    throw new Error("Level harus 1–4 (0 adalah hook di kartu).");
  }
  const meta = LEVEL_META[level];

  const cached = await prisma.discoveryLevel.findUnique({
    where: { discoveryId_level: { discoveryId: discovery.id, level } },
  });
  if (cached) return cached;

  const sys = `Kamu adalah penjelas yang jelas dan hati-hati untuk aplikasi belajar rasa penasaran. Tulis prosa yang akurat dan menarik. Kutip hal spesifik yang nyata. Jangan pernah mengarang. TULISLAH dalam Bahasa Indonesia yang natural dan baku.

PENTING — format & gaya:
- LANGSUNG tulis jawaban (isi penjelasan). JANGAN mengulang instruksi prompt, jangan tulis "Subjek:", "Konteks:", "Tugas:", atau label "### Konteks:".
- Pakai markdown rapi: 1 judul tingkat-2 (##) singkat di awal, lalu 2–4 paragraf pendek yang mudah dibaca. Boleh pakai bullet (-) bila perlu.
- JANGAN keluarkan blok <think> atau catatan "berpikir". Hanya keluarkan teks penjelasan final.`;
  const prompt = `Subjek (Discovery L0): "${discovery.hook}"
Konteks: ${discovery.teaser}
Kategori: ${discovery.category}

Tulis level kedalaman "${meta.title}" (${meta.brief}).
Targetkan ${level === 4 ? "400-600" : "150-250"} kata dalam markdown yang mudah dibaca. Jadilah spesifik dan setia pada catatan sejarah/ilmiah yang sebenarnya.`;

  const content = await callLLM({
    system: sys,
    prompt,
    temperature: 0.6,
    maxTokens: level === 4 ? 1200 : 700,
    signal,
  });

  return prisma.discoveryLevel.upsert({
    where: { discoveryId_level: { discoveryId: discovery.id, level } },
    update: { content, title: meta.title },
    create: { discoveryId: discovery.id, level, title: meta.title, content },
  });
}

// ─── Save topic (PRD §19 #9) ───────────────────────────────────
// `profileId` = kode akses user (dijadikan id LearnerProfile) biar simpan
// bersifat per-user, bukan global.
export async function saveDiscovery(
  discoveryId: string,
  note: string | undefined,
  profileId: string
) {
  return prisma.savedDiscovery.upsert({
    where: { profileId_discoveryId: { profileId, discoveryId } },
    update: { note: note ?? null },
    create: { discoveryId, profileId, note: note ?? null },
  });
}

// ─── Feedback / memory capture (PRD §11, §23) ─────────────────
export async function recordEvent(
  opts: {
    discoveryId: string;
    type: string;
    level?: number;
    metadata?: string;
  },
  profileId: string
) {
  const delivery =
    (await prisma.discoveryDelivery.findFirst({
      where: { profileId, discoveryId: opts.discoveryId },
      select: { id: true, maxDepth: true },
    })) ??
    (await prisma.discoveryDelivery.create({
      data: { profileId, discoveryId: opts.discoveryId },
      select: { id: true, maxDepth: true },
    }));

  const ev = await prisma.discoveryEvent.create({
    data: {
      deliveryId: delivery.id,
      type: opts.type,
      level: opts.level ?? null,
      metadata: opts.metadata ?? null,
    },
  });

  if (opts.type === "deep_dive" || opts.type === "explore_clicked") {
    await prisma.discoveryDelivery.update({
      where: { id: delivery.id },
      data: {
        outcome: opts.type === "deep_dive" ? "deep_dived" : "explored",
        maxDepth: Math.max(opts.level ?? 1, delivery.maxDepth ?? 0),
      },
    });
  }
  if (opts.type === "saved") {
    await prisma.discoveryDelivery.update({
      where: { id: delivery.id },
      data: { outcome: "saved" },
    });
  }

  if (opts.type === "already_knew" || opts.type === "not_interested") {
    const disc = await prisma.discovery.findUnique({
      where: { id: opts.discoveryId },
      select: { topic: { select: { slug: true } } },
    });
    const tag = disc?.topic?.slug ?? opts.discoveryId;
    const type = opts.type === "not_interested" ? "avoid" : "curious";
    await prisma.interestTag.upsert({
      where: { profileId_tag_type: { profileId, tag, type } },
      update: { weight: { increment: 1 }, updatedAt: new Date() },
      create: { profileId, tag, type },
    });
  }

  return ev;
}

// ─── Contextual Ask (PRD §10) ────────────────────────────────
// Jawab pertanyaan user TAPI terikat konteks discovery aktif —
// "melanjutkan rasa penasaran", bukan chatbot baru.
export async function askDiscovery(
  discovery: {
    hook: string;
    teaser: string;
    question: string;
    category: string;
  },
  userQuestion: string,
  priorAnswers: string[] = [],
  signal?: AbortSignal
): Promise<string> {
  const sys = `Kamu adalah penjelas yang penasaran dan presisi di dalam aplikasi belajar. Kamu menjawab HANYA berdasarkan subjek penemuan tersebut. Jadilah akurat, kutip hal spesifik, dan akui ketidakpastian daripada mengarang. Buat jawaban singkat tapi memuaskan (2-4 kalimat kecuali penjelasan lebih dalam jelas dibutuhkan). TULISLAH dalam Bahasa Indonesia yang natural.

PENTING: JANGAN keluarkan blok <think> atau catatan "berpikir". JANGAN mengulang instruksi prompt. LANGSUNG tulis jawaban final dalam 1-2 paragraf.`;
  const context = priorAnswers.length
    ? `\nSebelumnya dalam eksplorasi ini kita sudah membahas:\n- ${priorAnswers.slice(-3).join("\n- ")}`
    : "";
  const prompt = `Subjek (Penemuan): "${discovery.hook}"
Konteks: ${discovery.teaser}
Pertanyaan awal: ${discovery.question}
Kategori: ${discovery.category}${context}

Pengguna, di tengah eksplorasi, bertanya:
"${userQuestion}"

Jawab dengan cara yang melanjutkan rasa penasaran mereka. Jangan keluar dari peran atau memulai sesi chatbot umum.`;
  return callLLM({ system: sys, prompt, temperature: 0.6, maxTokens: 700, signal });
}

// ─── Daily Rabbit Hole (PRD §14) ─────────────────────────────
// Generate satu curated journey harian: rantai topik lintas-bidang.
// Daily journey itu feed global (bukan per-user), jadi pakai profil "daily"
// yang diseksekusi bersama antar user.
export async function generateDailyJourney(
  signal?: AbortSignal,
  profileId: string = "daily"
) {
  const profile = await getLearnerContext(profileId);
  const sys = `Kamu menyusun SATU perjalanan "lubang kelinci" yang kohesif untuk aplikasi rasa penasaran — rantai 4-5 subjek menarik yang saling terhubung dan melintasi bidang (sejarah → teknologi → alam → filsafat, dll). Setiap langkah harus nyata dan terhubung ke langkah sebelumnya. Keluarkan HANYA objek JSON mentah, tanpa markdown, tanpa komentar. JANGAN bungkus dalam code fence dan JANGAN menambah teks di luar JSON. TULISLAH semua teks (title, theme, topic, blurb) dalam Bahasa Indonesia.`;
  const prompt = `Buat SATU perjalanan lubang kelinci harian.
${profile.curiousTopics.length ? `Cenderung ke: ${profile.curiousTopics.slice(0, 8).join(", ")}.` : ""}
${profile.avoidTopics.length ? `Hindari: ${profile.avoidTopics.slice(0, 8).join(", ")}.` : ""}

Kembalikan HANYA JSON:
{ "title": string, "theme": string, "steps": [ { "topic": string, "blurb": string, "category": string } ] }
di mana steps berisi 4-5 entri, setiap blurb adalah 1 kalimat memikat yang diakhiri pertanyaan yang mengarah ke langkah berikutnya.`;
  return callLLMJson<{
    title: string;
    theme: string;
    steps: { topic: string; blurb: string; category: string }[];
  }>({
    system: sys,
    prompt,
    temperature: 0.85,
    maxTokens: 2048,
    signal,
  });
}


// ─── Context pengguna untuk ranking & anti-repetition ───────────
// `profileId` = kode akses user (dijadikan id LearnerProfile), jadi konteks
// personalisasi (riwayat, minat, anti-repetition) itu per-user.
export async function getLearnerContext(profileId: string) {
  const profile =
    (await prisma.learnerProfile.findUnique({ where: { id: profileId } })) ??
    (await prisma.learnerProfile.create({ data: { id: profileId } }));

  const [deliveries, interests, recentDeliveries] = await Promise.all([
    prisma.discoveryDelivery.findMany({
      where: { profileId },
      select: { discovery: { select: { hook: true } } },
      take: 50,
    }),
    prisma.interestTag.findMany({ where: { profileId } }),
    prisma.discoveryDelivery.findMany({
      where: { profileId },
      orderBy: { deliveredAt: "desc" },
      take: 20,
      select: { discovery: { select: { hook: true } } },
    }),
  ]);

  return {
    depthPreference: profile.depthPreference,
    curiousTopics: interests.filter((i) => i.type === "curious").map((i) => i.tag),
    avoidTopics: interests.filter((i) => i.type === "avoid").map((i) => i.tag),
    recentHooks: recentDeliveries.map((d) => d.discovery.hook),
    deliveredHooks: deliveries.map((d) => d.discovery.hook),
  };
}

// ─── Simpan discovery lengkap ke DB (cascade sources) ──────────
export async function persistDiscovery(
  c: CandidateDiscovery,
  computedScore: number,
  status: string = "candidate"
) {
  const topic = await prisma.topic.upsert({
    where: { slug: c.topicSlug },
    update: { name: c.topicName, category: c.category, summary: c.topicSummary },
    create: { slug: c.topicSlug, name: c.topicName, category: c.category, summary: c.topicSummary },
  });

  return prisma.discovery.create({
    data: {
      topicId: topic.id,
      category: c.category,
      hook: c.hook,
      teaser: c.teaser,
      question: c.question,
      surprise: c.surprise,
      curiosity: c.curiosity,
      credibility: c.credibility,
      depthPotential: c.depthPotential,
      discoveryScore: computedScore,
      status,
      sources: {
        create: c.sources.map((s) => ({
          source: {
            create: {
              title: s.title,
              url: s.url ?? null,
              author: s.author ?? null,
              publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
              type: s.type,
              trustLevel: s.trustLevel,
              notes: s.note ?? null,
            },
          },
          claimStatus: s.claimStatus,
          confidence: s.confidence,
          note: s.note ?? null,
        })),
      },
    },
    include: { topic: true, sources: { include: { source: true } } },
  });
}

