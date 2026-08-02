-- Embedding storage for Step4.5 topic clustering.
-- NOTE: stored as jsonb (not pgvector). Clustering is done in-memory
-- (cosine + union-find), so the pgvector extension is intentionally not used.
-- pgvector can be introduced later if/when similarity-search features are built.

-- Add embedding columns to pipeline_items
ALTER TABLE pipeline_items
  ADD COLUMN IF NOT EXISTS embedding jsonb,
  ADD COLUMN IF NOT EXISTS "embeddingHash" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

-- Add topic-cluster columns to pipeline_crosslink_llm_decisions
ALTER TABLE pipeline_crosslink_llm_decisions
  ADD COLUMN IF NOT EXISTS "topicClusterKey" TEXT,
  ADD COLUMN IF NOT EXISTS "clusterSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "distinctSources" INTEGER,
  ADD COLUMN IF NOT EXISTS "platformSpread" INTEGER;
