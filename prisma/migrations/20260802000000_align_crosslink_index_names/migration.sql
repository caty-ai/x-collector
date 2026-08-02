-- The 20260309 SQL index names exceed PostgreSQL's 63-byte identifier limit, so fresh migrations create truncated names that differ from Prisma's canonical truncation. db-pushed databases (production) already carry the canonical names, hence IF EXISTS.

-- RenameIndex
ALTER INDEX IF EXISTS "pipeline_crosslink_llm_decisions_pipelineItemId_targetDateJst_i" RENAME TO "pipeline_crosslink_llm_decisions_pipelineItemId_targetDateJ_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "pipeline_crosslink_llm_decisions_targetDateJst_model_promptVers" RENAME TO "pipeline_crosslink_llm_decisions_targetDateJst_model_prompt_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "pipeline_crosslink_llm_decisions_targetDateJst_pipelineItemId_m" RENAME TO "pipeline_crosslink_llm_decisions_targetDateJst_pipelineItem_key";
