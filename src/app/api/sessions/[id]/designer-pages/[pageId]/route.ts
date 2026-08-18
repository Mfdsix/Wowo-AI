import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uuid } from "@/lib/uuid";

// PATCH /api/sessions/[id]/designer-pages/[pageId]
// - rename / update html (dengan snapshot versi)
// - revert: kirim { revertToVersionId }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;

  const existing = await prisma.designerPage.findFirst({
    where: { id: pageId, sessionId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const { name, html, revertToVersionId } = await req.json();

  type PageVersion = { id: string; html: string; updatedAt: string };
  const versions: PageVersion[] = Array.isArray(existing.versions)
    ? (existing.versions as unknown as PageVersion[])
    : [];

  // ─── REVERT ke versi tertentu ───
  if (revertToVersionId) {
    const target = versions.find((v) => v.id === revertToVersionId);
    if (!target) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    // Simpan state sekarang sebagai versi baru (biar bisa undo revert)
    const newVersions = [
      { id: uuid(), html: existing.html, updatedAt: new Date().toISOString() },
      ...versions,
    ].slice(0, 20);

    const page = await prisma.designerPage.update({
      where: { id: pageId },
      data: {
        html: target.html,
        versions: newVersions,
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
    return NextResponse.json(page);
  }

  // ─── UPDATE html (dengan snapshot versi lama) ───
  if (html !== undefined && html !== existing.html) {
    const newVersions = [
      { id: uuid(), html: existing.html, updatedAt: new Date().toISOString() },
      ...versions,
    ].slice(0, 20);

    const page = await prisma.designerPage.update({
      where: { id: pageId },
      data: {
        name: name !== undefined ? name : existing.name,
        html,
        versions: newVersions,
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
    return NextResponse.json(page);
  }

  // ─── Rename doang ───
  const page = await prisma.designerPage.update({
    where: { id: pageId },
    data: {
      name: name !== undefined ? name : existing.name,
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

  return NextResponse.json(page);
}

// DELETE /api/sessions/[id]/designer-pages/[pageId] — hapus page
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;

  const existing = await prisma.designerPage.findFirst({
    where: { id: pageId, sessionId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  await prisma.designerPage.delete({ where: { id: pageId } });

  return NextResponse.json({ ok: true });
}
