# Document Intelligence Pipeline (RAG) — Desain

> **Status:** Draft / fase 1
> **Masalah:** Skema OCR sekarang sinkron & cuma baca 8 halaman pertama
> (`VISION_PDF_MAX_PAGES`). PDF 100+ halaman gak akan muat di satu context window,
> dan read-all-then-answer gagal secara matematis di skala itu.
> **Solusi:** pindah dari *"baca semua → jawab"* ke *"index semua → jawab dari yang relevan"*.

## Prinsip

- **Dokumen kecil** (≤ `DOC_INDEX_THRESHOLD_PAGES` halaman / ≤ `DOC_INDEX_THRESHOLD_CHARS`
  karakter) → jalur sekarang: teks di-inline ke konteks. Cepat, murah, gak berubah.
- **Dokumen besar** → jalur pipeline: di-index **async di background** (render → OCR → chunk
  → embed), jawaban diambil lewat **retrieval** (top-K chunk relevan), bukan stuffing.

## Alur

```
UPLOAD (100+ hal)                         TANYA (kapan aja)
│                                         │
▼ attachment.status: pending              embed pertanyaan
worker background:
  extracting → render semua halaman        cosine top-K chunk
  ocr → batch /ocr (concurrency 4-8)       │
  indexing → chunk → embed                 ▼
  ready (progress 0..100)                  inject [Dokumen: nama — halaman X-Y]
                                           LLM jawab dari konteks kecil
```

## Model data (Prisma + SQLite)

```prisma
model Attachment {
  // ... existing ...
  status      String  @default("pending")  // pending | extracting | ocr | indexing | ready | failed
  progress    Int     @default(0)          // 0..100
  error       String?
  chunks      DocChunk[]
}

model DocChunk {
  id           String   @id @default(cuid())
  attachmentId String
  attachment   Attachment @relation(fields: [attachmentId], references: [id], onDelete: Cascade)
  sessionId    String
  chunkIndex   Int
  pageStart    Int      // halaman asal — buat kutip sumber
  pageEnd      Int
  text         String
  embedding    Bytes?   // float32 flat (768 dim ≈ 3KB)
  @@index([attachmentId])
  @@index([sessionId])
}
```

- Embedding disimpen sebagai **BLOB float32**. Tanpa vector DB — buat skala lokal
  (~500 chunk × 768 dim), brute-force cosine di JS itu hitungan ms. Kalau nanti
  multipel user, baru lirik `sqlite-vec` / pgvector.
- `Attachment.data` udah nyimpen bytes asli (thumbnail + regenerate) — index cukup
  nyimpen chunk, gak perlu duplikat file.

## Komponen baru

| File | Peran |
|---|---|
| `src/lib/embeddings.ts` | Client OpenAI-compatible `/embeddings`, batch embed, float32 pack/unpack |
| `src/lib/chunker.ts` | Per-halaman → split by char (CJK-safe), track `pageStart/pageEnd` |
| `src/lib/indexWorker.ts` | Worker background: native → chunk → embed; scan → OCR → chunk → embed |
| `src/lib/retrieval.ts` | Embed pertanyaan → cosine top-K → injeksi konteks |
| `prisma/schema.prisma` | `status`/`progress`/`error` + `DocChunk` |

## Embeddings

- Provider: **base URL LLM yang sama** (`LLM_BASE_URL`) → endpoint `/embeddings`.
  Ollama & LiteLLM dua-duanya support (Ollama: `nomic-embed-text`, `bge-m3`, dll).
- Env (fallback graceful kalau kosong → fitur nonaktif, jalur sekarang):

```
EMBEDDING_MODEL="nomic-embed-text"   # wajib buat RAG
EMBEDDING_BASE_URL=""                 # default: LLM_BASE_URL
EMBEDDING_API_KEY=""
```

- Dimensi dibaca dari response, gak di-hardcode.
- Batch embed (mis. 32 chunk/kali) buat ngurangin round-trip.

## Chunking

- Boundary natural: **per halaman dulu** (biar `pageStart/pageEnd` akurat buat kutipan),
  halaman > `CHUNK_TARGET_CHARS` di-split dengan overlap `CHUNK_OVERLAP`.
- Split by **character**, bukan token — aman buat CJK (`ch` di PaddleOCR).

## Retrieval di `/api/chat`

`buildUserContentParts` sekarang nge-stuff semua teks (attachments.ts:224-233). Ganti:

| Mode | Kondisi | Behavior |
|---|---|---|
| Inline | doc kecil | jalanan sekarang, gak berubah |
| Retrieval | doc besar, `ready` | embed pertanyaan → cosine top-K → inject `[Dokumen: nama — halaman 12-14]` + catatan sumber |
| Indexing | doc besar, belum `ready` | inject chunk yang udah ke-index + note, atau "masih di-index, tanya lagi nanti" |

## UX

- Chip status di attachment: `Mengindeks 40/120…` / `Siap — 120 halaman` / `Gagal`.
- UI poll progress selagi attachment ke-index (ada di view).
- Setelah `ready`, jawaban dari retrieval — subtle note sumber halaman.

## Env & config

```
DOC_INDEX_MAX_PAGES=200      # cap render halaman buat index (keamanan memory)
OCR_INDEX_CONCURRENCY=4      # request /ocr paralel
RETRIEVAL_TOP_K=10           # chunk per pertanyaan
RETRIEVAL_MIN_CHUNKS=6       # dokumen baru dipindah ke retrieval kalau index ≥ N chunk
CHUNK_TARGET_CHARS=1500
CHUNK_OVERLAP=150
```

> Catatan implementasi: threshold "dokumen besar" diukur dari hasil index
> (`_count.chunks >= RETRIEVAL_MIN_CHUNKS`), bukan estimasi di upload-time —
> lebih akurat & berlaku buat semua tipe (pdf/docx/text).

## Trade-off & batas

- **Waktu:** 100 hal × ~1-2s OCR CPU ÷ concurrency 4 → ~40-60s **background**, user gak nunggu.
- **Biaya:** embedding murah; konteks LLM flat → biaya gak naik seiring ukuran doc.
- **Storage:** cap 10MB bytes + ~500 chunk + embedding — ringan buat SQLite lokal.
- **Failure:** per-halaman, status `failed` + error; resume gak ulang halaman yang udah sukses.

## Fase implementasi

1. ✅ Migrasi Prisma (`status`/`progress`/`error` + `DocChunk`)
2. ✅ Embedding client + chunker (pure, testable)
3. ✅ Index worker (native + OCR pipeline, trigger dari route upload)
4. ✅ Retrieval + fallback di `/api/chat` (dokumen besar → chunk; kecil → inline)
5. ✅ UI status chip + progress (poll tiap 3 detik selagi processing)
6. ⏳ End-to-end test dengan LLM + OCR + embedding server hidup
7. ⏳ Tuning (threshold, K, chunk size)
