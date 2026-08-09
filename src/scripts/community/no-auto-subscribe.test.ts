/**
 * Community sources are discoverable data, never subscription input.
 *
 * The static legs are the load-bearing tripwire: every Prisma write in the repository is snapshotted,
 * and every approved writer plus its import closure is checked for resolvable data reads. A literal-
 * string tripwire adds defence in depth for straightforward opaque-channel acquisition. The
 * behavioural legs are best-effort convenience checks; computed or otherwise opaque acquisition is
 * structurally indistinguishable from the collector's legitimate network discovery.
 */
import assert from "assert/strict";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { HANDLE_RE } from "../x-handle";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const DATA_ROOT = path.join(REPO_ROOT, "data");
const COMMUNITY_DIR = path.join(DATA_ROOT, "community-sources");
const X_HANDLES_PATH = path.join(DATA_ROOT, "x-handles.json");
const PRISMA_SCHEMA_PATH = path.join(REPO_ROOT, "prisma/schema.prisma");
const SENTINEL_IDENTIFIER = "ZZSentinelSrc";
const PROMOTED_IDENTIFIER = "ManualSource";
const SENTINEL_KEY = SENTINEL_IDENTIFIER.toLowerCase();
const SENTINEL_FILENAME = `x--${SENTINEL_KEY}.json`;
const REPOSITORY_SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|mjs|cjs)$/;
const EXCLUDED_REPOSITORY_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".next"]);
const COMMUNITY_SOURCE_LITERAL = "community-sources";

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
  "src/app/api/alert-fetch/route.ts": ["alertEntry.upsert", "alertSource.update"],
  "src/app/api/alert-sources/route.ts": ["alertSource.create", "alertSource.delete", "alertSource.update"],
  "src/app/api/candidates/route.ts": ["candidateAccount.update"],
  "src/app/api/fb-sources/route.ts": ["fbSource.create", "fbSource.delete", "fbSource.update"],
  "src/app/api/gh-sources/route.ts": ["ghSource.create", "ghSource.delete", "ghSource.update"],
  "src/app/api/ig-sources/route.ts": ["igPost.deleteMany", "igSource.create", "igSource.delete", "igSource.update"],
  "src/app/api/qiita-sources/route.ts": ["qiitaSource.create", "qiitaSource.delete", "qiitaSource.update"],
  "src/app/api/reddit-sources/route.ts": ["redditSource.create", "redditSource.delete", "redditSource.update"],
  "src/app/api/sources/route.ts": ["source.create", "source.delete", "source.update"],
  "src/collector/alerts.ts": ["alertEntry.upsert", "alertSource.update", "run.create", "run.update"],
  "src/collector/discover.ts": [
    "candidateAccount.create",
    "candidateAccount.update",
    "candidateAccount.update",
    "candidateAccount.update",
    "candidateAccount.update",
    "source.create",
  ],
  "src/collector/evaluate-candidates.ts": ["candidateAccount.update", "candidateAccount.update"],
  "src/collector/facebook.ts": ["fbPost.upsert", "fbSource.update", "run.create", "run.update"],
  "src/collector/github.ts": ["ghItem.upsert", "ghItem.upsert", "ghSource.update", "run.create", "run.update"],
  "src/collector/index.ts": ["run.create", "run.update", "tweet.upsert"],
  "src/collector/instagram.ts": ["igPost.upsert", "igSource.update", "run.create", "run.update"],
  "src/collector/lifecycle.ts": [
    "source.update",
    "source.updateMany",
    "sourceDemotionEvent.create",
    "sourceDemotionEvent.create",
  ],
  "src/collector/openrouter.ts": [
    "orModel.create",
    "orModel.update",
    "orModel.update",
    "orModelEvent.create",
    "orModelEvent.create",
    "orModelEvent.create",
    "orModelEvent.create",
    "run.create",
    "run.update",
    "run.update",
  ],
  "src/collector/pipeline-backfill-ja.ts": ["pipelineClassification.update"],
  "src/collector/pipeline-retention.ts": [
    "alertEntry.deleteMany",
    "fbPost.deleteMany",
    "ghItem.deleteMany",
    "igPost.deleteMany",
    "orModelEvent.deleteMany",
    "pipelineCrosslinkLlmDecision.deleteMany",
    "pipelineItem.deleteMany",
    "pipelineRun.deleteMany",
    "qiitaItem.deleteMany",
    "redditPost.deleteMany",
    "tweet.deleteMany",
    "voiceSignal.deleteMany",
  ],
  "src/collector/qiita.ts": ["qiitaItem.upsert", "qiitaSource.update", "run.create", "run.update"],
  "src/collector/reddit.ts": ["redditPost.upsert", "redditSource.update", "run.create", "run.update"],
  "src/collector/run-prod-collect-cycle.ts": ["run.updateMany"],
  "src/collector/source-score.ts": ["source.update"],
  "src/lib/pipeline/classify-llm.ts": [
    "pipelineClassification.create",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/classify.ts": [
    "pipelineClassification.create",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/compose-edition-script.ts": [
    "newsletterEdition.update",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/compose-edition.ts": [
    "newsletterEdition.update",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/crosslink-llm.ts": [
    "pipelineClassification.update",
    "pipelineCrosslinkLlmDecision.upsert",
    "pipelineLink.deleteMany",
    "pipelineLink.upsert",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/crosslink.ts": [
    "pipelineClassification.update",
    "pipelineLink.deleteMany",
    "pipelineLink.upsert",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
  ],
  "src/lib/pipeline/enrich-links.ts": ["pipelineItem.update"],
  "src/lib/pipeline/enrich-youtube-transcript.ts": ["pipelineItem.update"],
  "src/lib/pipeline/normalize.ts": ["pipelineItem.create", "pipelineItem.update"],
  "src/lib/pipeline/publish.ts": [
    "newsletterBinding.upsert",
    "newsletterEdition.create",
    "pipelineClassification.update",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
    "voiceSignal.updateMany",
  ],
  "src/lib/pipeline/voicesignal.ts": [
    "newsletterEdition.create",
    "pipelineRun.create",
    "pipelineRun.update",
    "pipelineRun.update",
    "voiceSignal.create",
    "voiceSignal.update",
  ],
  "src/scripts/import-x-handles.ts": ["source.upsert"],
  "src/seed.ts": [
    "fbSource.upsert",
    "ghSource.create",
    "ghSource.create",
    "ghSource.update",
    "ghSource.update",
    "qiitaSource.upsert",
    "redditSource.upsert",
    "source.upsert",
  ],
};

