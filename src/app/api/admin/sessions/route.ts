import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  getCodeFromCookies,
  isSuperAdmin,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Super Admin: lihat semua sesi yang pernah terbuat ──────────────────
// GET /api/admin/sessions  → 403 kalau kode di cookie bukan super admin.
export async function GET() {
  await ensureSessionOwnerCode();
  const code = getCodeFromCookies(await cookies());
  if (!isSuperAdmin(code)) {
    return NextResponse.json({ error: "Akses super admin ditolak." }, { status: 403 });
  }

  const sessions = await prisma.session.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      ownerCode: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true, designerPages: true, attachments: true } },
    },
  });

  // Ringkas per-user: jumlah sesi & total pesan per ownerCode.
  const byUser = new Map<
    string,
    { code: string; sessions: number; messages: number }
  >();
  for (const s of sessions) {
    const key = s.ownerCode ?? "__legacy__";
    const agg = byUser.get(key) ?? { code: key, sessions: 0, messages: 0 };
    agg.sessions += 1;
    agg.messages += s._count.messages;
    byUser.set(key, agg);
  }

  return NextResponse.json({
    sessions,
    users: Array.from(byUser.values()),
  });
}
