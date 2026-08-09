import fs from "fs";
import path from "path";
import { HANDLE_RE } from "./x-handle";

const DATA_PATH = path.resolve(__dirname, "../../data/x-handles.json");

type RawEntry = {
  handle?: unknown;
  category?: unknown;
};

type XHandleEntry = {
  handle: string;
  category: string;
};

type Summary = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function readEntries() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`Expected ${DATA_PATH} to contain an array`);
  }
  return raw as RawEntry[];
}

function validateEntries(entries: RawEntry[]) {
  const valid: XHandleEntry[] = [];
  let skipped = 0;

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      console.error(`Skipping entry ${index}: expected object`);
      skipped++;
      return;
    }

    if (typeof entry.handle !== "string" || typeof entry.category !== "string") {
      console.error(`Skipping entry ${index}: expected string handle and category`);
      skipped++;
      return;
    }

    if (!HANDLE_RE.test(entry.handle)) {
      console.error(`Skipping @${entry.handle}: invalid handle`);
      skipped++;
      return;
    }

    if (entry.category.trim() === "") {
      console.error(`Skipping @${entry.handle}: empty category`);
      skipped++;
      return;
    }

    valid.push({ handle: entry.handle, category: entry.category });
  });

  return { valid, skipped };
}

function printSummary(summary: Summary) {
  console.log(
    `created=${summary.created} updated=${summary.updated} unchanged=${summary.unchanged} skipped=${summary.skipped}`,
  );
}

async function main() {
  const entries = readEntries();
  const { valid, skipped } = validateEntries(entries);

  if (isDryRun()) {
    console.log(`Dry run: validated ${valid.length} entries from ${DATA_PATH}`);
    for (const entry of valid) {
      console.log(`Would upsert @${entry.handle} with tag ${entry.category}`);
    }
    printSummary({ created: 0, updated: 0, unchanged: 0, skipped });
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const summary: Summary = { created: 0, updated: 0, unchanged: 0, skipped };

  try {
    for (const entry of valid) {
      const existing = await prisma.source.findUnique({
        where: { handle: entry.handle },
      });
      const hasCategory = existing?.tags.includes(entry.category) ?? false;
      const updateData = existing && !hasCategory ? { tags: [...existing.tags, entry.category] } : {};

      // Re-run safety: upsert creates only when no Source exists for this handle,
      // so a second run should report created=0 and preserve existing active state.
      await prisma.source.upsert({
        where: { handle: entry.handle },
        create: {
          type: "vip_handle",
          handle: entry.handle,
          active: true,
          tags: [entry.category],
        },
        update: updateData,
      });

      if (!existing) {
        summary.created++;
        console.log(`Created source: @${entry.handle} (${entry.category})`);
      } else if (hasCategory) {
        summary.unchanged++;
        console.log(`Unchanged source: @${entry.handle} (${entry.category})`);
      } else {
        summary.updated++;
        console.log(`Updated source: @${entry.handle} (+${entry.category})`);
      }
    }

    summary.skipped = skipped;
    printSummary(summary);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
