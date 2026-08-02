-- CreateTable
CREATE TABLE "pipeline_items" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "title" TEXT,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedAt" TIMESTAMP(3),
    "language" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" SERIAL NOT NULL,
    "pipelineItemId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "model" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "inputHash" TEXT,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_classifications" (
    "id" SERIAL NOT NULL,
    "pipelineItemId" TEXT NOT NULL,
    "runId" INTEGER,
    "noise" BOOLEAN NOT NULL DEFAULT false,
    "noiseReason" TEXT,
    "primaryTag" TEXT,
    "subTag" TEXT,
    "actionTag" TEXT,
    "isHeadlineCandidate" BOOLEAN NOT NULL DEFAULT false,
    "isDup" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "rationale" TEXT,
    "classifierModel" TEXT,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_links" (
    "id" SERIAL NOT NULL,
    "fromItemId" TEXT NOT NULL,
    "toItemId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_editions" (
    "id" TEXT NOT NULL,
    "editionDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "contentMd" TEXT,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_bindings" (
    "id" SERIAL NOT NULL,
    "editionId" TEXT NOT NULL,
    "pipelineItemId" TEXT NOT NULL,
    "classificationId" INTEGER,
    "section" TEXT NOT NULL,
    "subsection" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "blurb" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_signals" (
    "id" SERIAL NOT NULL,
    "pipelineItemId" TEXT,
    "editionId" TEXT,
    "topic" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "usageContext" TEXT,
    "summary" TEXT,
    "model" TEXT,
    "confidence" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "signaledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_items_platform_publishedAt_idx" ON "pipeline_items"("platform", "publishedAt");

-- CreateIndex
CREATE INDEX "pipeline_items_createdAt_idx" ON "pipeline_items"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_items_platform_externalId_key" ON "pipeline_items"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_items_platform_url_key" ON "pipeline_items"("platform", "url");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_runs_idempotencyKey_key" ON "pipeline_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "pipeline_runs_step_status_startedAt_idx" ON "pipeline_runs"("step", "status", "startedAt");

-- CreateIndex
CREATE INDEX "pipeline_runs_pipelineItemId_startedAt_idx" ON "pipeline_runs"("pipelineItemId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_runs_pipelineItemId_step_attempt_key" ON "pipeline_runs"("pipelineItemId", "step", "attempt");

-- CreateIndex
CREATE INDEX "pipeline_classifications_pipelineItemId_classifiedAt_idx" ON "pipeline_classifications"("pipelineItemId", "classifiedAt");

-- CreateIndex
CREATE INDEX "pipeline_classifications_noise_primaryTag_actionTag_idx" ON "pipeline_classifications"("noise", "primaryTag", "actionTag");

-- CreateIndex
CREATE INDEX "pipeline_classifications_isHeadlineCandidate_isDup_isPublis_idx" ON "pipeline_classifications"("isHeadlineCandidate", "isDup", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_classifications_pipelineItemId_runId_key" ON "pipeline_classifications"("pipelineItemId", "runId");

-- CreateIndex
CREATE INDEX "pipeline_links_toItemId_idx" ON "pipeline_links"("toItemId");

-- CreateIndex
CREATE INDEX "pipeline_links_linkType_createdAt_idx" ON "pipeline_links"("linkType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_links_fromItemId_toItemId_linkType_key" ON "pipeline_links"("fromItemId", "toItemId", "linkType");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_editions_slug_key" ON "newsletter_editions"("slug");

-- CreateIndex
CREATE INDEX "newsletter_editions_status_editionDate_idx" ON "newsletter_editions"("status", "editionDate");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_editions_editionDate_key" ON "newsletter_editions"("editionDate");

-- CreateIndex
CREATE INDEX "newsletter_bindings_editionId_section_position_idx" ON "newsletter_bindings"("editionId", "section", "position");

-- CreateIndex
CREATE INDEX "newsletter_bindings_pipelineItemId_idx" ON "newsletter_bindings"("pipelineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_bindings_editionId_pipelineItemId_key" ON "newsletter_bindings"("editionId", "pipelineItemId");

-- CreateIndex
CREATE INDEX "voice_signals_topic_sentiment_signaledAt_idx" ON "voice_signals"("topic", "sentiment", "signaledAt");

-- CreateIndex
CREATE INDEX "voice_signals_editionId_signaledAt_idx" ON "voice_signals"("editionId", "signaledAt");

-- CreateIndex
CREATE INDEX "voice_signals_pipelineItemId_idx" ON "voice_signals"("pipelineItemId");

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipelineItemId_fkey" FOREIGN KEY ("pipelineItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_classifications" ADD CONSTRAINT "pipeline_classifications_pipelineItemId_fkey" FOREIGN KEY ("pipelineItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_classifications" ADD CONSTRAINT "pipeline_classifications_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pipeline_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_links" ADD CONSTRAINT "pipeline_links_fromItemId_fkey" FOREIGN KEY ("fromItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_links" ADD CONSTRAINT "pipeline_links_toItemId_fkey" FOREIGN KEY ("toItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_bindings" ADD CONSTRAINT "newsletter_bindings_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "newsletter_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_bindings" ADD CONSTRAINT "newsletter_bindings_pipelineItemId_fkey" FOREIGN KEY ("pipelineItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_bindings" ADD CONSTRAINT "newsletter_bindings_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "pipeline_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_signals" ADD CONSTRAINT "voice_signals_pipelineItemId_fkey" FOREIGN KEY ("pipelineItemId") REFERENCES "pipeline_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_signals" ADD CONSTRAINT "voice_signals_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "newsletter_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
