import { PrismaClient } from "@prisma/client";
import { enrichAlertsYoutubeTranscripts } from "../lib/pipeline/enrich-youtube-transcript";

interface CliOptions {
  dryRun: boolean;
  limit?: number;
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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
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
  }

  return options;
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await enrichAlertsYoutubeTranscripts(prisma, {
      dryRun: options.dryRun,
      limit: options.limit,
      logger: console,
    });

    console.log("\n=== Alerts YouTube transcript enrichment summary ===");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal transcript enrichment error:", error);
  process.exit(1);
});
