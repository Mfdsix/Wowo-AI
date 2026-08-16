import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureSessionOwnerCode } from "@/lib/prisma";
import { recordEvent } from "@/lib/curiosity";
import { getCodeFromCookies, SUPER_ADMIN_CODE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: feedback / memory capture (PRD §11, §23) ──
// POST /api/curiosity/:discoveryId/feedback
//   body: { type: "explore_clicked" | "level_reached" | "deep_dive" |
//                "question_explored" | "already_knew" | "not_interested" |
//                "didnt_know" | "stopped", level?: number, metadata?: string }
// Di-scope ke kode akses user (profileId).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    await ensureSessionOwnerCode();
    const code = getCodeFromCookies(await cookies()) ?? SUPER_ADMIN_CODE;
    const profileId = code;

    const { discoveryId } = await params;
    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    if (typeof type !== "string" || !type.trim()) {
      return NextResponse.json({ error: "type wajib diisi" }, { status: 400 });
    }
    const level = typeof body?.level === "number" ? body.level : undefined;
    const metadata = typeof body?.metadata === "string" ? body.metadata : undefined;
    const ev = await recordEvent({ discoveryId, type, level, metadata }, profileId);
    return NextResponse.json({ ok: true, id: ev.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Feedback error: ${msg}` }, { status: 502 });
  }
}
