import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const migrationUrl = new URL("../prisma/migrations/20260907000000_gh_item_release_key_repo_tag/migration.sql", import.meta.url);

async function main() {
  // Check configuration before argument handling, previewing SQL, or creating a client.
  if (!process.env.DATABASE_URL) {
    console.error("GitHub release dedup unavailable: DATABASE_URL is not set. No data changed.");
    return 2;
  }
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--apply", "--yes"].includes(arg)) ||
      (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Usage: node tools/gh-dedup-backfill.mjs [--dry-run | --apply --yes]");
  }
  const apply = args.includes("--apply");
  const body = apply
    ? (await readFile(migrationUrl, "utf8")).replace(/^\s*BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, "")
    : null;
  if (apply && !args.includes("--yes")) {
    console.log("Would run the following migration in one transaction. Re-run with --apply --yes to write:");
    console.log(body);
    return 3;
  }

  const prisma = new PrismaClient({ log: [] });
  try {
    if (apply) {
      await prisma.$transaction(async (tx) => {
        // The migration uses one semicolon-terminated statement per line ending.
        // Preserve its SQL, including bounded timeouts and ACCESS EXCLUSIVE locks;
        // Prisma accepts one statement per call.
        for (const statement of body.split(/(?<=;)\r?\n/).filter((sql) => sql.trim())) {
          await tx.$executeRawUnsafe(statement);
        }
      }, { maxWait: 30_000, timeout: 600_000 });
    } else {
      // Read-only by construction: this path executes only SELECT queries.
      const [counts] = await prisma.$queryRaw`
        WITH legacy AS (
          SELECT g.*, s.repo, lower(s.repo) || ':' || g."tagName" AS new_id
          FROM gh_items g JOIN gh_sources s ON s.id = g."sourceId"
          WHERE g.type = 'release' AND g.id = g."tagName"
        ), mapping AS (
          SELECT * FROM legacy WHERE repo IS NOT NULL AND "tagName" IS NOT NULL
        ), pipeline_candidates AS (
          SELECT p.id, m.new_id,
            row_number() OVER (PARTITION BY m.new_id ORDER BY p.id) AS ordinal,
            EXISTS (SELECT 1 FROM pipeline_items target
                    WHERE target.platform = 'github' AND target."externalId" = m.new_id) AS occupied
          FROM pipeline_items p JOIN mapping m ON p."externalId" = m.id
          WHERE p.platform = 'github'
        ), gh_candidates AS (
          SELECT m.id, row_number() OVER (PARTITION BY m.new_id ORDER BY m.id) AS ordinal,
            EXISTS (SELECT 1 FROM gh_items target WHERE target.id = m.new_id) AS occupied
          FROM mapping m
        )
        SELECT
          (SELECT count(*) FROM legacy) AS "oldFormatReleases",
          (SELECT count(*) FROM legacy WHERE repo IS NOT NULL) AS "withRepo",
          (SELECT count(*) FROM legacy WHERE repo IS NULL) AS "nullRepo",
          (SELECT count(*) FROM gh_items g JOIN gh_sources s ON s.id = g."sourceId"
           WHERE g.type = 'release' AND g."tagName" IS NULL AND s.repo IS NOT NULL) AS "nullTagNameSkipped",
          (SELECT count(*) FROM pipeline_candidates WHERE NOT occupied AND ordinal = 1) AS "pipelineRowsToRewrite",
          (SELECT count(*) FROM gh_candidates WHERE occupied OR ordinal > 1) AS "ghTargetCollisionsToDelete",
          (SELECT count(*) FROM pipeline_candidates WHERE occupied OR ordinal > 1) AS "pipelineTargetCollisionsToDetach"
      `;
      console.log("GitHub release dedup dry-run (read-only)");
      console.log("Pipeline collisions are detached (externalId set to NULL); pipeline rows and history are never deleted.");
      for (const [name, count] of Object.entries(counts)) {
        console.log(`${name}: ${count}`);
      }

      // Extract the URL path without treating repo names as SQL LIKE patterns.
      const suspects = await prisma.$queryRaw`
        SELECT g.id, g."sourceId", s.repo, g.url, g.title
        FROM gh_items g JOIN gh_sources s ON s.id = g."sourceId"
        WHERE g.type = 'release' AND g.id = g."tagName" AND s.repo IS NOT NULL AND g."tagName" IS NOT NULL
          AND left(
            regexp_replace(split_part(split_part(lower(g.url), '?', 1), '#', 1), '^[A-Za-z][A-Za-z0-9+.-]*://[^/]*', ''),
            length(s.repo) + 2
          ) <> '/' || lower(s.repo) || '/'
        ORDER BY g.id
        LIMIT 20
      `;
      console.log("Suspected hybrid rows (URL path mismatch, up to 20):");
      console.log(JSON.stringify(suspects, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(apply ? "APPLY OK" : "DRY-RUN OK");
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`GitHub release dedup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
