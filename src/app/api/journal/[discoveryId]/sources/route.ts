import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─── Journal Engine: Source verification (§16) ───────────────
// GET /api/journal/:discoveryId/sources → paper asli + DOI + sitasi.
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
    return NextResponse.json({ error: `Journal sources error: ${msg}` }, { status: 502 });
  }
}
