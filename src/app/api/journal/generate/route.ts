import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import {
  generateJournalDiscovery,
  getLearnerContext,
} from "@/lib/journal";
import { getCodeFromCookies, SUPER_ADMIN_CODE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Journal Engine: Discovery Generator (real peer-reviewed) ──
// POST /api/journal/generate
//   search → select → compose (LLM) → persist (category="journal").
// Di-scope ke kode akses user di cookie (history per-user).
export async function POST(req: NextRequest) {
  try {
    await ensureSessionOwnerCode();
    const code = getCodeFromCookies(await cookies()) ?? SUPER_ADMIN_CODE;
    const profileId = code;

    const profile = await getLearnerContext(profileId);
    const discovery = await generateJournalDiscovery(profile, req.signal);

    // Catat delivery (history + anti-repetition ledger).
    await prisma.discoveryDelivery.create({
      data: {
        profileId,
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
      sources:
        discovery.sources?.map((ds) => ({
          title: ds.source.title,
          url: ds.source.url,
          trustLevel: ds.source.trustLevel,
          claimStatus: ds.claimStatus,
          note: ds.note ?? ds.source.notes,
        })) ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly =
      msg.includes("HTTP 4") || msg.includes("HTTP 5")
        ? "LLM gateway error. Cek LLM_BASE_URL, LLM_API_KEY, LLM_MODEL."
        : msg.includes("Tidak ada paper")
        ? "Gagal mengambil jurnal dari API (arXiv/Semantic Scholar/OpenAlex). Cek koneksi internet, lalu coba lagi."
        : msg.includes("JSON")
        ? "Model gagal mengembalikan JSON valid. Coba lagi."
        : `Journal generate error: ${msg}`;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
