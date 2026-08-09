import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzeFile, AttachmentValidationError, MAX_FILES } from "@/lib/attachments";

// POST /api/sessions/[id]/messages/[messageId]/attachments
// Multipart: files[] → simpan attachment ke message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await params;

  // Verifikasi message ada di session ini
  const message = await prisma.message.findFirst({
    where: { id: messageId, sessionId: id },
    select: { id: true },
  });
  if (!message) {
    return NextResponse.json({ error: "Message tidak ditemukan" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request harus multipart/form-data" },
      { status: 400 }
    );
  }

  const entries = formData.getAll("files");
  const files = entries.filter(
    (e): e is File => typeof e !== "string"
  );

  if (files.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada file yang diupload (field 'files')" },
      { status: 400 }
    );
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_FILES} file per pesan` },
      { status: 400 }
    );
  }

  // Analisa semua file sekaligus biar validasi cap-nya konsisten
  let analyzed;
  try {
    analyzed = await Promise.all(files.map((f) => analyzeFile(f)));
  } catch (err) {
    if (err instanceof AttachmentValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Analyze attachment error:", err);
    return NextResponse.json(
      { error: "Gagal memproses file" },
      { status: 400 }
    );
  }

  // Simpan tiap attachment (create per-row biar dapet id balik)
  try {
    const rows = await Promise.all(
      analyzed.map((a) =>
        prisma.attachment.create({
          data: {
            sessionId: id,
            messageId,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            data: a.data,
            textContent: a.textContent,
            route: a.route ?? null,
          },
        })
      )
    );

    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        size: r.size,
        route: r.route ?? undefined,
      })),
      { status: 201 }
    );
  } catch (err) {
    console.error("Create attachment error:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan attachment" },
      { status: 500 }
    );
  }
}
