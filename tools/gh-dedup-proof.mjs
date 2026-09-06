/**
 * Opt-in local PostgreSQL 16 proof (requires psql on PATH).
 * GH_DEDUP_PROOF=1 DATABASE_URL=postgresql://postgres@127.0.0.1:54151/xc151 \
 *   node tools/gh-dedup-proof.mjs
 *
 * Apply every older migration.sql in lexical order using psql, not Prisma's
 * migration ledger. Whole files preserve DO blocks and SQL transaction boundaries.
 * Bootstrap public only when empty so a subsequent backfill dry-run can run.
 * All fixtures live in a unique isolated schema, removed in finally, even on
 * assertion failure. Public receives no fixtures. This is local evidence, not CI.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const migrationName = "20260907000000_gh_item_release_key_repo_tag";
const migrationsUrl = new URL("../prisma/migrations/", import.meta.url);

async function main() {
  assert.equal(process.env.GH_DEDUP_PROOF, "1", "Refusing: GH_DEDUP_PROOF=1 is required");
  assert.ok(process.env.DATABASE_URL, "Refusing: DATABASE_URL is required");
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Refusing: PostgreSQL URL required");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Refusing: DATABASE_URL host must be localhost or 127.0.0.1");
  assert.equal(url.pathname, "/xc151", "Refusing: only the disposable xc151 database is allowed");
  assert.equal(url.search, "", "Refusing: URL query overrides are not allowed");
  assert.equal(url.hash, "", "Refusing: URL fragments are not allowed");
  const connectionEnv = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.startsWith("PG")));

  function sql(body, schema = "public", tuples = false) {
    // Remove PGHOSTADDR/PGSERVICE/etc. so libpq cannot redirect a local URL.
    const result = spawnSync("psql", ["-X", "--no-password", "--dbname", url.href,
      "--set", "ON_ERROR_STOP=1", ...(tuples ? ["-A", "-t", "-q"] : [])], {
      input: body,
      encoding: "utf8",
      env: { ...connectionEnv, PGOPTIONS: `-c search_path=${schema}` },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 600_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `psql failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }
  const version = sql("SHOW server_version;", "public", true);
  assert.match(version, /^16\./, "Proof requires PostgreSQL 16");
  console.log(`PostgreSQL ${version}; database xc151 (local only)`);

  const directories = (await readdir(migrationsUrl, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < migrationName)
    .map((entry) => entry.name).sort();
  assert.ok(directories.length > 0, "Older migration files must exist");
  const olderSql = (await Promise.all(directories.map((name) =>
    readFile(new URL(`${name}/migration.sql`, migrationsUrl), "utf8")))).join("\n");
  const migration = await readFile(new URL(`${migrationName}/migration.sql`, migrationsUrl), "utf8");
  assert.match(migration, /LOCK TABLE gh_sources, gh_items, pipeline_items IN ACCESS EXCLUSIVE MODE;/);
  const publicTables = Number(sql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public';", "public", true));
  if (publicTables === 0) {
    sql(`BEGIN;\n${olderSql}\nCOMMIT;`);
    console.log(`Public baseline: applied ${directories.length} older migrations; no fixtures inserted`);
  } else {
    console.log("Public baseline already populated: left untouched; proof uses isolated schema");
  }

  const schema = `gh_dedup_proof_${process.pid}_${Date.now()}`;
  sql(`CREATE SCHEMA ${schema};`);
  try {
    sql(`BEGIN;\n${olderSql}\nCOMMIT;`, schema);
    console.log(`Proof baseline: applied ${directories.length} older migrations, excluding ${migrationName}`);
    const query = (body) => JSON.parse(sql(body, schema, true));
    const rows = (table) => query(`SELECT COALESCE(json_agg(t ORDER BY t.id), '[]'::json) FROM ${table} t;`);
    const check = (condition, message) => {
      assert.ok(condition, message);
      console.log(`PASS ${message}`);
    };
    sql(`
      INSERT INTO gh_sources (id, name, repo) VALUES
        (1, 'Repo A', 'alpha/a'), (2, 'Repo B', 'beta/b'),
        (3, 'Missing repo', NULL), (4, 'Mixed case', 'Owner/Repo'),
        (5, 'Lower case', 'owner/repo');
      INSERT INTO gh_items (id, "sourceId", title, url, "tagName") VALUES
        ('v1', 1, 'Repo B release (legacy hybrid)', 'https://github.com/beta/b/releases/tag/v1', 'v1'),
        ('v2', 1, 'Legacy duplicate', 'https://github.com/alpha/a/releases/tag/v2', 'v2'),
        ('alpha/a:v2', 1, 'Existing canonical release', 'https://github.com/alpha/a/releases/tag/v2', 'v2'),
        ('v3:rc1', 1, 'Colon tag', 'https://github.com/alpha/a/releases/tag/v3:rc1', 'v3:rc1'),
        ('no-repo', 3, 'No repo', 'https://example.test/no-repo', 'no-repo'),
        ('no-tag', 1, 'No tag', 'https://example.test/no-tag', NULL),
        ('v4', 4, 'Mixed case legacy', 'https://github.com/Owner/Repo/releases/tag/v4', 'v4'),
        ('owner/repo:v4', 5, 'Lower case canonical', 'https://github.com/owner/repo/releases/tag/v4', 'v4'),
        ('v5', 4, 'Mixed case rewrite', 'https://github.com/Owner/Repo/releases/tag/v5', 'v5');
      INSERT INTO pipeline_items (id, platform, "externalId", url, "updatedAt")
        SELECT 'p-' || id, 'github', id,
          CASE WHEN id IN ('alpha/a:v2', 'owner/repo:v4') THEN url || '?canonical=1' ELSE url END,
          CURRENT_TIMESTAMP FROM gh_items;
      INSERT INTO newsletter_editions (id, "editionDate", title, slug, "updatedAt")
        VALUES ('edition', CURRENT_TIMESTAMP, 'Proof edition', 'proof-edition', CURRENT_TIMESTAMP);
      INSERT INTO newsletter_bindings ("editionId", "pipelineItemId", section)
        SELECT 'edition', id, 'releases' FROM pipeline_items;
    `, schema);
    console.log("Fixtures: hybrid same-tag repos, existing-key duplicates, colon tag, NULL repo/tag, NewsletterBindings, mixed-case repos");
    const beforePipeline = rows("pipeline_items");
    const beforeBindings = rows("newsletter_bindings");
    const beforeGh = rows("gh_items");
    const beforeSources = rows("gh_sources");
    const mappings = beforeGh.flatMap((item) => {
      const source = beforeSources.find((candidate) => candidate.id === item.sourceId);
      return item.type === "release" && item.tagName !== null && item.id === item.tagName && source.repo !== null
        ? [{ oldId: item.id, newId: `${source.repo.toLowerCase()}:${item.tagName}` }] : [];
    });
    function apply(label) {
      const output = sql(migration, schema);
      const counts = [...output.matchAll(/^(UPDATE|DELETE) (\d+)$/gm)].map((match) => Number(match[2]));
      assert.equal(counts.length, 4, "Expected all four migration UPDATE/DELETE command counts");
      console.log(`${label}: ${output.split("\n").join("; ")}`);
      return counts.reduce((sum, value) => sum + value, 0);
    }
    check(apply("First apply") > 0, "first migration changed fixture rows");
    const afterPipeline = rows("pipeline_items");
    const afterBindings = rows("newsletter_bindings");
    const afterGh = rows("gh_items");
    check(afterPipeline.length === beforePipeline.length &&
      beforePipeline.every((item) => afterPipeline.some((candidate) => candidate.id === item.id)),
    `pipeline rows preserved (${beforePipeline.length} -> ${afterPipeline.length})`);
    check(JSON.stringify(afterBindings) === JSON.stringify(beforeBindings),
      `NewsletterBindings unchanged (${beforeBindings.length} -> ${afterBindings.length})`);
    check(mappings.every(({ oldId, newId }) => !afterGh.some((item) => item.id === oldId) &&
      afterGh.some((item) => item.id === newId)), "every eligible legacy release maps to lower(repo):tag");
    check(mappings.every(({ oldId, newId }) => {
      const item = afterPipeline.find((candidate) => candidate.id === `p-${oldId}`);
      const occupied = beforePipeline.some((candidate) => candidate.externalId === newId);
      return item.externalId === (occupied ? null : newId);
    }), "pipeline legacy keys rewritten, occupied destinations detached without deleting history");
    check(afterGh.length === beforeGh.length - 2 &&
      afterGh.find((item) => item.id === 'alpha/a:v2').title === 'Existing canonical release' &&
      afterGh.find((item) => item.id === 'owner/repo:v4').title === 'Lower case canonical',
    "duplicate legacy gh_items dropped; canonical rows retained including mixed-case collision");
    for (const id of ["no-repo", "no-tag"]) {
      check(JSON.stringify(afterGh.find((item) => item.id === id)) ===
        JSON.stringify(beforeGh.find((item) => item.id === id)) &&
        JSON.stringify(afterPipeline.find((item) => item.id === `p-${id}`)) ===
        JSON.stringify(beforePipeline.find((item) => item.id === `p-${id}`)),
      `${id === "no-repo" ? "repo IS NULL" : "tagName IS NULL"} row untouched`);
    }
    check(afterGh.some((item) => item.id === "alpha/a:v3:rc1"), "colon-tag legacy row rewritten intact");
    check(afterGh.some((item) => item.id === "owner/repo:v5"), "mixed-case repo rewritten to lowercase");
    check(afterGh.find((item) => item.id === 'alpha/a:v1').sourceId === 1 &&
      afterGh.find((item) => item.id === 'alpha/a:v1').title === 'Repo B release (legacy hybrid)',
    "hybrid row keyed by source A; unrecoverable B content preserved for refetch");
    check(apply("Second apply") === 0, "second apply changed 0 rows");
    check(JSON.stringify(rows("gh_items")) === JSON.stringify(afterGh) &&
      JSON.stringify(rows("pipeline_items")) === JSON.stringify(afterPipeline) &&
      JSON.stringify(rows("newsletter_bindings")) === JSON.stringify(afterBindings),
    "second apply leaves complete row snapshots unchanged");
    // Exercise the new collector key as the conflict target; the URL unique index
    // remains active, so a missed rewrite would raise a platform/url violation.
    sql(`INSERT INTO pipeline_items (id, platform, "externalId", url, "updatedAt")
      VALUES ('would-be-new', 'github', 'owner/repo:v5',
        'https://github.com/Owner/Repo/releases/tag/v5', CURRENT_TIMESTAMP)
      ON CONFLICT (platform, "externalId") DO UPDATE SET title = 'Refetched';`, schema);
    check(rows("pipeline_items").length === beforePipeline.length &&
      rows("pipeline_items").find((item) => item.id === "p-v5").title === "Refetched",
    "subsequent upsert with collector key and same URL satisfies [platform, url]");
  } finally {
    sql(`DROP SCHEMA ${schema} CASCADE;`);
    console.log("Cleanup: isolated proof schema and all fixtures removed; public baseline retained");
  }
  console.log("PROOF OK");
}

try {
  await main();
} catch (error) {
  console.error(`PROOF FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
