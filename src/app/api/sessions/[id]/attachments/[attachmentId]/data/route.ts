import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/sessions/[id]/attachments/[attachmentId]/data
// Return raw bytes attachment (buat thumbnail & regenerate re-upload)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params;

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, sessionId: id },
    select: { data: true, mimeType: true },
  });

  if (!attachment || !attachment.data) {
    return NextResponse.json({ error: "Attachment tidak ditemukan" }, { status: 404 });
  }

  return new Response(attachment.data, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
