import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  getCodeFromCookies,
  isSuperAdmin,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Super Admin: login-as / impersonate sesi tertentu ───────────────────
// POST /api/admin/sessions/[id]/impersonate
//   → set cookie wowo_session = ownerCode session tsb (atau 78900 kalau legacy).
//   Admin jadi "ngintip" sebagai user pemilik sesi tersebut.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSessionOwnerCode();
  const code = getCodeFromCookies(await cookies());
  if (!isSuperAdmin(code)) {
    return NextResponse.json({ error: "Akses super admin ditolak." }, { status: 403 });
  }

  const { id } = await params;
  const session = await prisma.session.findUnique({
    where: { id },
    select: { id: true, ownerCode: true, title: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
  }

  // Legacy (gak punya owner) → impersonate lewat super admin code juga,
  // tapi biar admin tetap bisa "login as" kita set cookie ke 78900 + query ?peek=id
  // di client. Untuk sesi ber-owner, langsung set cookie ke ownerCode-nya.
  const targetCode = session.ownerCode ?? "789000";

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, targetCode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    title: session.title,
    targetCode,
  });
}
