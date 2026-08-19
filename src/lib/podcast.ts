// ─── Konfigurasi & prompt builder podcast mode ──────────────────────

export type Speaker = "host" | "guestA" | "guestB";

export interface PodcastConfig {
  names: Record<Speaker, string>;
  // Persona tiap speaker — EDITABLE oleh user setelah AI generate.
  // Kalau kosong (""), model pakai PERSONAS default di bawah.
  personas: Record<Speaker, string>;
  maxTurns: number;
}

export const SPEAKER_ORDER: Speaker[] = ["host", "guestA", "guestB"];

// Nilai yang model cuma nyalin dari placeholder contoh di prompt dianggap
// "tidak berguna" → di-kosongkan supaya frontend tetap pakai nilai user.
// Dipakai bersama di server (api/podcast/suggest-personas) & client (PodcastArea).
export const PLACEHOLDER_RE =
  /nama\s+(host|tamu)|persona\s+singkat|^\.{2,}$|^…$|^(host|tamu\s*[ab])$/i;

export function isPlaceholderValue(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const v = value.trim();
  return !v || PLACEHOLDER_RE.test(v);
}

// Urutan giliran: host → tamuA → tamuB → host → ...
export function speakerAt(turnIndex: number): Speaker {
  return SPEAKER_ORDER[turnIndex % SPEAKER_ORDER.length];
}

export const DEFAULT_PODCAST_CONFIG: PodcastConfig = {
  names: { host: "Host", guestA: "Tamu A", guestB: "Tamu B" },
  personas: { host: "", guestA: "", guestB: "" },
  maxTurns: 24,
};

// Maksimal entri history yang dikirim ke model per turn. Model cuma butuh
// beberapa ronde terakhir untuk nyambungin diskusi; prompt pendek = prefill
// lebih cepat = transisi antar-turn lebih mulus (gak nungguin generate).
export const PODCAST_HISTORY_LIMIT = 12;

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

// Persona tiap speaker — dibuat PENDEK supaya model lemah gak nge-echo
// deskripsi panjang ini sebagai "ucapan"-nya.
const PERSONAS: Record<Speaker, string> = {
  host: "Pemandu hangat & penasaran, bahasa santai, suka ngegiring tamu cerita.",
  guestA: "Praktisi yang nguasain topik, antusias, suka kasih contoh konkret.",
  guestB: "Sudut pandang beda, doyan ngedebat sehat, suka ngebalik pertanyaan.",
};

// Aturan pendek & imperatif — model lemah gampang kebingungan sama instruksi
// panjang bergaya essay, dan malah menyalin instruksi itu sebagai jawaban.
const RULES = `ATURAN (WAJIB PATUH):
- Output kamu = HANYA ucapan lisan pembicara saat ini, 2-4 kalimat, bahasa Indonesia santai sehari-hari.
- DILARANG menulis nama pembicara, tanda titik dua, label (mis. "Host:"), markdown, emoji, arah panggung, atau MENYALIN/MENJELASKAN instruksi ini.
- Fokus ke topik diskusi; jangan ngomongin hal di luar topik.
- Bangun dari yang udah diomongin — bawa diskusi maju, jangan ulang kalimat verbatim.
- Host: arahkan ke tamu biar mereka cerita. Tamu: tanggapi lalu kembangin dengan contoh.
- Kalau ada [CATATAN PRODUSER] di pesan user: lempar topiknya secara natural ke ucapan, tanpa nyebut kata "produser".`;

// Ambil persona tiap speaker: pakai nilai dari config kalau diisi user,
// kalau kosong → fallback ke PERSONAS default (biar model gak dapet prompt
// deskripsi kosong). PERSONAS tetap jadi cadangan saat persona gak diedit.
export function resolvePersonas(
  personas?: Record<Speaker, string> | null
): Record<Speaker, string> {
  const out = {} as Record<Speaker, string>;
  for (const s of SPEAKER_ORDER) {
    const v = personas?.[s];
    out[s] = v && !isPlaceholderValue(v) ? v.trim() : PERSONAS[s];
  }
  return out;
}

