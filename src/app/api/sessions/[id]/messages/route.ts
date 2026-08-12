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
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      speaker: true,
      bookmarked: true,
      replyToId: true,
      quoteText: true,
      createdAt: true,
      attachments: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          route: true,
          status: true,
          progress: true,
          error: true,
          _count: { select: { chunks: true } },
        },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  // Summary index: jumlah chunk + halaman terakhir yang ke-index (max pageEnd).
  // Satu query groupBy buat semua attachment di session (hindari N+1).
  const attIds = messages.flatMap((m) => m.attachments.map((a) => a.id));
  const pageAgg = attIds.length
    ? await prisma.docChunk.groupBy({
        by: ["attachmentId"],
        _max: { pageEnd: true },
        where: { attachmentId: { in: attIds } },
      })
    : [];
  const pageByAtt = new Map(pageAgg.map((g) => [g.attachmentId, g._max.pageEnd]));

  const result = messages.map((m) => ({
    ...m,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      route: a.route,
      status: a.status,
      progress: a.progress,
      error: a.error,
      chunkCount: a._count.chunks,
      pageCount: pageByAtt.get(a.id) ?? undefined,
    })),
  }));

  return NextResponse.json(result);
}

// POST /api/sessions/[id]/messages — simpan pesan baru
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { role, content, model, speaker, bookmarked, replyToId, quoteText } =
    await req.json();

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
      speaker: speaker || null,
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

// DELETE /api/sessions/[id]/messages?after=<messageId> — hapus semua pesan
// yang dibuat SETELAH message tertentu. Dipakai "lanjut dari sini" di
// podcast: truncate kelanjutan biar regenerate dari titik itu.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const after = req.nextUrl.searchParams.get("after");

  if (!after) {
    return NextResponse.json(
      { error: "param 'after' (messageId) wajib diisi" },
      { status: 400 }
    );
  }

  // Ambil semua id pesan urut kencan bikin. Cari posisi anchor, hapus yang
  // SETELAHnya. (pakai posisi list, bukan banding timestamp — biar aman dari
  // pesan yang serialize di milidetik yang sama).
  const ordered = await prisma.message.findMany({
    where: { sessionId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const anchorIdx = ordered.findIndex((m) => m.id === after);
  if (anchorIdx === -1) {
    return NextResponse.json(
      { error: "message acuan tidak ditemukan di session ini" },
      { status: 404 }
    );
  }

  // Hapus pesan SETELAH anchor (ke-truncate, bukan ke-delete).
  const toDelete = ordered
    .slice(anchorIdx + 1)
    .map((m) => m.id);
  if (toDelete.length > 0) {
    await prisma.message.deleteMany({ where: { id: { in: toDelete } } });
  }

  return NextResponse.json({ ok: true, deleted: toDelete.length });
}
