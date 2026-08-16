import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateCandidate,
  scoreCandidate,
  personalNovelty,
  getLearnerContext,
  persistDiscovery,
  type CandidateDiscovery,
} from "@/lib/curiosity";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Discovery Generator pipeline (PRD §20) ───
// POST /api/curiosity/generate
//   1. Discover  → generateCandidate (AI)
//   2. Quality / Fact-Check → scoreCandidate (composite score + flag)
//   3. Personal Ranking → personalNovelty (anti-repetition, §7/§12)
//   4. Persist (candidate) + record DiscoveryDelivery (history)
//
// Body opsional: { "force": boolean } untuk bypass cache/anti-repetition.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const profile = await getLearnerContext();

    let candidate: CandidateDiscovery;
    let attempts = 0;
    let bestNovelty = -1;

    // Coba sampai dapat discovery yang punya novelty cukup (anti-repetition).
    do {
      candidate = await generateCandidate(profile, req.signal);
      const novelty = personalNovelty(candidate, profile);
      bestNovelty = Math.max(bestNovelty, novelty);
      attempts++;
      if (force) break;
      // Terima kalau novelty ≥ 0.6, atau sudah 3x gagal dapat yang lebih baik.
      if (novelty >= 0.6 || attempts >= 3) break;
    } while (true);

    const { composite, flagged } = scoreCandidate(candidate);
    const novelty = personalNovelty(candidate, profile);
    // Final score = composite × personalNovelty (PRD §7).
    const finalScore = composite * novelty;

    // Status pipeline: low_credibility → reject otomatis (gate §16/§20).
    const status = flagged === "low_credibility" ? "rejected" : "approved";

    const discovery = await persistDiscovery(candidate, finalScore, status);

    // Catat delivery (history + anti-repetition ledger, §12).
    await prisma.discoveryDelivery.create({
      data: {
        profileId: "default",
        discoveryId: discovery.id,
        outcome: "viewed",
      },
    });

    return NextResponse.json({
      discovery: {
        id: discovery.id,
        topicId: discovery.topicId,
        category: discovery.category,
        hook: discovery.hook,
        teaser: discovery.teaser,
        question: discovery.question,
        status: discovery.status,
      },
      scores: {
        surprise: candidate.surprise,
        curiosity: candidate.curiosity,
        credibility: candidate.credibility,
        depthPotential: candidate.depthPotential,
        composite,
        personalNovelty: novelty,
        finalScore,
        flagged,
        attempts,
      },
      sources:
        discovery.sources?.map((ds) => ({
          title: ds.source.title,
          url: ds.source.url,
          trustLevel: ds.source.trustLevel,
          claimStatus: ds.claimStatus,
        })) ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly =
      msg.includes("HTTP 4") || msg.includes("HTTP 5")
        ? "LLM gateway error. Cek LLM_BASE_URL, LLM_API_KEY, LLM_MODEL."
        : msg.includes("JSON")
        ? "Model gagal mengembalikan JSON valid. Coba lagi."
        : `Curiosity generate error: ${msg}`;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