export function buildPodcastSystemPrompt(
  speaker: Speaker,
  names: Record<Speaker, string>,
  topic: string,
  personas?: Record<Speaker, string> | null
): string {
  const resolved = resolvePersonas(personas);
  const all = SPEAKER_ORDER.map(
    (s) => `- ${names[s]}: ${resolved[s]}`
  ).join("\n");
  return [
    "Kamu adalah pembicara dalam talkshow radio Indonesia yang LIVE.",
    `TOPIK DISKUSI: "${topic}"`,
    "",
    "Pemain:",
    all,
    "",
    `Sekarang giliran ${names[speaker]} bicara.`,
    "",
    RULES,
  ].join("\n");
}

// ─── Filter echo instruksi ──────────────────────────────────────────
// Model lemah kadang MENYALIN system prompt sebagai "ucapan"-nya (mis. nulis
// "Kamu adalah pembicara dalam talkshow..." atau "ATURAN: ..." verbatim).
// Pola di bawah nangkep frasa instruksi yang umum di-echo, dipakai untuk:
//   1) skip TTS kalimat yang jelas instruksi,
//   2) bersihin teks final sebelum ditampilkan/disimpan.
// Pola echo instruksi. DIANCHOR supaya gak false-positive di percakapan
// normal (mis. "aturan OJK", "topik diskusi kita", "ini sangat penting" —
// kata-kata itu wajar muncul di obrolan). Pola yang di-anchor ^ hanya
// nangkep kalau echo INSTRUKSI di awal kalimat/baris.
const INSTRUCTION_PATTERNS: RegExp[] = [
  /^kamu adalah (pembicara|penulis|asisten|model|ai|produser)/i,
  // Label pembicara di awal baris (echo format history). Anchor ^ + titik dua
  // biar "Host: ..." ke-tangkep tapi kalimat biasa "host kita" gak.
  /^(host|tamu\s*[ab])\s*:/i,
  // Wajib titik dua — kalau gak, "Topik diskusi kita hari ini..." (kalimat
  // host yang wajar) ikut ke-filter. Echo prompt selalu "TOPIK DISKUSI: ...".
  /^topik (utama )?diskusi:/i,
  /^aturan/i, // echo "ATURAN (WAJIB PATUH):" di awal baris
  /^sangat penting/i,
  /^pemain:/i,
  /^(saat ini|sekarang) giliran/i,
  /^instruksi/i,
  /^asisten/i,
  /^assistant:/i,
  /^system:/i,
  // Frasa khas blok reasoning (<think>) model hybrid — Inggris, gak akan
  // muncul di ucapan santai Bahasa Indonesia:
  /^here'?s? a thinking process/i,
  /analyze (the )?user input/i,
  /thought process/i,
  /(current|now|saat ini) (speaker|pembicara) is/i,
  // Berikut ini frasa yang praktis gak muncul di obrolan santai, jadi aman
  // di-match di mana pun:
  /penulis naskah/i,
  /talkshow radio/i,
  /fokus ke topik/i,
  /bangun dari yang udah diomongin/i,
  /bawa diskusi maju/i,
  /arahkan ke tamu/i,
  /catatan produser/i,
  /dilarang (keras|menulis|menggunakan|mengulang)/i,
  /keluarkan hanya/i,
  /tulis hanya/i,
  /output kamu/i,
  /jangan (tulis|menulis|mengulang|menjelaskan)/i,
  /berikut (adalah )?instruksi/i,
];

export function isInstructionEcho(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return INSTRUCTION_PATTERNS.some((re) => re.test(t));
}

/**
 * Bersihin teks giliran dari sisa-sisa instruksi yang ke-echo model.
 * Dua langkah: buang baris/kalimat yang jelas instruksi, lalu pecah baris
 * panjang per kalimat biar echo yang nempel di awal turn bisa dibuang tanpa
 * kehilangan kalimat valid setelahnya (tanpa "cut" agresif yang bisa makan
 * seluruh konten kalau ada false positive).
 */
