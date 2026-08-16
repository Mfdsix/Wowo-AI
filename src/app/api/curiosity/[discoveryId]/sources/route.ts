import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Source verification (PRD §16) ───────
// GET /api/curiosity/:discoveryId/sources → claims + sumber terkait.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    const { discoveryId } = await params;
    const links = await prisma.discoverySource.findMany({
      where: { discoveryId },
      include: { source: true },
      orderBy: { confidence: "desc" },
    });
    const sources = links.map((l) => ({
      title: l.source.title,
      url: l.source.url,
      author: l.source.author,
      publishedAt: l.source.publishedAt,
      type: l.source.type,
      trustLevel: l.source.trustLevel,
      claimStatus: l.claimStatus,
      confidence: l.confidence,
      note: l.note ?? l.source.notes,
    }));
    return NextResponse.json({ sources });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Sources error: ${msg}` }, { status: 502 });
  }
}
