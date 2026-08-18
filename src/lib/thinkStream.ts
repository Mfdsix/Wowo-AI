// ─── Streaming thinking splitter ────────────────────────────────
// Model hybrid-reasoning (qwen lewat gateway, dsb) nulis proses berpikirnya
// sebagai blok <think>/<thinking>/<reasoning>/[think] SEBELUM jawaban.
// Di chat kita TIDAK buang thinking (seperti di podcast/TTS), tapi PISAHKAN
// jadi dua kanal: "think" (dipake UI toggle "Pemikiran wowo") dan "answer"
// (jawaban asli, bersih dari tag). Batas blok bisa kepotong di tengah chunk,
// makanya butuh state (buffer + status di-dalam/luar blok).

export type ThinkStreamEvent = { type: "think" | "answer"; text: string };

const THINK_OPEN_RE = /<(?:think|thinking|reasoning)>|\[(?:think|reasoning)\]/i;
const THINK_CLOSE_RE = /<\/(?:think|thinking|reasoning)>|\[\/(?:think|reasoning)\]/i;

export class ThinkingSplitter {
  private buffer = "";
  private inThink = false;
  private static readonly TAIL = 64; // ekor yg ditahan kalau tag kepotong chunk

  transform(chunk: string): ThinkStreamEvent[] {
    const events: ThinkStreamEvent[] = [];
    this.buffer += chunk;
    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const open = this.buffer.search(THINK_OPEN_RE);
        if (open === -1) {
          // Gak ada tag pembuka: emit semua kecuali ekor.
          const keep = Math.min(ThinkingSplitter.TAIL, this.buffer.length);
          if (keep === this.buffer.length) break;
          const text = this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          if (text) events.push({ type: "answer", text });
          break;
        }
        const text = this.buffer.slice(0, open);
        this.buffer = this.buffer.slice(open);
        const m = this.buffer.match(THINK_OPEN_RE)!;
        this.buffer = this.buffer.slice(m.index! + m[0].length);
        this.inThink = true;
        if (text) events.push({ type: "answer", text });
      } else {
        const close = this.buffer.search(THINK_CLOSE_RE);
        if (close === -1) {
          // Masih di dalam blok & tutup belum kelihatan. Buang sisanya, tahan ekor.
          const keep = Math.min(ThinkingSplitter.TAIL, this.buffer.length);
          if (keep === this.buffer.length) break;
          const text = this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          if (text) events.push({ type: "think", text });
          break;
        }
        const m = this.buffer.match(THINK_CLOSE_RE)!;
        const text = this.buffer.slice(0, m.index!);
        this.buffer = this.buffer.slice(m.index! + m[0].length);
        this.inThink = false;
        if (text) events.push({ type: "think", text });
      }
    }
    return events;
  }

  // Sisa buffer pas stream selesai. Blok think yg gak pernah ditutup → buang.
  flush(): ThinkStreamEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest) return [];
    if (this.inThink) return [];
    return [{ type: "answer", text: rest }];
  }
}