export function cleanTurnText(text: string): string {
  if (!text) return "";
  const t = stripThinkingBlocks(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`/g, "")
    .replace(/\*\*/g, "");

  const kept: string[] = [];
  for (const line of t.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isInstructionEcho(trimmed)) continue;

    // Pecah per kalimat lalu filter yang echo instruksi. Dipakai untuk
    // SEMUA baris (bukan cuma yang panjang) biar echo yang nyempil di
    // tengah baris pendek ikut kebuang, tanpa "cut" agresif yang bisa
    // makan kalimat valid lain (mis. pas ada false positive).
    for (const part of trimmed.split(/(?<=[.!?…])\s+/)) {
      const p = part.trim();
      if (p && !isInstructionEcho(p)) kept.push(p);
    }
  }
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

// ─── Buang blok reasoning model (<think> dst.) ─────────────────────
// Model hybrid-reasoning (mis. qwen lewat gateway) nulis proses berpikirnya
// sebagai blok <think>/<thinking>/<reasoning>/[think] SEBELUM jawaban asli.
// Kalau gak dibuang, blok itu ikut di-TTS & ditampilkan. Dipakai di 2 tempat:
//   - server (api/podcast/turn): strip stateful di tengah stream,
//   - client (cleanTurnText/sanitizeForTts): lapisan cadangan.

const THINK_OPEN_RE = /<(?:think|thinking|reasoning)>|\[(?:think|reasoning)\]/i;
const THINK_CLOSE_RE = /<\/(?:think|thinking|reasoning)>|\[\/(?:think|reasoning)\]/i;

// Buang blok think dari stream chunk-by-chunk — batas blok bisa kepotong di
// tengah chunk, jadi perlu state (buffer + status di-dalam/n-di-luar blok).
export class ThinkingStripper {
  private buffer = "";
  private inThink = false;
  // Ekor yang ditahan biar tag pembuka/tutup yang kepotong chunk gak kelewat.
  private static readonly TAIL = 64;

  transform(chunk: string): string {
    let out = "";
    this.buffer += chunk;
    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const open = this.buffer.search(THINK_OPEN_RE);
        if (open === -1) {
          // Gak ada tag pembuka: emit semua kecuali ekor (jaga-jaga ada
          // potongan tag di ujung). Kalau buffer pendek → tunggu chunk berikut.
          const keep = Math.min(ThinkingStripper.TAIL, this.buffer.length);
          if (keep === this.buffer.length) break;
          out += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        out += this.buffer.slice(0, open);
        this.buffer = this.buffer.slice(open);
        const m = this.buffer.match(THINK_OPEN_RE)!;
        this.buffer = this.buffer.slice(m.index! + m[0].length);
        this.inThink = true;
      } else {
        const close = this.buffer.search(THINK_CLOSE_RE);
        if (close === -1) {
          // Masih di dalam blok & tutup belum kelihatan. Buang sisanya, tahan
          // ekor — kalau blok gak pernah ditutup, isinya gak bocor ke speech.
          const keep = Math.min(ThinkingStripper.TAIL, this.buffer.length);
          if (keep === this.buffer.length) break;
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        const m = this.buffer.match(THINK_CLOSE_RE)!;
        this.buffer = this.buffer.slice(m.index! + m[0].length);
        this.inThink = false;
      }
    }
    return out;
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    // Blok yang gak pernah ditutup → buang, jangan sampai kebaca.
    if (this.inThink) return "";
    return rest;
  }
}

// Versi non-streaming (client): buang blok lengkap, lalu tag pembuka tanpa
// penutup → buang mulai dari situ sampai akhir.
export function stripThinkingBlocks(text: string): string {
  let t = text;
  t = t.replace(
    /<(?:think|thinking|reasoning)>[\s\S]*?<\/(?:think|thinking|reasoning)>/gi,
    " "
  );
  t = t.replace(/\[(?:think|reasoning)\][\s\S]*?\[\/(?:think|reasoning)\]/gi, " ");
  t = t.replace(/<(?:think|thinking|reasoning)>[\s\S]*$/gi, " ");
  t = t.replace(/\[(?:think|reasoning)\][\s\S]*$/gi, " ");
  return t.replace(/\s{2,}/g, " ").trim();
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
  return stripThinkingBlocks(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~#>{}\-]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