const EXPECTED_RAW_SQL_CALLS: Record<string, string[]> = {
  "src/app/api/family-feed/route.ts": ["$queryRaw"],
  "src/collector/discover.ts": ["$queryRaw"],
  "src/collector/source-score.ts": ["$queryRaw"],
  "src/lib/pipeline/topic-cluster.ts": ["$executeRaw", "$queryRaw"],
};
const PRISMA_MODELS = prismaDelegatesFromSchema();
const PRISMA_WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);
const PRISMA_RAW_METHODS = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);
const WRITER_COMMANDS = [
  {
    label: "import-x-handles",
    args: ["-r", "ts-node/register", "src/scripts/import-x-handles.ts"],
  },
  {
    label: "seed",
    args: ["-r", "ts-node/register", "src/seed.ts"],
  },
  {
    label: "discover-promote",
    args: ["-r", "ts-node/register", "src/collector/discover.ts", "promote"],
  },
  {
    label: "collector",
    args: [
      "-r",
      "ts-node/register",
      "-e",
      "require('./src/collector/index').collect().then(() => process.exit(0)).catch(() => process.exit(1))",
    ],
  },
] as const;

type TraceEvent =
  | {
      kind: "path";
      method: string;
      value: string;
    }
  | {
      kind: "child_process";
      method: string;
    };

type DelegateModel = string;

type PrismaAnalysis = {
  writes: string[];
  rawSql: string[];
  unresolvedDelegateAccesses: string[];
};

type Scope = {
  clients: Set<string>;
  delegates: Map<string, DelegateModel>;
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

function readTsConfig(relativePath: string, legLabel: string): ts.ParsedCommandLine {
  const configPath = path.join(REPO_ROOT, relativePath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.ok(!configFile.error, `${legLabel}: could not read ${relativePath}`);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO_ROOT, undefined, configPath);
  assert.equal(parsed.errors.length, 0, `${legLabel}: ${relativePath} contains errors`);
  return parsed;
}

function prismaDelegatesFromSchema(): Set<string> {
  const schema = fs.readFileSync(PRISMA_SCHEMA_PATH, "utf8");
  const delegates = new Set<string>();
  for (const match of schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)) {
    const model = match[1];
    delegates.add(`${model[0].toLowerCase()}${model.slice(1)}`);
  }
  assert.ok(delegates.size > 0, "leg 5: Prisma schema contains no models");
  return delegates;
}

function walkSourceFiles(directory: string, wholeRepository = false): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && wholeRepository && EXCLUDED_REPOSITORY_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkSourceFiles(absolute, wholeRepository));
    else if ((wholeRepository ? REPOSITORY_SOURCE_EXTENSIONS : /\.(?:ts|tsx)$/).test(entry.name)) found.push(absolute);
  }
  return found;
}

function relative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function assertFixtureIdentifiersAreValid(): void {
  for (const [label, identifier] of [
    ["sentinel", SENTINEL_IDENTIFIER],
    ["promoted candidate", PROMOTED_IDENTIFIER],
  ] as const) {
    assert.ok(HANDLE_RE.test(identifier), `startup: ${label} fixture identifier must satisfy HANDLE_RE: ${identifier}`);
  }
}

function communityIdentifiers(communityDir: string): string[] {
  return fs.readdirSync(communityDir)
    .filter((name) => /^x--.+\.json$/i.test(name))
    .map((name) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(communityDir, name), "utf8")) as { identifier?: unknown };
      assert.ok(typeof parsed.identifier === "string", `leg 1: fixture entry ${name} has no string identifier`);
      return parsed.identifier.toLowerCase();
    })
    .sort((left, right) => left.localeCompare(right));
}

