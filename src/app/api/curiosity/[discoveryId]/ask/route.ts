import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { askDiscovery, recordEvent } from "@/lib/curiosity";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Contextual Ask (PRD §10) ─────────────
// POST /api/curiosity/:discoveryId/ask
//   body: { question: string, priorAnswers?: string[] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    const { discoveryId } = await params;
    const discovery = await prisma.discovery.findUnique({
      where: { id: discoveryId },
      select: { hook: true, teaser: true, question: true, category: true },
    });
    if (!discovery) {
      return NextResponse.json({ error: "Discovery tidak ditemukan" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "question wajib diisi" }, { status: 400 });
    }
    const prior: string[] = Array.isArray(body?.priorAnswers) ? body.priorAnswers : [];

    const answer = await askDiscovery(discovery, question, prior, req.signal);

    await recordEvent({
      discoveryId,
      type: "question_asked",
      metadata: JSON.stringify({ question, answer: answer.slice(0, 500) }),
    });

    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Ask error: ${msg}` }, { status: 502 });
  }
}
