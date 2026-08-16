-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT,
    "keywords" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Topic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT,
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

-- CreateTable
CREATE TABLE "DiscoveryLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discoveryId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscoveryLevel_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "publishedAt" DATETIME,
    "type" TEXT NOT NULL,
    "trustLevel" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DiscoverySource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discoveryId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "claimStatus" TEXT NOT NULL DEFAULT 'known_fact',
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoverySource_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoverySource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RabbitHoleQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discoveryId" TEXT NOT NULL,
    "parentId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RabbitHoleQuestion_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RabbitHoleQuestion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RabbitHoleQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "depthPreference" TEXT NOT NULL DEFAULT '2-3',
    "summary" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KnowledgeTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'basic',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeTag_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterestTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterestTag_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscoveryDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "deliveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxDepth" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'viewed',
    CONSTRAINT "DiscoveryDelivery_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoveryDelivery_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscoveryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" INTEGER,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DiscoveryDelivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedDiscovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discoveryId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedDiscovery_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "designStyle" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'chat',
    "podcastConfig" TEXT,
    "discoveryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("createdAt", "designStyle", "id", "mode", "podcastConfig", "title", "updatedAt") SELECT "createdAt", "designStyle", "id", "mode", "podcastConfig", "title", "updatedAt" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_discoveryId_idx" ON "Session"("discoveryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");

-- CreateIndex
CREATE INDEX "Topic_category_idx" ON "Topic"("category");

-- CreateIndex
CREATE INDEX "Topic_parentId_idx" ON "Topic"("parentId");

-- CreateIndex
CREATE INDEX "Discovery_status_idx" ON "Discovery"("status");

-- CreateIndex
CREATE INDEX "Discovery_topicId_idx" ON "Discovery"("topicId");

-- CreateIndex
CREATE INDEX "Discovery_discoveryScore_idx" ON "Discovery"("discoveryScore");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryLevel_discoveryId_level_key" ON "DiscoveryLevel"("discoveryId", "level");

-- CreateIndex
CREATE INDEX "Source_trustLevel_idx" ON "Source"("trustLevel");

-- CreateIndex
CREATE INDEX "DiscoverySource_sourceId_idx" ON "DiscoverySource"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySource_discoveryId_sourceId_key" ON "DiscoverySource"("discoveryId", "sourceId");

-- CreateIndex
CREATE INDEX "RabbitHoleQuestion_discoveryId_idx" ON "RabbitHoleQuestion"("discoveryId");

-- CreateIndex
CREATE INDEX "RabbitHoleQuestion_parentId_idx" ON "RabbitHoleQuestion"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeTag_profileId_tag_key" ON "KnowledgeTag"("profileId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "InterestTag_profileId_tag_type_key" ON "InterestTag"("profileId", "tag", "type");

-- CreateIndex
CREATE INDEX "DiscoveryDelivery_profileId_deliveredAt_idx" ON "DiscoveryDelivery"("profileId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryDelivery_profileId_discoveryId_key" ON "DiscoveryDelivery"("profileId", "discoveryId");

-- CreateIndex
CREATE INDEX "DiscoveryEvent_deliveryId_idx" ON "DiscoveryEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "DiscoveryEvent_type_idx" ON "DiscoveryEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SavedDiscovery_discoveryId_key" ON "SavedDiscovery"("discoveryId");
