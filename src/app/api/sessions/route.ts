import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/sessions — list semua session
export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      designStyle: true,
      mode: true,
      podcastConfig: true,
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
  const mode =
    typeof body.mode === "string" &&
    ["chat", "designer", "podcast"].includes(body.mode)
      ? body.mode
      : "chat";
  const podcastConfig =
    typeof body.podcastConfig === "string" ? body.podcastConfig : null;

  const session = await prisma.session.create({
    data: { title, designStyle, mode, podcastConfig },
    select: {
      id: true,
      title: true,
      designStyle: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(session, { status: 201 });
}
