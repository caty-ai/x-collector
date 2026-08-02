import { PrismaClient } from "@prisma/client";
import {
  NORMALIZE_PLATFORMS,
  NormalizePlatform,
  normalizePipelineItems,
} from "../lib/pipeline/normalize";

interface CliOptions {
  dryRun: boolean;
  platforms: NormalizePlatform[];
  lookbackDays?: number;
}

function parsePlatforms(raw: string): NormalizePlatform[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is NormalizePlatform =>
      NORMALIZE_PLATFORMS.includes(value as NormalizePlatform),
    );
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const value = raw.trim();
  if (!value) {
    return Number.NaN;
  }

  return Number(value);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    platforms: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token.startsWith("--platform=")) {
      const value = token.split("=", 2)[1] || "";
      options.platforms.push(...parsePlatforms(value));
      continue;
    }

    if (token === "--platform") {
      const value = argv[i + 1] || "";
      options.platforms.push(...parsePlatforms(value));
      i += 1;
      continue;
    }

    if (token.startsWith("--lookback-days=")) {
      options.lookbackDays = parseNumber(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--lookback-days") {
      options.lookbackDays = parseNumber(argv[i + 1]);
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
    const result = await normalizePipelineItems(prisma, {
      dryRun: options.dryRun,
      platforms: options.platforms.length ? options.platforms : undefined,
      lookbackDays: options.lookbackDays,
      logger: console,
    });

    console.log("\n=== Step0 normalization summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal normalize error:", error);
  process.exit(1);
});
