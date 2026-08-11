// ─── Konfigurasi & prompt builder podcast mode ──────────────────────

export type Speaker = "host" | "guestA" | "guestB";

export interface PodcastConfig {
  names: Record<Speaker, string>;
  maxTurns: number;
}

export const SPEAKER_ORDER: Speaker[] = ["host", "guestA", "guestB"];

// Urutan giliran: host → tamuA → tamuB → host → ...
export function speakerAt(turnIndex: number): Speaker {
  return SPEAKER_ORDER[turnIndex % SPEAKER_ORDER.length];
}

export const DEFAULT_PODCAST_CONFIG: PodcastConfig = {
  names: { host: "Host", guestA: "Tamu A", guestB: "Tamu B" },
  maxTurns: 24,
};

// Mapping suara default (bahasa Indonesia).
// Edge-TTS cuma punya 2 suara id-ID, jadi Tamu B (pria kedua) dibuat dari
// Ardi yang dipitch-shift lebih dalam biar beda dari Host.
export const DEFAULT_VOICES: Record<
  Speaker,
  { voice: string; pitchShift: number }
> = {
  host: { voice: "id-ID-ArdiNeural", pitchShift: 0 },
  guestA: { voice: "id-ID-GadisNeural", pitchShift: 0 },
  guestB: { voice: "id-ID-ArdiNeural", pitchShift: -2 },
};

export function voiceFor(speaker: Speaker): { voice: string; pitchShift: number } {
  return DEFAULT_VOICES[speaker];
}

// Persona tiap speaker — nada santai talkshow Indonesia.
const PERSONAS: Record<Speaker, string> = {
  host: "Pemandu talkshow yang hangat, energik, dan penasaran. " +
    "Pake bahasa Indonesia santai sehari-hari (boleh 'gue/lo'). " +
    "Tugasnya ngebuka topik, ngegiring diskusi, dan ngajuin pertanyaan " +
    "yang bikin tamu pengen cerita.",
  guestA: "Tamu pertama, praktisi/penikmat yang nguasain banget topik yang lagi dibahas. " +
    "Antusias, suka kasih contoh konkret dan cerita pengalaman pribadi. " +
    "Ngobrolnya santai dan asik.",
  guestB: "Tamu kedua, punya sudut pandang yang agak beda dari Tamu A. " +
    "Suka nambahin perspektif, kadang ngedebat sehat, sesekali ngebalik " +
    "pertanyaan biar diskusi makin seru.",
};

const RULES = `Aturan giliran:
- Keluarkan HANYA ucapan yang diucapkan oleh pembicara saat ini, untuk SATU giliran ini.
- JANGAN tulis nama/prefix/label (mis. "Host:", "[Tamu]"), JANGAN markdown, JANGAN arah panggung, JANGAN emoji.
- Panjang 2-4 kalimat, natural kaya lagi ngobrol live, bukan baca naskah.
- Bangun dari yang udah diomongin sebelumnya — bawa diskusi MAJU, jangan ulang kalimat verbatim.
- Kalau pembicara = host: arahkan obrolan ke tamu, giring supaya mereka cerita.
- Kalau pembicara = tamu: tanggapi host lalu kembangin, kasih detail/contoh.
- Kalau ada [CATATAN PRODUSER]: lempar topik itu ke diskusi secara NATURAL di giliran ini, tanpa nyebut kata "produser" atau "catatan".
- Jaga persona tetap konsisten dengan deskripsi di atas.`;

export function buildPodcastSystemPrompt(
  speaker: Speaker,
  names: Record<Speaker, string>
): string {
  const all = SPEAKER_ORDER.map(
    (s) => `- ${names[s]}: ${PERSONAS[s]}`
  ).join("\n");
  return [
    "Kamu adalah penulis naskah talkshow radio Indonesia yang hidup dan natural.",
    "",
    "Pemain:",
    all,
    "",
    `Saat ini giliran: ${names[speaker]}.`,
    "",
    RULES,
  ].join("\n");
}

// ─── Bentuk history untuk model ─────────────────────────────────────
// Turn on-air → "NamaSpeaker: teks"; pesan user (prompt awal / note) → "(Produser): teks".
export interface PodcastHistoryEntry {
  role: "user" | "assistant";
  speaker?: string | null;
  content: string;
}

export function buildHistoryForModel(
  history: PodcastHistoryEntry[],
  names: Record<Speaker, string>
): string {
  if (history.length === 0) return "(belum ada diskusi)";
  return history
    .map((m) => {
      if (m.role === "assistant") {
        const key = m.speaker as Speaker;
        const name = key && names[key] ? names[key] : "Pembicara";
        return `${name}: ${m.content}`;
      }
      return `(Produser): ${m.content}`;
    })
    .join("\n");
}

// ─── Bersihin teks sebelum dikirim ke TTS ───────────────────────────
export function sanitizeForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~#>{}\-]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
