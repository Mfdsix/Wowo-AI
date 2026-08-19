import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCodeFromCookies, isSuperAdmin } from "@/lib/auth";
import { getUsage } from "@/lib/ttsUsage";
import { maybeSyncGoogleTtsUsage } from "@/lib/googleMonitoring";

export const dynamic = "force-dynamic";

// ─── Super Admin: lihat usage TTS (Google Cloud) + status cutoff ────
// GET /api/admin/tts-usage  → 403 kalau kode di cookie bukan super admin.
export async function GET() {
  const code = getCodeFromCookies(await cookies());
  if (!isSuperAdmin(code)) {
    return NextResponse.json({ error: "Akses super admin ditolak." }, { status: 403 });
  }

  // Trigger reconcile berkala (lazy) biar angka "sisa" ke-sync dari Google.
  await maybeSyncGoogleTtsUsage();

  const usage = await getUsage();
  return NextResponse.json(usage);
}
