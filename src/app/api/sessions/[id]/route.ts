import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/sessions/[id] — hapus session & messages (cascade)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.session.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

// PATCH /api/sessions/[id] — update title / designStyle session
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { title, designStyle } = body;

  const data: { title?: string; designStyle?: string | null } = {};
  if (typeof title === "string" && title.trim()) data.title = title.trim().slice(0, 100);
  if (typeof designStyle === "string") data.designStyle = designStyle || null; // "" → unlock

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "title atau designStyle wajib diisi" },
      { status: 400 }
    );
  }

  const session = await prisma.session.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      designStyle: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(session);
}

// GET /api/sessions/[id] — detail session
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      designStyle: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(session);
}
