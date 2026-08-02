import { PrismaClient } from "@prisma/client";
import { userAgent } from "../lib/branding";
import { sendOpsAlert } from "../lib/ops-alert";

const prisma = new PrismaClient();

const OPENROUTER_API = "https://openrouter.ai/api/v1/models";
const OPENROUTER_FETCH_TIMEOUT_MS = 30_000;

interface OrApiModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: any;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  [key: string]: any;
}

function parsePrice(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function isFree(pricing: OrApiModel["pricing"]): boolean {
  const p = parsePrice(pricing?.prompt);
  const c = parsePrice(pricing?.completion);
  return (p === null || p === 0) && (c === null || c === 0);
}

function pricePerMillion(perToken: number | null): string {
  if (perToken === null || perToken === 0) return "free";
  return `$${(perToken * 1_000_000).toFixed(2)}/M`;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

async function failRunAndAlert(params: {
  runId: number;
  message: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  const { runId, message, meta } = params;
  const results = await Promise.allSettled([
    prisma.run.update({
      where: { id: runId },
      data: {
        endedAt: new Date(),
        status: "failed",
        meta: {
          ...meta,
          error: message,
        },
      },
    }),
    sendOpsAlert(
      `[openrouter-collector] failed at ${new Date().toISOString()} run=${runId} ${message}`,
    ),
  ]);

  const updateResult = results[0];
  if (updateResult.status === "rejected") {
    console.error(
      `[openrouter-collector] failed to update run=${runId} status after collector failure:`,
      updateResult.reason,
    );
  }

  const alertResult = results[1];
  if (alertResult.status === "rejected") {
    console.error(
      `[openrouter-collector] sendOpsAlert unexpectedly threw for run=${runId}:`,
      alertResult.reason,
    );
  }
}

/**
 * Fetch all models from OpenRouter and detect changes (new, removed, price/context changes).
 */
export async function collectOpenRouterModels(): Promise<{
  sources: number;
  total: number;
  newModels: number;
  removed: number;
  priceChanges: number;
  contextChanges: number;
  errors: number;
}> {
  console.log("\n--- OpenRouter Model Tracker ---");

  const run = await prisma.run.create({
    data: { kind: "openrouter", status: "running" },
  });

  let apiModels: OrApiModel[];
  try {
    const res = await fetch(OPENROUTER_API, {
      headers: { "User-Agent": userAgent() },
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter API error: ${res.status}`);
    }

    const data = await res.json() as { data?: unknown };
    if (!Array.isArray(data.data)) {
      throw new Error("OpenRouter API response missing data array");
    }

    apiModels = data.data as OrApiModel[];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await failRunAndAlert({
      runId: run.id,
      message,
      meta: { stage: "fetch_models" },
    });
    throw error;
  }

  console.log(`  Fetched ${apiModels.length} models from OpenRouter API`);

  // 2. Load existing models from DB
  const existing = await prisma.orModel.findMany();
  const activeExistingCount = existing.filter((model) => model.removedAt === null).length;
  const belowHalfOfExisting =
    activeExistingCount > 0 && apiModels.length < Math.ceil(activeExistingCount / 2);
  if (apiModels.length === 0 || belowHalfOfExisting) {
    const message = apiModels.length === 0
      ? "OpenRouter API returned zero models; aborting removal pass"
      : `OpenRouter API returned only ${apiModels.length} models vs ${activeExistingCount} active tracked models; aborting removal pass`;
    await failRunAndAlert({
      runId: run.id,
      message,
      meta: {
        stage: "guard_models",
        apiModelCount: apiModels.length,
        activeExistingCount,
      },
    });
    throw new Error(message);
  }

  const existingMap = new Map(existing.map((m) => [m.id, m]));
  const apiIdSet = new Set(apiModels.map((m) => m.id));

  let newModels = 0;
  let priceChanges = 0;
  let contextChanges = 0;
  let removed = 0;
  let errors = 0;

  // 3. Process each API model
  for (const am of apiModels) {
    try {
      const pricingPrompt = parsePrice(am.pricing?.prompt);
      const pricingCompletion = parsePrice(am.pricing?.completion);
      const free = isFree(am.pricing);

      const dbModel = existingMap.get(am.id);

      if (!dbModel) {
        // NEW model
        await prisma.orModel.create({
          data: {
            id: am.id,
            name: am.name || am.id,
            pricingPrompt,
            pricingCompletion,
            contextLength: am.context_length || null,
            architecture: am.architecture || null,
            description: am.description || null,
            isFree: free,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            raw: am as any,
          },
        });

        await prisma.orModelEvent.create({
          data: {
            modelId: am.id,
            eventType: "new",
            detail: `New model: ${am.name}${free ? " (FREE)" : ""} | Context: ${am.context_length?.toLocaleString() || "?"} | Prompt: ${pricePerMillion(pricingPrompt)} | Completion: ${pricePerMillion(pricingCompletion)}`,
            newValue: { name: am.name, pricing: am.pricing, context_length: am.context_length },
          },
        });
        newModels++;
        console.log(`  🆕 New: ${am.id} (${am.name})${free ? " [FREE]" : ""}`);
      } else {
        // EXISTING model — check for changes
        const updates: any = { lastSeenAt: new Date(), removedAt: null, raw: am as any };
        let changed = false;

        // Price change?
        if (
          dbModel.pricingPrompt !== pricingPrompt ||
          dbModel.pricingCompletion !== pricingCompletion
        ) {
          await prisma.orModelEvent.create({
            data: {
              modelId: am.id,
              eventType: "price_change",
              detail: `Price changed: Prompt ${pricePerMillion(dbModel.pricingPrompt)} → ${pricePerMillion(pricingPrompt)} | Completion ${pricePerMillion(dbModel.pricingCompletion)} → ${pricePerMillion(pricingCompletion)}`,
              oldValue: { prompt: dbModel.pricingPrompt, completion: dbModel.pricingCompletion },
              newValue: { prompt: pricingPrompt, completion: pricingCompletion },
            },
          });
          updates.pricingPrompt = pricingPrompt;
          updates.pricingCompletion = pricingCompletion;
          updates.isFree = free;
          priceChanges++;
          changed = true;
          console.log(`  💰 Price change: ${am.id}`);
        }

        // Context length change?
        if (dbModel.contextLength !== (am.context_length || null)) {
          await prisma.orModelEvent.create({
            data: {
              modelId: am.id,
              eventType: "context_change",
              detail: `Context length changed: ${dbModel.contextLength?.toLocaleString() || "?"} → ${am.context_length?.toLocaleString() || "?"}`,
              oldValue: { context_length: dbModel.contextLength },
              newValue: { context_length: am.context_length },
            },
          });
          updates.contextLength = am.context_length || null;
          contextChanges++;
          changed = true;
          console.log(`  📏 Context change: ${am.id}`);
        }

        // Name change?
        if (dbModel.name !== (am.name || am.id)) {
          updates.name = am.name || am.id;
        }

        // Update description
        if (am.description) updates.description = am.description;

        await prisma.orModel.update({ where: { id: am.id }, data: updates });
      }
    } catch (err: any) {
      console.error(`  Error processing ${am.id}:`, err.message);
      errors++;
    }
  }

  // 4. Detect removed models (in DB but not in API)
  for (const dbModel of existing) {
    if (!apiIdSet.has(dbModel.id) && !dbModel.removedAt) {
      await prisma.orModel.update({
        where: { id: dbModel.id },
        data: { removedAt: new Date() },
      });
      await prisma.orModelEvent.create({
        data: {
          modelId: dbModel.id,
          eventType: "removed",
          detail: `Model removed: ${dbModel.name}`,
          oldValue: { name: dbModel.name, pricing: { prompt: dbModel.pricingPrompt, completion: dbModel.pricingCompletion } },
        },
      });
      removed++;
      console.log(`  ❌ Removed: ${dbModel.id} (${dbModel.name})`);
    }
  }

  // 5. Update run
  await prisma.run.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      status: errors ? "partial" : "done",
      meta: { total: apiModels.length, newModels, removed, priceChanges, contextChanges, errors },
    },
  });

  console.log(
    `  OpenRouter run #${run.id} complete: ${apiModels.length} models, ${newModels} new, ${removed} removed, ${priceChanges} price changes, ${contextChanges} context changes`
  );

  await prisma.$disconnect();
  return {
    sources: apiModels.length,
    total: apiModels.length,
    newModels,
    removed,
    priceChanges,
    contextChanges,
    errors,
  };
}

// CLI entry
if (require.main === module) {
  collectOpenRouterModels()
    .then((r) => {
      console.log("\nResult:", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
