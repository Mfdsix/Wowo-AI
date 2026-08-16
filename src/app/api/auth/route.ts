import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  isValidCode,
  isSuperAdmin,
  generateCode,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Auth: 6-digit access code ──────────────────────────────────────────
// POST /api/auth  body: { code?: string; generate?: boolean }
//   - generate=true  → bikin kode random baru, set cookie, balikin kode
//   - code=<6char>   → validasi, set cookie, balikin { ok, code, isAdmin }
// DELETE /api/auth   → logout (hapus cookie)
export async function POST(req: NextRequest) {
  await ensureSessionOwnerCode();
  const body = await req.json().catch(() => ({}));

  let code: string;
  if (body?.generate === true) {
    code = generateCode();
  } else if (typeof body?.code === "string") {
    const trimmed = body.code.trim();
    if (!isValidCode(trimmed)) {
      return NextResponse.json(
        { error: "Kode harus 6 karakter huruf atau angka." },
        { status: 400 }
      );
    }
    code = trimmed;
  } else {
    return NextResponse.json(
      { error: "Masukkan kode akses atau minta generate." },
      { status: 400 }
    );
  }

  // Untuk kode non-admin: kalau belum ada sesi sama sekali dengan kode ini,
  // kita anggap ini user baru & bikin sesi pertama otomatis biar langsung bisa dipakai.
  if (!isSuperAdmin(code)) {
    const count = await prisma.session.count({ where: { ownerCode: code } });
    if (count === 0) {
      await prisma.session.create({
        data: { title: "New Chat", ownerCode: code, mode: "chat" },
      });
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 tahun
  });

  return NextResponse.json({ ok: true, code, isAdmin: isSuperAdmin(code) });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
