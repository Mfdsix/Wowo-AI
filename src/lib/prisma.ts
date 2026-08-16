import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaMigrated: boolean | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ─── Runtime schema patch (idempotent) ────────────────────────────────
// Tambah kolom pendukung auth/isolasi per-user TANPA jalankan perintah
// `migrate` (di-disable di project ini). Aman dijalankan berulang kali:
// pakai pragma table_info buat ngecek kolom udah ada atau belum.
// Dijalankan sekali per proses (guard `prismaMigrated`).
export async function ensureSessionOwnerCode(): Promise<void> {
  if (globalForPrisma.prismaMigrated) return;
  globalForPrisma.prismaMigrated = true; // jangan coba lagi meski gagal pertama
  try {
    // 1) Session.ownerCode (isolasi sesi per user)
    const sessionCols = (await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info("Session")`) as unknown as {
      name: string;
    }[];
    if (!sessionCols.some((c) => c.name === "ownerCode")) {
      await prisma.$executeRaw`ALTER TABLE "Session" ADD COLUMN "ownerCode" TEXT`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Session_ownerCode_idx" ON "Session"("ownerCode")`;
      console.log("[prisma] added Session.ownerCode column");
    }

    // 2) SavedDiscovery.profileId (simpan discovery per-user)
    const savedCols = (await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info("SavedDiscovery")`) as unknown as {
      name: string;
    }[];
    if (!savedCols.some((c) => c.name === "profileId")) {
      await prisma.$executeRaw`ALTER TABLE "SavedDiscovery" ADD COLUMN "profileId" TEXT`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "SavedDiscovery_profileId_idx" ON "SavedDiscovery"("profileId")`;
      // Backfill: data lama (sebelum ada multi-user) kita tag ke profil legacy.
      await prisma.$executeRaw`UPDATE "SavedDiscovery" SET "profileId" = 'legacy' WHERE "profileId" IS NULL`;
      // Hapus unique lama (discoveryId) jika ada, lalu buat unique baru per-user.
      await prisma.$executeRaw`DROP INDEX IF EXISTS "SavedDiscovery_discoveryId_key"`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "SavedDiscovery_profileId_discoveryId_key" ON "SavedDiscovery"("profileId", "discoveryId")`;
      console.log("[prisma] added SavedDiscovery.profileId column");
    }
  } catch (err) {
    console.error("[prisma] ensureSessionOwnerCode failed:", err);
  }
}

