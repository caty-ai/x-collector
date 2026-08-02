-- Baseline for models that predate the migrations directory.
-- Later migrations continue to own the objects and columns they introduced.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Source" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'vip_handle',
    "handle" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tweet" (
    "tweetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'scrapecreators',
    "handle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "textShort" TEXT,
    "isNote" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT NOT NULL,
    "media" JSONB,
    "metrics" JSONB,
    "entities" JSONB,
    "rawEventId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,

    CONSTRAINT "Tweet_pkey" PRIMARY KEY ("tweetId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertSource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fetchIntervalHours" INTEGER NOT NULL DEFAULT 6,
    "maxItemsPerFetch" INTEGER NOT NULL DEFAULT 50,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertEntry" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "articleUrl" TEXT NOT NULL,
    "rawLink" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,

    CONSTRAINT "AlertEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CandidateAccount" (
    "id" SERIAL NOT NULL,
    "handle" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "mentionedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profileFetched" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "description" TEXT,
    "followersCount" INTEGER,
    "followingCount" INTEGER,
    "tweetCount" INTEGER,
    "profileImageUrl" TEXT,
    "sampleTweets" JSONB,
    "aiScore" DOUBLE PRECISION,
    "aiReason" TEXT,
    "aiEvaluatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Run" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "meta" JSONB,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "or_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricingPrompt" DOUBLE PRECISION,
    "pricingCompletion" DOUBLE PRECISION,
    "contextLength" INTEGER,
    "architecture" JSONB,
    "description" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "raw" JSONB,

    CONSTRAINT "or_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "or_model_events" (
    "id" SERIAL NOT NULL,
    "modelId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "or_model_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Source_handle_key" ON "Source"("handle");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AlertSource_feedUrl_key" ON "AlertSource"("feedUrl");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AlertEntry_sourceId_articleUrl_key" ON "AlertEntry"("sourceId", "articleUrl");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CandidateAccount_handle_key" ON "CandidateAccount"("handle");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "or_model_events_detectedAt_idx" ON "or_model_events"("detectedAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'AlertEntry_sourceId_fkey'
          AND conrelid = '"AlertEntry"'::regclass
    ) THEN
        ALTER TABLE "AlertEntry"
            ADD CONSTRAINT "AlertEntry_sourceId_fkey"
            FOREIGN KEY ("sourceId") REFERENCES "AlertSource"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
