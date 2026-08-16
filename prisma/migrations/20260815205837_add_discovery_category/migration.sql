/*
  Warnings:

  - Added the required column `category` to the `Discovery` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Discovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT,
    "category" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "teaser" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "surprise" REAL NOT NULL DEFAULT 0,
    "curiosity" REAL NOT NULL DEFAULT 0,
    "credibility" REAL NOT NULL DEFAULT 0,
    "depthPotential" REAL NOT NULL DEFAULT 0,
    "discoveryScore" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Discovery_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Discovery" ("createdAt", "credibility", "curiosity", "depthPotential", "discoveryScore", "hook", "id", "question", "rejectReason", "status", "surprise", "teaser", "topicId", "updatedAt") SELECT "createdAt", "credibility", "curiosity", "depthPotential", "discoveryScore", "hook", "id", "question", "rejectReason", "status", "surprise", "teaser", "topicId", "updatedAt" FROM "Discovery";
DROP TABLE "Discovery";
ALTER TABLE "new_Discovery" RENAME TO "Discovery";
CREATE INDEX "Discovery_status_idx" ON "Discovery"("status");
CREATE INDEX "Discovery_topicId_idx" ON "Discovery"("topicId");
CREATE INDEX "Discovery_discoveryScore_idx" ON "Discovery"("discoveryScore");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
