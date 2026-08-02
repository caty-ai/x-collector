import { PrismaClient } from "@prisma/client";
import { recomputeSourceTrust, SourceTrustDetail } from "../collector/source-score";

function isWriteMode() {
  return process.argv.includes("--write");
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return `${value}${" ".repeat(width - value.length)}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${Math.round(value * 100)}%`;
}

function printTable(details: SourceTrustDetail[]) {
  const headers = [
    pad("handle", 18),
    pad("score", 5),
    pad("label", 8),
    pad("items", 5),
    pad("nonNoise", 8),
    pad("adopt", 6),
    pad("priority", 8),
    pad("reason", 0),
  ];

  console.log(headers.join("  "));
  console.log("-".repeat(96));

  for (const detail of details) {
    console.log(
      [
        pad(`@${detail.handle}`, 18),
        pad(String(detail.trustScore), 5),
        pad(detail.trustLabel, 8),
        pad(String(detail.counts.classifiedItemCount28), 5),
        pad(formatPercent(detail.rawSignals.nonNoiseRate), 8),
        pad(formatPercent(detail.rawSignals.adoptionRate), 6),
        pad(formatPercent(detail.rawSignals.priorityScore), 8),
        detail.reason,
      ].join("  "),
    );
  }
}

async function main() {
  const write = isWriteMode();
  const prisma = new PrismaClient();

  try {
    const result = await recomputeSourceTrust(prisma, {
      dryRun: !write,
      logger: console,
    });

    console.log("\n=== Source trust breakdown ===");
    printTable(result.details);
    console.log("\n=== Source trust summary ===");
    console.log(
      JSON.stringify(
        {
          dryRun: result.dryRun,
          scored: result.scored,
          written: result.written,
          labels: result.labelCounts,
          medians: result.medians,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal source trust error:", error);
  process.exit(1);
});
