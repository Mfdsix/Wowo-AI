// ─── Auth session: 6-digit access code (huruf + angka) ──────────────────
// Tiap user diidentifikasi oleh kode akses 6 karakter yang disimpan di
// cookie `wowo_session`. Semua data Session (chat, design, curiosity, podcast)
// di-scope per kode ini. Kode super-admin khusus bisa ngintip semua sesi.

import type { Prisma } from "@/generated/prisma/client";

export const SESSION_COOKIE = "wowo_session";
export const SUPER_ADMIN_CODE = "789000"; // kode super admin (impersonate semua sesi)

export const CODE_LENGTH = 6;
// Karakter yang dipakai buat generate kode: huruf (kecil+besar) + angka,
// hindari karakter ambigu (0/O, 1/l/I) biar gampang diketik & dibaca.
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Regex kode valid: tepat 6 karakter huruf/angka.
const CODE_RE = /^[a-zA-Z0-9]{6}$/;

export function isValidCode(code: string | null | undefined): code is string {
  // Kode super admin (78900) panjangnya 5, jadi dikecualikan dari aturan 6-char.
  if (code === SUPER_ADMIN_CODE) return true;
  return typeof code === "string" && CODE_RE.test(code);
}

// Generate kode acak 6 karakter (huruf + angka, tanpa ambigu).
export function generateCode(): string {
  let out = "";
  const cryptoObj =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(CODE_LENGTH);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  }
  return out;
}

export function isSuperAdmin(code: string | null | undefined): boolean {
  return code === SUPER_ADMIN_CODE;
}

// Di server, ambil kode dari cookie request. Bisa null kalau belum login.
export function getCodeFromCookies(cookieStore: {
  get: (name: string) => { value: string } | undefined;
}): string | null {
  const c = cookieStore.get(SESSION_COOKIE);
  return c?.value ?? null;
}

// Bikin where-clause Prisma buat nge-scope Session ke kode tertentu.
// Kode super-admin bisa lihat SEMUA sesi (gak di-scope).
export function sessionScopeWhere(code: string | null): Prisma.SessionWhereInput {
  if (isSuperAdmin(code)) return {}; // admin → semua sesi
  return { ownerCode: code ?? "__none__" }; // kosong → gak ada sesi (belum login)
}
