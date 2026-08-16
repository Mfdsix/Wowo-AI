import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import { getCodeFromCookies, SUPER_ADMIN_CODE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: History & Saves (PRD §12, §19) ──────
// GET /api/curiosity/history  → discovery terakhir + saved topics.
// Di-scope ke kode akses user di cookie (history per-user).
export async function GET(req: NextRequest) {
  try {
    await ensureSessionOwnerCode();
    const code = getCodeFromCookies(await cookies()) ?? SUPER_ADMIN_CODE;
    const profileId = code;

    const url = new URL(req.url);
    // Default: semua delivery (semua penemuan yang pernah muncul) biar bisa
    // dibuka lagi kapanpun. ?saved=1 → cuma yang di-Simpan (bookmark header).
    const savedOnly = url.searchParams.get("saved") === "1";

    const deliveries = await prisma.discoveryDelivery.findMany({
      where: { profileId },
      orderBy: { deliveredAt: "desc" },
      take: 40,
      select: {
        deliveredAt: true,
        outcome: true,
        maxDepth: true,
        discovery: {
          select: {
            id: true,
            hook: true,
            category: true,
            question: true,
            saves: { where: { profileId }, select: { id: true } },
          },
        },
      },
    });

    const items = deliveries
      .filter((d) => (savedOnly ? d.discovery.saves.length > 0 : true))
      .map((d) => ({
        id: d.discovery.id,
        hook: d.discovery.hook,
        category: d.discovery.category,
        question: d.discovery.question,
        outcome: d.outcome,
        maxDepth: d.maxDepth,
        saved: d.discovery.saves.length > 0,
        deliveredAt: d.deliveredAt,
      }));

    return NextResponse.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `History error: ${msg}` }, { status: 502 });
  }
}
