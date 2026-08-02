import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/sessions/[id]/messages/[messageId]
// Body: { bookmarked?: boolean } — kalo kosong, toggle
// Atau: { bookmarked: true/false } — set langsung
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await params;

  // Cek pesan ada di session ini
  const existing = await prisma.message.findFirst({
    where: { id: messageId, sessionId: id },
    select: { bookmarked: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  let bookmarked: boolean;
  const body = await req.json().catch(() => ({}));

  if (typeof body.bookmarked === "boolean") {
    bookmarked = body.bookmarked;
  } else {
    // Toggle
    bookmarked = !existing.bookmarked;
  }

  const message = await prisma.message.update({
    where: { id: messageId },
    data: { bookmarked },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      bookmarked: true,
      replyToId: true,
      quoteText: true,
      createdAt: true,
    },
  });

  return NextResponse.json(message);
}

// GET /api/sessions/[id]/messages/[messageId] — ambil 1 pesan
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await params;

  const message = await prisma.message.findFirst({
    where: { id: messageId, sessionId: id },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      bookmarked: true,
      createdAt: true,
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json(message);
}
