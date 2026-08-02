-- CreateTable
CREATE TABLE "pipeline_crosslink_llm_decisions" (
    "id" SERIAL NOT NULL,
    "pipelineItemId" TEXT NOT NULL,
    "targetDateJst" TIMESTAMP(3) NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "headlineCandidate" BOOLEAN NOT NULL DEFAULT false,
    "headlineScore" DOUBLE PRECISION,
    "dupCluster" TEXT,
    "canonicalItemId" TEXT,
    "dupScore" DOUBLE PRECISION,
    "priorityReason" TEXT,
    "priorityScore" DOUBLE PRECISION,
    "prefilterCluster" TEXT,
    "prefilterCanonicalItemId" TEXT,
    "prefilterScore" DOUBLE PRECISION,
    "keyLinks" JSONB,
    "llmPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_crosslink_llm_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_crosslink_llm_decisions_targetDateJst_pipelineItemId_mo_key" ON "pipeline_crosslink_llm_decisions"("targetDateJst", "pipelineItemId", "model", "promptVersion");

-- CreateIndex
CREATE INDEX "pipeline_crosslink_llm_decisions_targetDateJst_model_promptVersion_idx" ON "pipeline_crosslink_llm_decisions"("targetDateJst", "model", "promptVersion");

-- CreateIndex
CREATE INDEX "pipeline_crosslink_llm_decisions_pipelineItemId_targetDateJst_idx" ON "pipeline_crosslink_llm_decisions"("pipelineItemId", "targetDateJst");

-- CreateIndex
CREATE INDEX "pipeline_crosslink_llm_decisions_dupCluster_idx" ON "pipeline_crosslink_llm_decisions"("dupCluster");

-- AddForeignKey
ALTER TABLE "pipeline_crosslink_llm_decisions" ADD CONSTRAINT "pipeline_crosslink_llm_decisions_pipelineItemId_fkey" FOREIGN KEY ("pipelineItemId") REFERENCES "pipeline_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
