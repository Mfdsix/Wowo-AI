import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/sessions — list semua session
export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      designStyle: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(sessions);
}

// POST /api/sessions — bikin session baru
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = body.title || "New Chat";
  const designStyle = typeof body.designStyle === "string" ? body.designStyle : null;

  const session = await prisma.session.create({
    data: { title, designStyle },
    select: {
      id: true,
      title: true,
      designStyle: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(session, { status: 201 });
}
