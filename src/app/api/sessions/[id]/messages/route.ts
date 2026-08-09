import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/sessions/[id]/messages — ambil semua pesan di session
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const messages = await prisma.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      bookmarked: true,
      replyToId: true,
      quoteText: true,
      createdAt: true,
      attachments: {
        select: { id: true, filename: true, mimeType: true, size: true, route: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json(messages);
}

// POST /api/sessions/[id]/messages — simpan pesan baru
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { role, content, model, bookmarked, replyToId, quoteText } = await req.json();

  if (!role || !content) {
    return NextResponse.json(
      { error: "role dan content wajib diisi" },
      { status: 400 }
    );
  }

  const message = await prisma.message.create({
    data: {
      sessionId: id,
      role,
      content,
      model: model || null,
      bookmarked: bookmarked ?? false,
      replyToId: replyToId || null,
      quoteText: quoteText || null,
    },
  });

  // Update session updatedAt
  await prisma.session.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(message, { status: 201 });
}
