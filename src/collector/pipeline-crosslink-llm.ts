import { PrismaClient } from "@prisma/client";
import { crosslinkPipelineItemsByLlm } from "../lib/pipeline/crosslink-llm";

interface CliOptions {
  dryRun: boolean;
  dateJst?: Date;
  limit?: number;
  platforms: string[];
  batchSize?: number;
  model?: string;
  promptVersion?: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  maxSummaryChars?: number;
  maxBatches?: number;
  pendingOnly: boolean;
}

function parsePlatforms(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseDateJst(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date-jst format: ${raw}. Expected YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000+09:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date-jst value: ${raw}`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    platforms: [],
    pendingOnly: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--include-completed") {
      options.pendingOnly = false;
      continue;
    }

    if (token.startsWith("--date-jst=")) {
      options.dateJst = parseDateJst(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--date-jst" || token === "--date") {
      options.dateJst = parseDateJst(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--limit=")) {
      options.limit = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--limit") {
      options.limit = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--platform=")) {
      options.platforms.push(...parsePlatforms(token.split("=", 2)[1] || ""));
      continue;
    }

    if (token === "--platform") {
      options.platforms.push(...parsePlatforms(argv[i + 1] || ""));
      i += 1;
      continue;
    }

    if (token.startsWith("--batch-size=")) {
      options.batchSize = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--batch-size") {
      options.batchSize = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--model=")) {
      options.model = token.split("=", 2)[1] || undefined;
      continue;
    }

    if (token === "--model") {
      options.model = argv[i + 1] || undefined;
      i += 1;
      continue;
    }

    if (token.startsWith("--prompt-version=")) {
      options.promptVersion = token.split("=", 2)[1] || undefined;
      continue;
    }

    if (token === "--prompt-version") {
      options.promptVersion = argv[i + 1] || undefined;
      i += 1;
      continue;
    }

    if (token.startsWith("--max-retries=")) {
      options.maxRetries = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-retries") {
      options.maxRetries = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--max-output-tokens=")) {
      options.maxOutputTokens = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-output-tokens") {
      options.maxOutputTokens = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--max-summary-chars=")) {
      options.maxSummaryChars = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-summary-chars") {
      options.maxSummaryChars = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--max-batches=")) {
      options.maxBatches = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-batches") {
      options.maxBatches = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  return options;
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await crosslinkPipelineItemsByLlm(prisma, {
      dryRun: options.dryRun,
      dateJst: options.dateJst,
      limit: options.limit,
      platforms: options.platforms.length > 0 ? options.platforms : undefined,
      batchSize: options.batchSize,
      model: options.model,
      promptVersion: options.promptVersion,
      maxRetries: options.maxRetries,
      maxOutputTokens: options.maxOutputTokens,
      maxSummaryChars: options.maxSummaryChars,
      maxBatches: options.maxBatches,
      pendingOnly: options.pendingOnly,
      logger: console,
    });

    console.log("\n=== Step4 crosslink (LLM manual-run) summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal crosslink-llm error:", error);
  process.exit(1);
});
