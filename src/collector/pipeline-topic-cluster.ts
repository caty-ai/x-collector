import { PrismaClient } from "@prisma/client";
import { runTopicCluster } from "../lib/pipeline/topic-cluster";

interface CliOptions {
  dryRun: boolean;
  lookbackHours?: number;
  cosineThreshold?: number;
  beta?: number;
  gamma?: number;
  platforms: string[];
  includeCompleted: boolean;
}

function parsePlatforms(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    platforms: [],
    includeCompleted: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--include-completed") {
      options.includeCompleted = true;
      continue;
    }

    if (token.startsWith("--lookback-hours=")) {
      options.lookbackHours = parsePositiveNumber(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--lookback-hours") {
      options.lookbackHours = parsePositiveNumber(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--cosine-threshold=")) {
      options.cosineThreshold = parsePositiveNumber(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--cosine-threshold") {
      options.cosineThreshold = parsePositiveNumber(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--beta=")) {
      options.beta = parsePositiveNumber(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--beta") {
      options.beta = parsePositiveNumber(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--gamma=")) {
      options.gamma = parsePositiveNumber(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--gamma") {
      options.gamma = parsePositiveNumber(argv[i + 1]);
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
  }

  options.platforms = [...new Set(options.platforms)];
  return options;
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await runTopicCluster(prisma, {
      dryRun: options.dryRun,
      lookbackHours: options.lookbackHours,
      cosineThreshold: options.cosineThreshold,
      beta: options.beta,
      gamma: options.gamma,
      platforms: options.platforms.length > 0 ? options.platforms : undefined,
      includeCompleted: options.includeCompleted,
      logger: console,
    });

    console.log("\n=== Step4.5 topic-cluster manual-run summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal topic-cluster error:", error);
  process.exit(1);
});
