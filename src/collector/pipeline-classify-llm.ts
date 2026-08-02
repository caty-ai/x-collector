import { PrismaClient } from "@prisma/client";
import { classifyPipelineItemsByLlm } from "../lib/pipeline/classify-llm";

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  platforms: string[];
  model?: string;
  maxBodyChars?: number;
  maxEnrichmentChars?: number;
  maxRetries?: number;
  fallbackToRules: boolean;
  pendingOnly: boolean;
  promptDir?: string;
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

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    platforms: [],
    fallbackToRules: true,
    pendingOnly: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--no-fallback") {
      options.fallbackToRules = false;
      continue;
    }

    if (token === "--include-completed") {
      options.pendingOnly = false;
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

    if (token.startsWith("--model=")) {
      options.model = token.split("=", 2)[1] || undefined;
      continue;
    }

    if (token === "--model") {
      options.model = argv[i + 1] || undefined;
      i += 1;
      continue;
    }

    if (token.startsWith("--max-body-chars=")) {
      options.maxBodyChars = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-body-chars") {
      options.maxBodyChars = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--max-enrichment-chars=")) {
      options.maxEnrichmentChars = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-enrichment-chars") {
      options.maxEnrichmentChars = parsePositiveInt(argv[i + 1]);
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

    if (token.startsWith("--prompt-dir=")) {
      options.promptDir = token.split("=", 2)[1] || undefined;
      continue;
    }

    if (token === "--prompt-dir") {
      options.promptDir = argv[i + 1] || undefined;
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
    const result = await classifyPipelineItemsByLlm(prisma, {
      dryRun: options.dryRun,
      limit: options.limit,
      platforms: options.platforms.length > 0 ? options.platforms : undefined,
      model: options.model,
      maxBodyChars: options.maxBodyChars,
      maxEnrichmentChars: options.maxEnrichmentChars,
      maxRetries: options.maxRetries,
      fallbackToRules: options.fallbackToRules,
      pendingOnly: options.pendingOnly,
      promptDir: options.promptDir,
      logger: console,
    });

    console.log("\n=== Step1-3 LLM classification summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal classify-llm error:", error);
  process.exit(1);
});
