/**
 * Community sources are discoverable data, never subscription input.
 *
 * This suite is a strong tripwire against maintainer regressions, not a proof. Earlier designs were
 * bypassed six different ways; these five independent legs make any equivalent wiring a visible,
 * deliberate test change. External community PRs cannot change runtime code because the gate rejects
 * every path outside the single community-source JSON file.
 */
import assert from "assert/strict";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const COMMUNITY_DIR = path.join(REPO_ROOT, "data/community-sources");
const X_HANDLES_PATH = path.join(REPO_ROOT, "data/x-handles.json");

const EXPECTED_SCRIPTS: Record<string, string> = {
  "backfill:ja:pipeline": "ts-node -r dotenv/config src/collector/pipeline-backfill-ja.ts",
  build: "prisma generate && next build && tsc -p tsconfig.collector.json",
  "classify:pipeline": "ts-node -r dotenv/config src/collector/pipeline-classify.ts",
  "classify:pipeline:llm": "ts-node -r dotenv/config src/collector/pipeline-classify-llm.ts",
  collect: "ts-node -r dotenv/config src/collector/run.ts",
  "collect:prod": "node dist/collector/run-prod-collect-cycle.js",
  "collect:prod:cycle": "ts-node -r dotenv/config src/collector/run-prod-collect-cycle.ts",
  "collect:prod:legacy": "node dist/collector/run.js",
  "contribute:source": "ts-node -r dotenv/config src/scripts/contribute-source.ts",
  "crosslink:pipeline": "ts-node -r dotenv/config src/collector/pipeline-crosslink.ts",
  "crosslink:pipeline:llm": "ts-node -r dotenv/config src/collector/pipeline-crosslink-llm.ts",
  dev: "next dev",
  "discover:prod": "node dist/collector/run-discovery-cycle.js",
  "discover:prod:cycle": "ts-node -r dotenv/config src/collector/run-discovery-cycle.ts",
  "enrich:pipeline:links": "ts-node -r dotenv/config src/collector/pipeline-enrich-links.ts",
  "enrich:pipeline:transcripts": "ts-node -r dotenv/config src/collector/pipeline-enrich-transcripts.ts",
  "import:x-handles": "ts-node -r dotenv/config src/scripts/import-x-handles.ts",
  migrate: "prisma migrate dev",
  "normalize:pipeline": "ts-node -r dotenv/config src/collector/pipeline-normalize.ts",
  "publish:pipeline": "ts-node -r dotenv/config src/collector/pipeline-publish.ts",
  "publish:prod": "node dist/collector/run-prod-step5.js",
  "publish:prod:daily": "ts-node -r dotenv/config src/collector/run-prod-step5.ts",
  "retention:pipeline": "ts-node -r dotenv/config src/collector/pipeline-retention.ts",
  "retention:prod": "node dist/collector/pipeline-retention.js",
  seed: "ts-node -r dotenv/config src/seed.ts",
  "seed:prod": "node dist/seed.js",
  start: "next start",
  "step4:crosslink:llm": "ts-node -r dotenv/config src/collector/pipeline-crosslink-llm.ts",
  summary: "ts-node -r dotenv/config src/summary/daily.ts",
  "summary:prod": "node dist/summary/daily.js",
  "test:community": "ts-node src/scripts/community/no-auto-subscribe.test.ts",
  "topic-cluster:pipeline": "ts-node -r dotenv/config src/collector/pipeline-topic-cluster.ts",
  "typecheck:community": "tsc --noEmit -p tsconfig.community.json",
  "validate:community": "ts-node src/scripts/community/validate-community-source.ts --all",
  "voicesignal:pipeline": "ts-node -r dotenv/config src/collector/pipeline-voicesignal.ts",
};

