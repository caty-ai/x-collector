import { PrismaClient } from "@prisma/client";
import { classifyPipelineItems } from "../lib/pipeline/classify";

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  platforms: string[];
}

function parsePlatforms(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
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

    if (token.startsWith("--limit=")) {
      options.limit = parseLimit(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--limit") {
      options.limit = parseLimit(argv[i + 1]);
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

  return options;
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await classifyPipelineItems(prisma, {
      dryRun: options.dryRun,
      limit: options.limit,
      platforms: options.platforms.length > 0 ? options.platforms : undefined,
      logger: console,
    });

    console.log("\n=== Step1-3 classification summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal classify error:", error);
  process.exit(1);
});
