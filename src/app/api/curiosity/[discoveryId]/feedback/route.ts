import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/curiosity";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: feedback / memory capture (PRD §11, §23) ──
// POST /api/curiosity/:discoveryId/feedback
//   body: { type: "explore_clicked" | "level_reached" | "deep_dive" |
//                "question_explored" | "already_knew" | "not_interested" |
//                "didnt_know" | "stopped", level?: number, metadata?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    const { discoveryId } = await params;
    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    if (typeof type !== "string" || !type.trim()) {
      return NextResponse.json({ error: "type wajib diisi" }, { status: 400 });
    }
    const level = typeof body?.level === "number" ? body.level : undefined;
    const metadata = typeof body?.metadata === "string" ? body.metadata : undefined;
    const ev = await recordEvent({ discoveryId, type, level, metadata });
    return NextResponse.json({ ok: true, id: ev.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Feedback error: ${msg}` }, { status: 502 });
  }
}