function xHandleIdentifiers(xHandlesPath: string): string[] {
  const handles = JSON.parse(fs.readFileSync(xHandlesPath, "utf8")) as Array<{ handle: string }>;
  return handles
    .map((entry) => entry.handle.trim().replace(/^@/, "").toLowerCase())
    .sort((left, right) => left.localeCompare(right));
}

function createRepositoryFixtureCopy(): { repoRoot: string; cleanup: () => void } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "community-source-fixture-"));
  try {
    for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const source = path.join(REPO_ROOT, entry.name);
      const destination = path.join(repoRoot, entry.name);
      if (entry.name === "node_modules") {
        fs.symlinkSync(source, destination, "dir");
        continue;
      }
      fs.cpSync(source, destination, { recursive: true });
    }

    const sentinelPath = path.join(repoRoot, "data/community-sources", SENTINEL_FILENAME);
    fs.writeFileSync(
      sentinelPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          platform: "x",
          identifier: SENTINEL_IDENTIFIER,
          topic: "Synthetic discriminating fixture entry",
          language: "en",
          submitted_by: "test-suite",
          first_seen: "2026-08-09",
        },
        null,
        2,
      )}\n`,
    );

    return {
      repoRoot,
      cleanup: () => fs.rmSync(repoRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    throw error;
  }
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
let recording = false;
function record(event) {
  if (recording) return;
  try {
    recording = true;
    append(trace, JSON.stringify(event) + "\\n");
  } catch {} finally {
    recording = false;
  }
}
function normalizePath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return String(value);
}
function wrapPathMethod(target, name, pathIndexes = [0]) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function(...args) {
    for (const index of pathIndexes) {
      if (index < args.length) record({ kind: "path", method: name, value: normalizePath(args[index]) });
    }
    return original.apply(this, args);
  };
}
function wrapChildProcessModule(moduleName) {
  try {
    const childProcess = require(moduleName);
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      const original = childProcess[name];
      if (typeof original !== "function") continue;
      childProcess[name] = function(...args) {
        record({ kind: "child_process", method: name });
        return original.apply(this, args);
      };
    }
  } catch {}
}
for (const name of [
  "readFileSync", "readFile", "createReadStream", "openSync", "open", "readdirSync", "readdir",
  "opendirSync", "opendir", "writeFileSync", "writeFile", "realpathSync", "realpath",
]) {
  wrapPathMethod(fs, name);
}
for (const name of ["copyFileSync", "copyFile"]) {
  wrapPathMethod(fs, name, [0, 1]);
}
for (const name of ["readFile", "open", "readdir", "opendir", "writeFile", "realpath"]) {
  wrapPathMethod(fs.promises, name);
}
wrapPathMethod(fs.promises, "copyFile", [0, 1]);
wrapChildProcessModule("child_process");
wrapChildProcessModule("node:child_process");
const originalJson = Module._extensions[".json"];
Module._extensions[".json"] = function(module, filename) {
  record({ kind: "path", method: "json-extension", value: filename });
  return originalJson(module, filename);
};
`;
  fs.writeFileSync(hookPath, hook);
  return { hookPath, tracePath };
}

function runWriter(repoRoot: string, label: string, args: string[], hookPath: string, database: string): void {
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
  const nodeOptions = [existingNodeOptions, `--require=${hookPath}`].filter(Boolean).join(" ");
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: database, NODE_OPTIONS: nodeOptions },
  });
  assert.equal(result.status, 0, `leg 1: writer ${label} failed:\n${result.stdout}\n${result.stderr}`);
}

function normalizeTracePath(repoRoot: string, value: string): string {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(repoRoot, value));
}

function parseTraceEvents(tracePath: string, repoRoot: string): TraceEvent[] {
  if (!fs.existsSync(tracePath)) return [];
  const lines = fs.readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const event = JSON.parse(line) as TraceEvent;
    if (event.kind === "path") {
      return { ...event, value: normalizeTracePath(repoRoot, event.value) };
    }
    return event;
  });
}

