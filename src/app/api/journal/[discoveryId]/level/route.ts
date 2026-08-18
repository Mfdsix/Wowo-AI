import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrGenerateLevel } from "@/lib/journal";

export const dynamic = "force-dynamic";

// ─── Journal Engine: Depth level L1–L4 (PRD §9) ──────────────
// POST /api/journal/:discoveryId/level   body: { level: 1-4 }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    const { discoveryId } = await params;
    const body = await req.json().catch(() => ({}));
    const level = Number(body?.level);
    if (!Number.isInteger(level) || level < 1 || level > 4) {
      return NextResponse.json({ error: "level harus integer 1–4" }, { status: 400 });
    }

    const discovery = await prisma.discovery.findUnique({
      where: { id: discoveryId },
      select: { id: true, hook: true, teaser: true, question: true, category: true },
    });
    if (!discovery) {
      return NextResponse.json({ error: "Discovery tidak ditemukan" }, { status: 404 });
    }

    const levelRow = await getOrGenerateLevel(discovery, level, req.signal);
    return NextResponse.json({
      level: levelRow.level,
      title: levelRow.title,
      content: levelRow.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Journal level error: ${msg}` }, { status: 502 });
  }
}
