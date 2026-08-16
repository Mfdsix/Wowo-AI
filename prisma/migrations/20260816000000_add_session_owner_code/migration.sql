-- Add per-user session isolation (6-digit access code).
-- NOTE: This migration is applied at runtime via an idempotent
-- `prisma.$executeRaw` in src/lib/prisma.ts (the global migrate commands
-- are disabled in this project). Kept here as the source-of-truth DDL.

-- SQLite via Prisma doesn't support adding a column with an inline index
-- in a single statement reliably, so we add the column then create the index.

ALTER TABLE "Session" ADD COLUMN "ownerCode" TEXT;

CREATE INDEX IF NOT EXISTS "Session_ownerCode_idx" ON "Session"("ownerCode");