async function behaviouralAndFilesystemLeg(prisma: PrismaClient, database: string): Promise<void> {
  const fixture = createRepositoryFixtureCopy();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "community-source-test-"));
  try {
    const fixtureCommunityDir = path.join(fixture.repoRoot, "data/community-sources");
    const fixtureXHandlesPath = path.join(fixture.repoRoot, "data/x-handles.json");
    const fixtureCommunityIds = communityIdentifiers(fixtureCommunityDir);
    const originalXHandles = fs.readFileSync(fixtureXHandlesPath);
    const fixtureXHandleIds = new Set(xHandleIdentifiers(fixtureXHandlesPath));
    const nonCommunity = JSON.parse(originalXHandles.toString("utf8")) as Array<{ handle: string }>;
    const expected = [...new Set([...nonCommunity.map((entry) => entry.handle), PROMOTED_IDENTIFIER])]
      .sort((left, right) => left.localeCompare(right));

    assert.ok(fixtureCommunityIds.length > 0, "leg 1: fixture requires a populated community-source directory");
    assert.ok(
      fixtureCommunityIds.some((identifier) => !fixtureXHandleIds.has(identifier)),
      "leg 1: fixture has no discriminating power: community identifiers are a subset of data/x-handles identifiers",
    );
    assert.ok(
      fixtureCommunityIds.includes(SENTINEL_KEY),
      "leg 1: discriminating sentinel is missing from the temporary fixture",
    );

    await prisma.sourceDemotionEvent.deleteMany();
    await prisma.source.deleteMany();
    await prisma.candidateAccount.deleteMany();
    await prisma.run.deleteMany();
    await prisma.candidateAccount.create({
      data: { handle: PROMOTED_IDENTIFIER, status: "approved", mentionCount: 1 },
    });

    const { hookPath, tracePath } = createTraceHook(tempDir);
    for (const writer of WRITER_COMMANDS) {
      runWriter(fixture.repoRoot, writer.label, [...writer.args], hookPath, database);
    }

    assert.deepEqual(
      fs.readFileSync(fixtureXHandlesPath),
      originalXHandles,
      "leg 1: data/x-handles.json changed while automatic writers ran",
    );

    const actual = (await prisma.source.findMany({ select: { handle: true }, orderBy: { handle: "asc" } }))
      .map((row) => row.handle)
      .sort((left, right) => left.localeCompare(right));
    assert.deepEqual(
      actual,
      expected,
      "leg 1: Source rows must equal the set from non-community inputs; the sentinel must never appear",
    );
    assert.ok(
      actual.every((handle) => handle.toLowerCase() !== SENTINEL_KEY),
      "leg 1: synthetic sentinel reached the Source table",
    );

    const events = parseTraceEvents(tracePath, fixture.repoRoot);
    for (const event of events) {
      if (event.kind === "child_process") {
        assert.fail(`leg 3: writer spawned a child process via ${event.method}`);
      }

      assert.ok(
        !event.value.includes(`${path.sep}community-sources${path.sep}`),
        `leg 3: read community source path via ${event.method}: ${event.value}`,
      );

      const dataPrefix = `${path.join(fixture.repoRoot, "data")}${path.sep}`;
      if (event.value.startsWith(dataPrefix)) {
        assert.equal(
          event.value,
          path.join(fixture.repoRoot, "data", "x-handles.json"),
          `leg 3: unexpected data read via ${event.method}: ${event.value}`,
        );
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fixture.cleanup();
  }
}

function importGraphLeg(): void {
  const collectorParsed = readTsConfig("tsconfig.collector.json", "leg 2");
  const appParsed = readTsConfig("tsconfig.json", "leg 2");
  const appRoots = walkSourceFiles(path.join(SRC_ROOT, "app"));

  // Runtime roots come only from the collector build configuration plus the Next app. `src/scripts`
  // is deliberately a tooling boundary, not a runtime root; making it a root would make the target
  // community validator reachable by definition and would destroy the assertion this leg exists for.
  const roots = [...new Set([...collectorParsed.fileNames, ...appRoots])];
  const program = ts.createProgram({ rootNames: roots, options: { ...appParsed.options, ...collectorParsed.options } });
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
  const actual = Object.fromEntries(Object.entries(packageJson.scripts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const expected = Object.fromEntries(Object.entries(EXPECTED_SCRIPTS).sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(actual, expected, "leg 4: package.json script name→value map changed");
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function cloneScope(scope: Scope): Scope {
  return {
    clients: new Set(scope.clients),
    delegates: new Map(scope.delegates),
  };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function propertyNameText(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}

function receiverExpression(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): ts.Expression {
  return node.expression;
}

function bindingIdentifier(name: ts.BindingName): string | null {
  return ts.isIdentifier(name) ? name.text : null;
}

function isPrismaClientConstruction(expression: ts.Expression): boolean {
  const candidate = unwrapExpression(expression);
  return ts.isNewExpression(candidate) && ts.isIdentifier(candidate.expression) && candidate.expression.text === "PrismaClient";
}

function isClientExpression(expression: ts.Expression, scope: Scope): boolean {
  const candidate = unwrapExpression(expression);
  return ts.isIdentifier(candidate) ? scope.clients.has(candidate.text) : isPrismaClientConstruction(candidate);
}

function resolveDelegateExpression(expression: ts.Expression, scope: Scope): DelegateModel | null {
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) {
    return scope.delegates.get(candidate.text) ?? null;
  }
  if (ts.isCallExpression(candidate)) {
    const callee = unwrapExpression(candidate.expression);
    if (
      ts.isPropertyAccessExpression(callee)
      && ts.isIdentifier(callee.expression)
      && callee.expression.text === "Reflect"
      && callee.name.text === "get"
      && candidate.arguments.length >= 2
      && isClientExpression(candidate.arguments[0], scope)
      && ts.isStringLiteralLike(candidate.arguments[1])
      && PRISMA_MODELS.has(candidate.arguments[1].text)
    ) {
      return candidate.arguments[1].text;
    }
  }
  if (!ts.isPropertyAccessExpression(candidate) && !ts.isElementAccessExpression(candidate)) {
    return null;
  }
  const propertyName = propertyNameText(candidate);
  if (!propertyName || !PRISMA_MODELS.has(propertyName)) {
    return null;
  }
  return isClientExpression(receiverExpression(candidate), scope) ? (propertyName as DelegateModel) : null;
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  const functionLike = node as ts.FunctionLikeDeclaration;
  return ts.isFunctionLike(node) && functionLike.body !== undefined;
}

function isTransactionCallback(node: ts.FunctionLikeDeclaration): boolean {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  const callee = unwrapExpression(parent.expression);
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return false;
  return propertyNameText(callee) === "$transaction";
}

function parameterIsPrismaClient(parameter: ts.ParameterDeclaration): boolean {
  if (ts.isIdentifier(parameter.name) && (parameter.name.text === "prisma" || parameter.name.text === "tx")) {
    return true;
  }
  const type = parameter.type;
  if (!type) return false;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeName.text === "PrismaClient";
  }
  return ts.isTypeReferenceNode(type)
    && ts.isQualifiedName(type.typeName)
    && ts.isIdentifier(type.typeName.left)
    && type.typeName.left.text === "Prisma"
    && type.typeName.right.text === "TransactionClient";
}

function trackAssignmentAlias(node: ts.Expression, scope: Scope): void {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(node.left)) {
    return;
  }
  const delegate = resolveDelegateExpression(node.right, scope);
  if (delegate) {
    scope.delegates.set(node.left.text, delegate);
    return;
  }
  if (isClientExpression(node.right, scope)) {
    scope.clients.add(node.left.text);
  }
}

function trackVariableAlias(node: ts.VariableDeclaration, scope: Scope): void {
  if (!node.initializer) return;
  if (ts.isObjectBindingPattern(node.name) && isClientExpression(node.initializer, scope)) {
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propertyName = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        ? element.propertyName.text
        : element.name.text;
      if (PRISMA_MODELS.has(propertyName)) scope.delegates.set(element.name.text, propertyName);
    }
    return;
  }
  const name = bindingIdentifier(node.name);
  if (!name) return;
  const delegate = resolveDelegateExpression(node.initializer, scope);
  if (delegate) {
    scope.delegates.set(name, delegate);
    return;
  }
  if (isClientExpression(node.initializer, scope)) {
    scope.clients.add(name);
  }
}

function trackPrismaCall(node: ts.CallExpression, scope: Scope, analysis: PrismaAnalysis): void {
  const callee = unwrapExpression(node.expression);
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) {
    return;
  }

  const methodName = propertyNameText(callee);
  if (!methodName) return;
  const receiver = receiverExpression(callee);

  if (PRISMA_WRITE_METHODS.has(methodName)) {
    const delegate = resolveDelegateExpression(receiver, scope);
    if (delegate) {
      analysis.writes.push(`${delegate}.${methodName}`);
    }
    return;
  }

  if (PRISMA_RAW_METHODS.has(methodName) && isClientExpression(receiver, scope)) {
    analysis.rawSql.push(methodName);
  }
}

function trackUnresolvedComputedDelegate(node: ts.Node, scope: Scope, analysis: PrismaAnalysis): void {
  if (ts.isElementAccessExpression(node) && isClientExpression(node.expression, scope)) {
    if (!ts.isStringLiteralLike(node.argumentExpression)) {
      analysis.unresolvedDelegateAccesses.push(`computed Prisma property at ${node.getStart()}`);
    }
    return;
  }
  if (!ts.isCallExpression(node)) return;
  const callee = unwrapExpression(node.expression);
  if (
    ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === "Reflect"
    && callee.name.text === "get"
    && node.arguments.length >= 2
    && isClientExpression(node.arguments[0], scope)
    && !ts.isStringLiteralLike(node.arguments[1])
  ) {
    analysis.unresolvedDelegateAccesses.push(`computed Reflect.get Prisma property at ${node.getStart()}`);
  }
}

function trackPrismaRawTag(node: ts.TaggedTemplateExpression, scope: Scope, analysis: PrismaAnalysis): void {
  const tag = unwrapExpression(node.tag);
  if (!ts.isPropertyAccessExpression(tag) && !ts.isElementAccessExpression(tag)) return;
  const methodName = propertyNameText(tag);
  if (methodName && PRISMA_RAW_METHODS.has(methodName) && isClientExpression(receiverExpression(tag), scope)) {
    analysis.rawSql.push(methodName);
  }
}

function analyzePrismaFile(filePath: string): PrismaAnalysis {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const analysis: PrismaAnalysis = { writes: [], rawSql: [], unresolvedDelegateAccesses: [] };

  const visit = (node: ts.Node, scope: Scope): void => {
    if (isFunctionLikeWithBody(node)) {
      const childScope = cloneScope(scope);
      const transactionCallback = isTransactionCallback(node);
      for (const parameter of node.parameters) {
        if (!transactionCallback && !parameterIsPrismaClient(parameter)) continue;
        const identifier = bindingIdentifier(parameter.name);
        if (identifier) childScope.clients.add(identifier);
      }
      if (node.body) visit(node.body, childScope);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      trackVariableAlias(node, scope);
    } else if (ts.isExpressionStatement(node)) {
      trackAssignmentAlias(node.expression, scope);
    } else if (ts.isCallExpression(node)) {
      trackPrismaCall(node, scope, analysis);
    } else if (ts.isTaggedTemplateExpression(node)) {
      trackPrismaRawTag(node, scope, analysis);
    }
    trackUnresolvedComputedDelegate(node, scope, analysis);

    ts.forEachChild(node, (child) => visit(child, scope));
  };

  visit(sourceFile, { clients: new Set(), delegates: new Map() });
  analysis.writes.sort();
  analysis.rawSql.sort();
  analysis.unresolvedDelegateAccesses.sort();
  return analysis;
}

const FS_PATH_ARGUMENTS: Record<string, number[]> = {
  access: [0], accessSync: [0], appendFile: [0], appendFileSync: [0], chmod: [0], chmodSync: [0],
  chown: [0], chownSync: [0], copyFile: [0, 1], copyFileSync: [0, 1], cp: [0, 1], cpSync: [0, 1],
  createReadStream: [0], createWriteStream: [0], exists: [0], existsSync: [0], lstat: [0], lstatSync: [0],
  mkdir: [0], mkdirSync: [0], mkdtemp: [0], mkdtempSync: [0], open: [0], openSync: [0], opendir: [0],
  opendirSync: [0], readFile: [0], readFileSync: [0], readdir: [0], readdirSync: [0], readlink: [0],
  readlinkSync: [0], realpath: [0], realpathSync: [0], rename: [0, 1], renameSync: [0, 1], rm: [0],
  rmSync: [0], rmdir: [0], rmdirSync: [0], stat: [0], statSync: [0], symlink: [0, 1], symlinkSync: [0, 1],
  truncate: [0], truncateSync: [0], unlink: [0], unlinkSync: [0], utimes: [0], utimesSync: [0],
  watch: [0], watchFile: [0], writeFile: [0], writeFileSync: [0],
};

const SAFE_COMPUTED_FS_READS: Record<string, Record<string, string>> = {
  // The default path is `docs/prompts/step1-3`; these four established prompt reads predate this
  // guard and are reviewed as outside data/. Keep this exact so it cannot become a general bypass.
  "src/lib/pipeline/classify-llm.ts": {
    sharedPath: "final-shared-common.md",
    groupAPath: "group-a-short-social.md",
    groupBPath: "group-b-longform.md",
    groupCPath: "group-c-repo.md",
  },
};

type StaticPathContext = {
  sourceFile: ts.SourceFile;
  constants: Map<string, ts.Expression>;
};

function collectConstantInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

function evaluateStaticPaths(
  expression: ts.Expression,
  context: StaticPathContext,
  seen = new Set<string>(),
): string[] | null {
  const candidate = unwrapExpression(expression);
  if (ts.isStringLiteralLike(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) return [candidate.text];
  if (ts.isIdentifier(candidate)) {
    if (candidate.text === "__dirname") return [path.dirname(context.sourceFile.fileName)];
    if (candidate.text === "__filename") return [context.sourceFile.fileName];
    if (seen.has(candidate.text)) return null;
    const initializer = context.constants.get(candidate.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(candidate.text);
    return evaluateStaticPaths(initializer, context, nextSeen);
  }
  if (
    ts.isBinaryExpression(candidate)
    && candidate.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evaluateStaticPaths(candidate.left, context, seen);
    const right = evaluateStaticPaths(candidate.right, context, seen);
    if (!left || !right) return null;
    return left.flatMap((leftValue) => right.map((rightValue) => leftValue + rightValue));
  }
  if (ts.isConditionalExpression(candidate)) {
    const whenTrue = evaluateStaticPaths(candidate.whenTrue, context, seen);
    const whenFalse = evaluateStaticPaths(candidate.whenFalse, context, seen);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  if (!ts.isCallExpression(candidate)) return null;
  const callee = unwrapExpression(candidate.expression);
  if (
    ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === "process"
    && callee.name.text === "cwd"
    && candidate.arguments.length === 0
  ) {
    return [REPO_ROOT];
  }
  if (
    ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === "path"
    && (callee.name.text === "join" || callee.name.text === "resolve")
  ) {
    const parts = candidate.arguments.map((argument) => evaluateStaticPaths(argument, context, seen));
    if (parts.some((part) => part === null)) return null;
    let combinations = [""];
    for (const part of parts as string[][]) {
      combinations = combinations.flatMap((prefix) => part.map((value) => {
        if (prefix === "") return value;
        return callee.name.text === "resolve" ? path.resolve(prefix, value) : path.join(prefix, value);
      }));
    }
    return combinations;
  }
  return null;
}

function resolvedRepositoryPath(sourceFile: ts.SourceFile, value: string, moduleSpecifier: boolean): string | null {
  if (moduleSpecifier && !value.startsWith(".") && !path.isAbsolute(value) && !/^data(?:[/\\]|$)/.test(value)) {
    return null;
  }
  if (path.isAbsolute(value)) return path.normalize(value);
  if (value.startsWith(".")) return path.resolve(path.dirname(sourceFile.fileName), value);
  return path.resolve(REPO_ROOT, value);
}

function pathIsUnderData(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  return normalized === DATA_ROOT || normalized.startsWith(`${DATA_ROOT}${path.sep}`);
}

function isOnlyAllowedDataRead(sourceFile: ts.SourceFile, filePath: string): boolean {
  return relative(sourceFile.fileName) === "src/scripts/import-x-handles.ts"
    && path.resolve(filePath) === X_HANDLES_PATH;
}

function isVerifiedSafeComputedFsRead(
  relativeFile: string,
  argument: ts.Expression,
  context: StaticPathContext,
): boolean {
  if (!ts.isIdentifier(argument)) return false;
  const expectedFilename = SAFE_COMPUTED_FS_READS[relativeFile]?.[argument.text];
  if (!expectedFilename) return false;
  const pathInitializer = context.constants.get(argument.text);
  const baseInitializer = context.constants.get("base");
  if (!pathInitializer || !baseInitializer) return false;
  const compact = (expression: ts.Expression): string => expression.getText(context.sourceFile).replace(/\s+/g, "");
  return compact(pathInitializer) === `path.join(base,"${expectedFilename}")`
    && compact(baseInitializer) === "promptDir||path.join(process.cwd(),\"docs\",\"prompts\",\"step1-3\")";
}

function staticDataReadOffenders(sourceFile: ts.SourceFile): string[] {
  const context: StaticPathContext = { sourceFile, constants: collectConstantInitializers(sourceFile) };
  const fsNamespaces = new Set<string>();
  const fsFunctions = new Map<string, string>();
  const offenders: string[] = [];
  const relativeFile = relative(sourceFile.fileName);

  const moduleName = (expression: ts.Expression): string | null => {
    const values = evaluateStaticPaths(expression, context);
    return values?.length === 1 ? values[0] : null;
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text.replace(/^node:/, "");
      if (specifier !== "fs" && specifier !== "fs/promises") continue;
      const clause = statement.importClause;
      if (clause?.name) fsNamespaces.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) fsNamespaces.add(clause.namedBindings.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "promises") fsNamespaces.add(element.name.text);
          else fsFunctions.set(element.name.text, imported);
        }
      }
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      const call = declaration.initializer;
      if (!ts.isIdentifier(call.expression) || call.expression.text !== "require" || call.arguments.length !== 1) continue;
      const specifier = moduleName(call.arguments[0])?.replace(/^node:/, "");
      if (specifier !== "fs" && specifier !== "fs/promises") continue;
      if (ts.isIdentifier(declaration.name)) fsNamespaces.add(declaration.name.text);
      if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const imported = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
            ? element.propertyName.text
            : element.name.text;
          fsFunctions.set(element.name.text, imported);
        }
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (
        ts.isPropertyAccessExpression(initializer)
        && initializer.name.text === "promises"
        && ts.isCallExpression(initializer.expression)
        && ts.isIdentifier(initializer.expression.expression)
        && initializer.expression.expression.text === "require"
        && initializer.expression.arguments.length === 1
      ) {
        const specifier = moduleName(initializer.expression.arguments[0])?.replace(/^node:/, "");
        if (specifier === "fs") fsNamespaces.add(declaration.name.text);
      }
    }
  }

  const inspectArgument = (
    node: ts.CallExpression,
    method: string,
    argumentIndex: number,
    moduleSpecifier = false,
  ): void => {
    const argument = node.arguments[argumentIndex];
    if (!argument) return;
    const values = evaluateStaticPaths(argument, context);
    if (!values) {
      if (!moduleSpecifier && isVerifiedSafeComputedFsRead(relativeFile, argument, context)) return;
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      offenders.push(`${relativeFile}:${position.line + 1} ${method} has a non-literal path`);
      return;
    }
    for (const value of values) {
      const resolved = resolvedRepositoryPath(sourceFile, value, moduleSpecifier);
      if (resolved && pathIsUnderData(resolved) && !isOnlyAllowedDataRead(sourceFile, resolved)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        offenders.push(`${relativeFile}:${position.line + 1} ${method} reads ${relative(resolved)}`);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      let fsMethod: string | null = null;
      if (ts.isIdentifier(callee)) fsMethod = fsFunctions.get(callee.text) ?? null;
      if (
        ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && fsNamespaces.has(callee.expression.text)
      ) fsMethod = callee.name.text;
      if (
        ts.isPropertyAccessExpression(callee)
        && ts.isPropertyAccessExpression(callee.expression)
        && ts.isIdentifier(callee.expression.expression)
        && fsNamespaces.has(callee.expression.expression.text)
        && callee.expression.name.text === "promises"
      ) fsMethod = callee.name.text;
      if (fsMethod && FS_PATH_ARGUMENTS[fsMethod]) {
        for (const argumentIndex of FS_PATH_ARGUMENTS[fsMethod]) inspectArgument(node, fsMethod, argumentIndex);
      }
      if (callee.kind === ts.SyntaxKind.ImportKeyword) inspectArgument(node, "import", 0, true);
      if (ts.isIdentifier(callee) && callee.text === "require") inspectArgument(node, "require", 0, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function communitySourceLiteralOffenders(sourceFile: ts.SourceFile): string[] {
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    const isTemplateFragment = node.kind === ts.SyntaxKind.TemplateHead
      || node.kind === ts.SyntaxKind.TemplateMiddle
      || node.kind === ts.SyntaxKind.TemplateTail;
    if (ts.isStringLiteralLike(node) || isTemplateFragment) {
      const text = (node as ts.LiteralLikeNode).text;
      if (text.includes(COMMUNITY_SOURCE_LITERAL)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        offenders.push(`${relative(sourceFile.fileName)}:${position.line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function assertWriterImportGraphsDoNotReadData(writerFiles: string[]): void {
  const parsed = readTsConfig("tsconfig.json", "leg 5");
  const program = ts.createProgram({
    rootNames: writerFiles,
    options: { ...parsed.options, allowJs: true, checkJs: false, noEmit: true },
  });
  const reachable = program.getSourceFiles()
    .filter((source) => !source.isDeclarationFile)
    .filter((source) => {
      const absolute = path.resolve(source.fileName);
      return absolute.startsWith(`${REPO_ROOT}${path.sep}`)
        && ![...EXCLUDED_REPOSITORY_DIRECTORIES].some((directory) => absolute.includes(`${path.sep}${directory}${path.sep}`))
        && absolute !== path.resolve(__filename);
    });
  const dataReadOffenders = reachable.flatMap(staticDataReadOffenders).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(
    dataReadOffenders,
    [],
    `leg 5: approved writer import graph has unsafe data reads: ${dataReadOffenders.join("; ")}`,
  );
  const literalOffenders = reachable
    .flatMap(communitySourceLiteralOffenders)
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(
    literalOffenders,
    [],
    `leg 5 tripwire: approved writer import graph contains the literal ${COMMUNITY_SOURCE_LITERAL} in a string: ${literalOffenders.join("; ")}`,
  );
}

function databaseWriterLeg(): void {
  const writes: Record<string, string[]> = {};
  const rawSql: Record<string, string[]> = {};
  const unresolvedDelegateAccesses: string[] = [];

  for (const filePath of walkSourceFiles(REPO_ROOT, true)) {
    if (path.resolve(filePath) === path.resolve(__filename)) continue;
    const analysis = analyzePrismaFile(filePath);
    if (analysis.writes.length > 0) writes[relative(filePath)] = analysis.writes;
    if (analysis.rawSql.length > 0) rawSql[relative(filePath)] = analysis.rawSql;
    for (const finding of analysis.unresolvedDelegateAccesses) {
      unresolvedDelegateAccesses.push(`${relative(filePath)} -> ${finding}`);
    }
  }

  const normalizedWrites = Object.fromEntries(Object.entries(writes).sort(([left], [right]) => left.localeCompare(right)));
  const expectedWrites = Object.fromEntries(
    Object.entries(EXPECTED_DB_WRITES)
      .map(([filePath, values]) => [filePath, [...values].sort((left, right) => left.localeCompare(right))] as const)
      .sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile)),
  );
  const normalizedRawSql = Object.fromEntries(Object.entries(rawSql).sort(([left], [right]) => left.localeCompare(right)));
  const expectedRawSql = Object.fromEntries(
    Object.entries(EXPECTED_RAW_SQL_CALLS)
      .map(([filePath, values]) => [filePath, [...values].sort((left, right) => left.localeCompare(right))] as const)
      .sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile)),
  );

  assert.deepEqual(unresolvedDelegateAccesses, [], "leg 5: unresolved computed Prisma delegate access found");
  assert.deepEqual(normalizedWrites, expectedWrites, "leg 5: repository-wide Prisma write call-site allow-list changed");
  assert.deepEqual(normalizedRawSql, expectedRawSql, "leg 5: Prisma raw-SQL allow-list changed");
  const writerFiles = [...new Set([...Object.keys(writes), ...Object.keys(rawSql)])]
    .map((filePath) => path.join(REPO_ROOT, filePath));
  assertWriterImportGraphsDoNotReadData(writerFiles);
}

async function main(): Promise<void> {
  assertFixtureIdentifiersAreValid();
  databaseWriterLeg();
  console.log("PASS leg 5: repository-wide Prisma write snapshot and transitive no-data-read guard");
  const database = databaseUrl();
  const prisma = new PrismaClient();
  try {
    await behaviouralAndFilesystemLeg(prisma, database);
    console.log("PASS leg 1: behavioural Source set-equality with discriminating fixture");
    console.log("PASS leg 3: filesystem trace and child-process spawn rejection");
    importGraphLeg();
    console.log("PASS leg 2: derived import graph and root completeness");
    scriptSnapshotLeg();
    console.log("PASS leg 4: package script name→value snapshot");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
