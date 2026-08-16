import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import { saveDiscovery, recordEvent } from "@/lib/curiosity";
import { getCodeFromCookies, SUPER_ADMIN_CODE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Save topic (PRD §19 #9) ──────────────
// POST /api/curiosity/:discoveryId/save   body: { note?: string }
// Di-scope ke kode akses user (simpan per-user).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ discoveryId: string }> }
) {
  try {
    await ensureSessionOwnerCode();
    const code = getCodeFromCookies(await cookies()) ?? SUPER_ADMIN_CODE;
    const profileId = code;

    const { discoveryId } = await params;
    const exists = await prisma.discovery.findUnique({
      where: { id: discoveryId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Discovery tidak ditemukan" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note : undefined;
    await saveDiscovery(discoveryId, note, profileId);
    await recordEvent({ discoveryId, type: "saved" }, profileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Save error: ${msg}` }, { status: 502 });
  }
}
