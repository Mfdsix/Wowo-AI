import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, ensureSessionOwnerCode } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  getCodeFromCookies,
  isValidCode,
  isSuperAdmin,
  sessionScopeWhere,
} from "@/lib/auth";

// GET /api/sessions — list session milik kode di cookie (atau semua kalau super admin)
export async function GET() {
  await ensureSessionOwnerCode();
  const code = getCodeFromCookies(await cookies());
  const sessions = await prisma.session.findMany({
    where: sessionScopeWhere(code),
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      designStyle: true,
      mode: true,
      podcastConfig: true,
      ownerCode: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({ sessions, code: code ?? null, isAdmin: isSuperAdmin(code) });
}

// POST /api/sessions — bikin session baru untuk kode di cookie.
// Kalau belum login (gak ada kode valid) → 401. Super admin bikin sesi miliknya sendiri.
export async function POST(req: NextRequest) {
  await ensureSessionOwnerCode();
  const code = getCodeFromCookies(await cookies());
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "Akses ditolak. Masukkan kode akses dahulu." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const title = body.title || "New Chat";
  const designStyle = typeof body.designStyle === "string" ? body.designStyle : null;
  const mode =
    typeof body.mode === "string" &&
    ["chat", "designer", "podcast"].includes(body.mode)
      ? body.mode
      : "chat";
  const podcastConfig =
    typeof body.podcastConfig === "string" ? body.podcastConfig : null;

  const session = await prisma.session.create({
    data: { title, designStyle, mode, podcastConfig, ownerCode: code! },
    select: {
      id: true,
      title: true,
      designStyle: true,
      mode: true,
      ownerCode: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(session, { status: 201 });
}