const EXPECTED_DB_WRITES: Record<string, string[]> = {
  "src/app/api/alert-fetch/route.ts": ["alertSource.update"],
  "src/app/api/alert-sources/route.ts": ["alertSource.create", "alertSource.delete", "alertSource.update"],
  "src/app/api/sources/route.ts": ["source.create", "source.delete", "source.update"],
  "src/collector/alerts.ts": ["alertSource.update"],
  "src/collector/discover.ts": ["source.create"],
  "src/collector/lifecycle.ts": ["source.update", "source.updateMany"],
  "src/collector/source-score.ts": ["source.update"],
  "src/scripts/import-x-handles.ts": ["source.upsert"],
  "src/seed.ts": ["source.upsert"],
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "leg 1: DATABASE_URL is required; this suite must fail, never skip, when it is unset");
  const parsed = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && parsed.pathname.toLowerCase().includes("test"),
    "leg 1: refusing to mutate a database that is not a local test database",
  );
  return value;
}

function walkSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkSourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

function relative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function createTraceHook(tempDir: string): { hookPath: string; tracePath: string } {
  const hookPath = path.join(tempDir, "fs-trace.cjs");
  const tracePath = path.join(tempDir, "opened-paths.jsonl");
  const hook = `
const fs = require("fs");
const Module = require("module");
const { fileURLToPath } = require("url");
const trace = ${JSON.stringify(tracePath)};
const append = fs.appendFileSync.bind(fs);
function record(value) {
  try {
    const normalized = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : String(value);
    append(trace, JSON.stringify(normalized) + "\\n");
  } catch {}
}
for (const name of ["readFileSync", "readFile", "createReadStream", "openSync", "open"]) {
  const original = fs[name];
  fs[name] = function(pathValue, ...args) { record(pathValue); return original.call(this, pathValue, ...args); };
}
for (const name of ["readFile", "open"]) {
  const original = fs.promises[name];
  fs.promises[name] = function(pathValue, ...args) { record(pathValue); return original.call(this, pathValue, ...args); };
}
const originalJson = Module._extensions[".json"];
Module._extensions[".json"] = function(module, filename) { record(filename); return originalJson(module, filename); };
`;
  fs.writeFileSync(hookPath, hook);
  return { hookPath, tracePath };
}

function runWriter(args: string[], hookPath: string, database: string): void {
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
  const nodeOptions = [existingNodeOptions, `--require=${hookPath}`].filter(Boolean).join(" ");
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: database, NODE_OPTIONS: nodeOptions },
  });
  assert.equal(result.status, 0, `leg 1 writer failed:\n${result.stdout}\n${result.stderr}`);
}

