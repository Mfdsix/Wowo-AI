import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateRabbitHoles } from "@/lib/curiosity";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Rabbit Hole generator (PRD §8) ─────────
// POST /api/curiosity/:discoveryId/rabbit-hole
//   → generate 3 branching follow-up questions, persist, return them.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    const { discoveryId } = await params;

    const discovery = await prisma.discovery.findUnique({
      where: { id: discoveryId },
      include: { questions: { select: { question: true } } },
    });
    if (!discovery) {
      return NextResponse.json({ error: "Discovery tidak ditemukan" }, { status: 404 });
    }

    const existing = discovery.questions.map((q) => q.question);
    const branches = await generateRabbitHoles(
      {
        hook: discovery.hook,
        teaser: discovery.teaser,
        question: discovery.question,
        category: discovery.category,
      },
      existing,
      req.signal
    );

    if (branches.length === 0) {
      return NextResponse.json({ error: "Gagal generate pertanyaan" }, { status: 502 });
    }

    const created = await prisma.rabbitHoleQuestion.createMany({
      data: branches.map((b) => ({
        discoveryId: discovery.id,
        question: b.question,
        order: b.order,
      })),
    });

    return NextResponse.json({ count: created.count, questions: branches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Rabbit hole error: ${msg}` },
      { status: 502 }
    );
  }
}
