import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/sessions/[id]/designer-pages — list pages utk session
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const pages = await prisma.designerPage.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      html: true,
      versions: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(pages);
}

// POST /api/sessions/[id]/designer-pages — bikin page baru
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name, html } = await req.json();

  if (!html || typeof html !== "string") {
    return NextResponse.json({ error: "html wajib diisi" }, { status: 400 });
  }

  // Auto-increment nama kalo gak dikasih
  let pageName = name || "Page";
  if (!name) {
    const count = await prisma.designerPage.count({ where: { sessionId: id } });
    pageName = `Page ${count + 1}`;
  }

  const page = await prisma.designerPage.create({
    data: {
      sessionId: id,
      name: pageName,
      html,
      versions: [],
    },
    select: {
      id: true,
      name: true,
      html: true,
      versions: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(page, { status: 201 });
}
