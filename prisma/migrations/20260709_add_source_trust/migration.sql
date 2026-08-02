-- Source trust scoring state for issue #103.
-- Lifecycle writes and demotion event creation are intentionally handled later.
ALTER TABLE "Source"
  ADD COLUMN IF NOT EXISTS "trustScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "trustLabel" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "trustUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "qualityMetrics" JSONB,
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deactivationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cooldownUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SourceDemotionEvent" (
  "id" SERIAL NOT NULL,
  "sourceId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metricsSnapshot" JSONB NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceDemotionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceDemotionEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SourceDemotionEvent_sourceId_at_idx" ON "SourceDemotionEvent"("sourceId", "at");
CREATE INDEX IF NOT EXISTS "SourceDemotionEvent_action_at_idx" ON "SourceDemotionEvent"("action", "at");

-- Supports source trust windows: twitter items by sourceRef over trailing createdAt windows.
CREATE INDEX IF NOT EXISTS "pipeline_items_platform_sourceRef_createdAt_idx" ON "pipeline_items"("platform", "sourceRef", "createdAt");
