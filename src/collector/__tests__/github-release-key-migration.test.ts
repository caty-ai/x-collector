import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20260907000000_gh_item_release_key_repo_tag/migration.sql"), "utf8")
  .replace(/--[^\n]*/g, "");
const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);

function statementIndex(pattern: RegExp): number {
  const index = statements.findIndex((statement) => pattern.test(statement));
  expect(index, `Missing SQL statement: ${pattern}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("GitHub release key migration", () => {
  it("detaches pipeline collisions before rewriting keys and deleting or updating legacy GhItems", () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+pipeline_items/i);
    const pipelineDetach = statementIndex(/^UPDATE pipeline_items p\s+SET "externalId" = NULL/);
    const pipelineUpdate = statementIndex(/^UPDATE pipeline_items p\s+SET "externalId" = m.new_id/);
    const ghDelete = statementIndex(/^DELETE FROM gh_items/);
    const ghUpdate = statementIndex(/^UPDATE gh_items g\s+SET id = m.new_id/);
    expect(pipelineDetach).toBeLessThan(pipelineUpdate);
    expect(pipelineUpdate).toBeLessThan(ghDelete);
    expect(ghDelete).toBeLessThan(ghUpdate);
  });

  it("limits the mapping to legacy releases with a repo and a non-null tag", () => {
    const mapping = statements[statementIndex(/^CREATE TEMP TABLE gh_release_key_map/)];
    expect(mapping).toContain('lower(s.repo) || \':\' || g."tagName" AS new_id');
    expect(mapping).toContain('JOIN gh_sources s ON s.id = g."sourceId"');
    expect(mapping).toContain("g.type = 'release'");
    expect(mapping).toContain('g.id = g."tagName"');
    expect(mapping).not.toContain("position(");
    expect(mapping).toContain("s.repo IS NOT NULL");
    expect(mapping).toContain('g."tagName" IS NOT NULL');
  });

  it("guards destination collisions and many-to-one mappings for both unique keys", () => {
    const pipelineDetach = statements[statementIndex(/^UPDATE pipeline_items p\s+SET "externalId" = NULL/)];
    expect(pipelineDetach).toContain('target."externalId" = m.new_id');
    expect(pipelineDetach).toContain("target.platform = 'github'");
    expect(pipelineDetach).toContain("other.id < p.id");
    expect(pipelineDetach).toContain("other_map.new_id = m.new_id");
    const ghDelete = statements[statementIndex(/^DELETE FROM gh_items/)];
    expect(ghDelete).toContain("target.id = m.new_id");
    expect(ghDelete).toContain("other.new_id = m.new_id AND other.old_id < m.old_id");
    const pipelineUpdate = statements[statementIndex(/^UPDATE pipeline_items p\s+SET "externalId" = m.new_id/)];
    expect(pipelineUpdate).toContain("p.platform = 'github'");
  });

  it("runs atomically with read/write exclusion and drops the temporary mapping on commit", () => {
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '30s'");
    expect(statements[2]).toBe("SET LOCAL statement_timeout = '5min'");
    expect(statements[3]).toBe("LOCK TABLE gh_sources, gh_items, pipeline_items IN ACCESS EXCLUSIVE MODE");
    expect(sql).toContain("CREATE TEMP TABLE gh_release_key_map ON COMMIT DROP AS");
    expect(statements.at(-1)).toBe("COMMIT");
  });
});

const script = readFileSync(resolve(process.cwd(), "tools/gh-dedup-backfill.mjs"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260907000000_gh_item_release_key_repo_tag/migration.sql"), "utf8");

async function runBackfill(args: string[] = [], databaseUrl: string | undefined = "postgresql://test", failQuery = false) {
  const output: string[] = [];
  const queries: string[] = [];
  const writes: string[] = [];
  let clients = 0;
  let transactions = 0;
  const processMock = { env: { DATABASE_URL: databaseUrl }, argv: ["node", "script", ...args], exitCode: undefined as number | undefined };
  class PrismaMock {
    constructor() { clients++; }
    async $queryRaw(strings: TemplateStringsArray) {
      queries.push(strings.join(""));
      if (failQuery) throw new Error("query unavailable");
      return queries.length === 1 ? [{ oldFormatReleases: BigInt(1) }] : [];
    }
    async $transaction(callback: (tx: { $executeRawUnsafe: (statement: string) => Promise<void> }) => Promise<void>) {
      transactions++;
      await callback({ $executeRawUnsafe: async (statement) => { writes.push(statement); } });
    }
    async $disconnect() {}
  }
  const execute = new Function("PrismaClient", "readFile", "process", "console", `return (async () => {
    ${script.replace(/^import .*;\n/gm, "").split("import.meta.url").join(JSON.stringify("file:///repo/tools/gh-dedup-backfill.mjs"))}
  })();`);
  await execute(PrismaMock, async (url: URL) => {
    expect(url.pathname).toBe("/repo/prisma/migrations/20260907000000_gh_item_release_key_repo_tag/migration.sql");
    return migration;
  }, processMock, { log: (...values: unknown[]) => output.push(values.join(" ")), error: (value: string) => output.push(value) });
  return { code: processMock.exitCode, output, queries, writes, clients, transactions };
}

describe("GitHub release backfill CLI", () => {
  it.each([[], ["--apply"], ["--apply", "--yes"]].map((args) => ({ args })))("checks DATABASE_URL first for $args", async ({ args }) => {
    // Empty string exercises the same unset-config guard without the helper default.
    const result = await runBackfill(args, "");
    expect(result.code).toBe(2);
    expect(result.output).toEqual(["GitHub release dedup unavailable: DATABASE_URL is not set. No data changed."]);
    expect(result.clients).toBe(0);
    expect(result.writes).toEqual([]);
  });

  it.each([[], ["--dry-run"]].map((args) => ({ args })))("only SELECTs by default and with $args", async ({ args }) => {
    const result = await runBackfill(args);
    expect(result.code).toBe(0);
    expect(result.queries).toHaveLength(2);
    for (const query of result.queries) {
      expect(query.trim()).toMatch(/^(WITH|SELECT)\b/);
      expect(query).toContain('g.id = g."tagName"');
      expect(query).not.toMatch(/\b(DELETE|UPDATE|INSERT|ALTER|DROP)\b/i);
    }
    expect(result.queries[0]).toContain('lower(s.repo) || \':\' || g."tagName" AS new_id');
    expect(result.queries[0]).toContain('repo IS NOT NULL AND "tagName" IS NOT NULL');
    expect(result.queries[0]).toMatch(/\(SELECT count\(\*\) FROM gh_items g JOIN gh_sources s ON s\.id = g\."sourceId"\s+WHERE g\.type = 'release' AND g\."tagName" IS NULL AND s\.repo IS NOT NULL\) AS "nullTagNameSkipped"/);
    expect(result.queries[1]).toContain("regexp_replace(split_part(split_part(lower(g.url), '?', 1), '#', 1)");
    expect(result.queries[1]).toContain(") <> '/' || lower(s.repo) || '/'");
    expect(result.output).toContain("oldFormatReleases: 1");
    expect(result.output.at(-1)).toBe("DRY-RUN OK");
    expect(result.writes).toEqual([]);
    expect(result.transactions).toBe(0);
  });

  it("reports a query failure without a stack or success marker", async () => {
    const result = await runBackfill([], "postgresql://test", true);
    expect(result.code).toBe(1);
    expect(result.output).toEqual(["GitHub release dedup failed: query unavailable"]);
  });

  it("previews without connecting or writing when --yes is missing", async () => {
    const result = await runBackfill(["--apply"]);
    expect(result.code).toBe(3);
    expect(result.clients).toBe(0);
    expect(result.output.join("\n")).toContain("LOCK TABLE gh_sources");
    expect(result.writes).toEqual([]);
  });

  it("executes the migration body verbatim in one transaction on confirmed apply", async () => {
    const result = await runBackfill(["--apply", "--yes"]);
    expect(result.code).toBe(0);
    expect(result.transactions).toBe(1);
    expect(result.queries).toEqual([]);
    expect(result.writes.join("\n")).toBe(migration.replace(/^\s*BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, ""));
    expect(result.writes[0]).toBe("SET LOCAL lock_timeout = '30s';");
    expect(result.writes[1]).toBe("SET LOCAL statement_timeout = '5min';");
    expect(result.writes[2]).toContain("LOCK TABLE gh_sources, gh_items, pipeline_items IN ACCESS EXCLUSIVE MODE;");
    expect(result.writes).toHaveLength(statements.length - 2);
    expect(result.output).toEqual(["APPLY OK"]);
  });
});