async function behaviouralAndFilesystemLeg(prisma: PrismaClient, database: string): Promise<void> {
  const communityFiles = fs.readdirSync(COMMUNITY_DIR).filter((name) => name.endsWith(".json"));
  assert.ok(communityFiles.length > 0, "leg 1 requires a populated community-source directory");

  await prisma.sourceDemotionEvent.deleteMany();
  await prisma.source.deleteMany();
  await prisma.candidateAccount.deleteMany();
  await prisma.run.deleteMany();
  await prisma.candidateAccount.create({
    data: { handle: "ManualSource", status: "approved", mentionCount: 1 },
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "community-source-test-"));
  try {
    const { hookPath, tracePath } = createTraceHook(tempDir);
    runWriter(["-r", "ts-node/register", "src/scripts/import-x-handles.ts"], hookPath, database);
    runWriter(["-r", "ts-node/register", "src/seed.ts"], hookPath, database);
    runWriter(["-r", "ts-node/register", "src/collector/discover.ts", "promote"], hookPath, database);
    runWriter([
      "-r", "ts-node/register", "-e",
      "require('./src/collector/index').collect().then(() => process.exit(0)).catch(() => process.exit(1))",
    ], hookPath, database);

    const actual = (await prisma.source.findMany({ select: { handle: true }, orderBy: { handle: "asc" } }))
      .map((row) => row.handle)
      .sort((a, b) => a.localeCompare(b));
    const nonCommunity = JSON.parse(fs.readFileSync(X_HANDLES_PATH, "utf8")) as Array<{ handle: string }>;
    const expected = [...new Set([...nonCommunity.map((entry) => entry.handle), "ManualSource"])]
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(actual, expected, "leg 1: Source rows must equal the set from non-community inputs");

    const opened = fs.readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as string)
      .map((filePath) => path.resolve(filePath));
    for (const openedPath of opened) {
      assert.ok(!openedPath.includes(`${path.sep}community-sources${path.sep}`), `leg 3: read community source path ${openedPath}`);
      const dataPrefix = `${path.resolve(REPO_ROOT, "data")}${path.sep}`;
      if (openedPath.startsWith(dataPrefix)) {
        assert.equal(openedPath, X_HANDLES_PATH, `leg 3: unexpected data read ${openedPath}`);
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function importGraphLeg(): void {
  const configPath = path.join(REPO_ROOT, "tsconfig.collector.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.ok(!configFile.error, "leg 2: could not read tsconfig.collector.json");
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO_ROOT, undefined, configPath);
  assert.equal(parsed.errors.length, 0, "leg 2: tsconfig.collector.json contains errors");
  const appConfigPath = path.join(REPO_ROOT, "tsconfig.json");
  const appConfigFile = ts.readConfigFile(appConfigPath, ts.sys.readFile);
  assert.ok(!appConfigFile.error, "leg 2: could not read tsconfig.json for app path resolution");
  const appParsed = ts.parseJsonConfigFileContent(appConfigFile.config, ts.sys, REPO_ROOT, undefined, appConfigPath);

  const appRoots = walkSourceFiles(path.join(SRC_ROOT, "app"));
  // Runtime roots come only from the collector build configuration plus the Next app. `src/scripts`
  // is deliberately a tooling boundary, not a runtime root; making it a root would make the target
  // community validator reachable by definition and would destroy the assertion this leg exists for.
  const roots = [...new Set([...parsed.fileNames, ...appRoots])];
  const program = ts.createProgram({ rootNames: roots, options: { ...appParsed.options, ...parsed.options } });
  const reachable = program.getSourceFiles()
    .filter((source) => !source.isDeclarationFile && source.fileName.startsWith(`${SRC_ROOT}${path.sep}`))
    .map((source) => path.resolve(source.fileName));
  assert.ok(
    reachable.every((filePath) => !filePath.startsWith(`${path.join(SRC_ROOT, "scripts", "community")}${path.sep}`)),
    "leg 2: runtime/import roots reach src/scripts/community",
  );

  const coveredTopLevels = new Set(reachable.map((filePath) => path.relative(SRC_ROOT, filePath).split(path.sep)[0]));
  const actualTopLevels = fs.readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const directory of actualTopLevels) {
    if (directory === "scripts") {
      assert.ok(fs.existsSync(path.join(SRC_ROOT, "scripts", "community")), "leg 2: tooling boundary is missing");
      continue;
    }
    assert.ok(coveredTopLevels.has(directory), `leg 2: top-level src directory is missing from the derived root graph: ${directory}`);
  }
}

function scriptSnapshotLeg(): void {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const actual = Object.fromEntries(Object.entries(packageJson.scripts ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const expected = Object.fromEntries(Object.entries(EXPECTED_SCRIPTS).sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(actual, expected, "leg 4: package.json script name→value map changed");
}

function databaseWriterLeg(): void {
  const writes: Record<string, string[]> = {};
  const callPattern = /\.(source|alertSource)\.(create|upsert|createMany|update|updateMany|delete|deleteMany)\s*\(/g;
  for (const filePath of walkSourceFiles(SRC_ROOT)) {
    if (filePath === __filename) continue;
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(callPattern)) {
      (writes[relative(filePath)] ??= []).push(`${match[1]}.${match[2]}`);
    }
  }
  for (const values of Object.values(writes)) values.sort();
  assert.deepEqual(writes, EXPECTED_DB_WRITES, "leg 5: Source/AlertSource write call-site allow-list changed");
}

async function main(): Promise<void> {
  const database = databaseUrl();
  const prisma = new PrismaClient();
  try {
    await behaviouralAndFilesystemLeg(prisma, database);
    console.log("PASS leg 1: behavioural Source set-equality");
    console.log("PASS leg 3: opened-path filesystem trace");
    importGraphLeg();
    console.log("PASS leg 2: derived import graph and root completeness");
    scriptSnapshotLeg();
    console.log("PASS leg 4: package script name→value snapshot");
    databaseWriterLeg();
    console.log("PASS leg 5: DB-writer call-site allow-list");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
