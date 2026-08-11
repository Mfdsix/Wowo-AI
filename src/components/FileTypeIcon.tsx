"use client";

import { File, FileImage, FileText, FileCode, FileSpreadsheet, FileArchive, FileAudio, FileVideo } from "lucide-react";

type Props = {
  mimeType: string;
  size?: number;
  className?: string;
};

// Icon tipe file berdasarkan mimeType — dipake di chat bubble & pending chips.
// Return elemen JSX langsung (bukan referensi komponen dinamis) biar lolos
// rule react-hooks/static-components.
export default function FileTypeIcon({ mimeType, size = 14, className }: Props) {
  const m = mimeType.toLowerCase();

  if (m.startsWith("image/")) return <FileImage size={size} className={className} />;
  if (m.startsWith("audio/")) return <FileAudio size={size} className={className} />;
  if (m.startsWith("video/")) return <FileVideo size={size} className={className} />;
  if (m === "application/pdf") return <FileText size={size} className={className} />;
  if (m.includes("wordprocessingml") || m.includes("msword")) return <FileText size={size} className={className} />;
  if (m.includes("spreadsheet") || m === "text/csv") return <FileSpreadsheet size={size} className={className} />;
  if (m.includes("zip") || m.includes("archive") || m.includes("compressed") || m.includes("rar") || m.includes("tar")) return <FileArchive size={size} className={className} />;
  if (m.startsWith("text/") || m.includes("javascript") || m.includes("json") || m.includes("xml") || m.includes("x-")) return <FileCode size={size} className={className} />;
  return <File size={size} className={className} />;
}
