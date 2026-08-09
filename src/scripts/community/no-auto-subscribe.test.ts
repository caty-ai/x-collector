/**
 * Community sources are discoverable data, never subscription input.
 *
 * The static legs are the load-bearing tripwire. Delegate-shaped writes fail closed without proving
 * the receiver is a Prisma client; raw calls include a normalized SQL-body hash and DML policy; and
 * approved writer closures reject unsafe filesystem and network acquisition. The analyzer invariant
 * is simple: a value needed to establish safety either resolves to an exact allow-list entry or is an
 * offender. The behavioural legs remain best-effort convenience checks for ordinary executed paths.
 */
import assert from "assert/strict";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
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
const REPOSITORY_SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const EXCLUDED_REPOSITORY_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".next"]);
const COMMUNITY_SOURCE_LITERAL = "community-sources";
const ALLOWED_NETWORK_ORIGINS = new Set([
  "https://api.scrapecreators.com",
  "https://openrouter.ai",
]);
const NETWORK_IMPORT_BOUNDARY_SNAPSHOTS: Record<string, string> = {
  // Discovery imports only this scalar. Hashing the complete module makes any new top-level side
  // effect or changed dependency a deliberate allow-list diff before it can leave the closure.
  "src/collector/evaluate-candidates.ts->src/lib/pipeline/classify-llm.ts#DEFAULT_LLM_MODEL":
    "e3b1844811c7427a8aa40dfa571dee6cfcc96ea6b0ea96229bbea5c9942efd1d",
};

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
  "src/lib/pipeline/topic-cluster.ts": ["pipelineCrosslinkLlmDecision.update"],
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
  "src/app/api/family-feed/route.ts": ["$queryRaw:b0a022eccf9d5b06f5866a54bab49b23925e38e5c4dce2018f2c4807c663d4ae"],
  "src/collector/discover.ts": ["$queryRaw:2919befd038e5bf4db376f5a47cdf05f255c2c2d0681563f1454b2545d284abb"],
  "src/collector/source-score.ts": ["$queryRaw:ed56315227c2e1e1d870b219a1b3a76a4a7c61749fdd256c6f8c23d5b9b1d379"],
  "src/lib/pipeline/topic-cluster.ts": [
    "$executeRaw:745ec98b8d9edea33cdc321056526ffd2754e6fd9b0a6b17c736ddb3592f3284",
    "$queryRaw:52ac0e7f197bbbed616a4e20fa2c6a61c6cea41b4a15ea5ce86bce9ec9f7325a",
  ],
};
const ALLOWED_RAW_DML_CALLS = new Set([
  "src/lib/pipeline/topic-cluster.ts:$executeRaw:745ec98b8d9edea33cdc321056526ffd2754e6fd9b0a6b17c736ddb3592f3284",
]);
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
  sourceTableWriter: boolean;
  offenders: string[];
  rawDmlOffenders: string[];
};

type PrismaMethod = {
  kind: "write" | "raw";
  method: string;
  delegate?: DelegateModel;
};

type Scope = {
  delegates: Map<string, DelegateModel>;
  methods: Map<string, PrismaMethod>;
};

function isPrismaRawMethod(method: string): boolean {
  return /^\$(?:execute|query)Raw/.test(method);
}

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
    delegates: new Map(scope.delegates),
    methods: new Map(scope.methods),
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
  // Receiver identity is intentionally irrelevant. Any receiver exposing a schema-derived delegate
  // has the dangerous shape, including imported clients, factories, aliases, and singletons.
  return propertyName as DelegateModel;
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  const functionLike = node as ts.FunctionLikeDeclaration;
  return ts.isFunctionLike(node) && functionLike.body !== undefined;
}

function resolvePrismaMethodExpression(expression: ts.Expression, scope: Scope): PrismaMethod | null {
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) return scope.methods.get(candidate.text) ?? null;
  if (ts.isCallExpression(candidate)) {
    const callee = unwrapExpression(candidate.expression);
    if (
      ts.isPropertyAccessExpression(callee)
      && ts.isIdentifier(callee.expression)
      && callee.expression.text === "Reflect"
      && callee.name.text === "get"
      && candidate.arguments.length >= 2
      && ts.isStringLiteralLike(candidate.arguments[1])
      && isPrismaRawMethod(candidate.arguments[1].text)
    ) return { kind: "raw", method: candidate.arguments[1].text };
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
      && propertyNameText(callee) === "bind"
    ) return resolvePrismaMethodExpression(receiverExpression(callee), scope);
    return null;
  }
  if (!ts.isPropertyAccessExpression(candidate) && !ts.isElementAccessExpression(candidate)) return null;

  const propertyName = propertyNameText(candidate);
  if (propertyName === "bind") return resolvePrismaMethodExpression(receiverExpression(candidate), scope);
  if (propertyName && isPrismaRawMethod(propertyName)) {
    return { kind: "raw", method: propertyName };
  }
  if (
    propertyName === "get"
    && ts.isIdentifier(candidate.expression)
    && candidate.expression.text === "Reflect"
  ) return null;
  const delegate = resolveDelegateExpression(receiverExpression(candidate), scope);
  if (delegate && propertyName && PRISMA_WRITE_METHODS.has(propertyName)) {
    return { kind: "write", method: propertyName, delegate };
  }
  return null;
}

function setBindingAlias(name: ts.BindingName, initializer: ts.Expression, scope: Scope): void {
  if (ts.isObjectBindingPattern(name)) {
    const delegate = resolveDelegateExpression(initializer, scope);
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propertyName = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        ? element.propertyName.text
        : element.name.text;
      if (delegate && PRISMA_WRITE_METHODS.has(propertyName)) {
        scope.methods.set(element.name.text, { kind: "write", method: propertyName, delegate });
      } else if (isPrismaRawMethod(propertyName)) {
        scope.methods.set(element.name.text, { kind: "raw", method: propertyName });
      } else if (PRISMA_MODELS.has(propertyName)) {
        scope.delegates.set(element.name.text, propertyName);
      }
    }
    return;
  }
  const identifier = bindingIdentifier(name);
  if (!identifier) return;
  const method = resolvePrismaMethodExpression(initializer, scope);
  if (method) {
    scope.methods.set(identifier, method);
    return;
  }
  const delegate = resolveDelegateExpression(initializer, scope);
  if (delegate) scope.delegates.set(identifier, delegate);
}

function trackAssignmentAlias(node: ts.Expression, scope: Scope): void {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(node.left)) {
    return;
  }
  setBindingAlias(node.left, node.right, scope);
}

function trackVariableAlias(node: ts.VariableDeclaration, scope: Scope): void {
  if (!node.initializer) return;
  setBindingAlias(node.name, node.initializer, scope);
}

function normalizedTemplateText(
  template: ts.TemplateLiteral,
  context?: StaticPathContext,
  seen = new Set<string>(),
): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text.replace(/\s+/g, " ").trim();
  let sql = template.head.text;
  for (const span of template.templateSpans) {
    let interpolation = "${}";
    if (context) {
      const candidate = unwrapExpression(span.expression);
      if (ts.isIdentifier(candidate) && !seen.has(candidate.text)) {
        const initializer = context.constants.get(candidate.text);
        if (initializer) {
          const nextSeen = new Set(seen);
          nextSeen.add(candidate.text);
          const resolved = normalizedRawSql(initializer, context, nextSeen);
          if (resolved !== null) interpolation = resolved;
        }
      } else if (ts.isTaggedTemplateExpression(candidate)) {
        interpolation = normalizedTemplateText(candidate.template, context, seen);
      }
    }
    sql += ` ${interpolation} ` + span.literal.text;
  }
  return sql.replace(/\s+/g, " ").trim();
}

function normalizedRawSql(
  expression: ts.Expression,
  context: StaticPathContext,
  seen = new Set<string>(),
): string | null {
  const candidate = unwrapExpression(expression);
  if (ts.isStringLiteralLike(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
    return candidate.text.replace(/\s+/g, " ").trim();
  }
  if (ts.isTemplateExpression(candidate)) return normalizedTemplateText(candidate, context, seen);
  if (ts.isTaggedTemplateExpression(candidate)) return normalizedTemplateText(candidate.template, context, seen);
  if (ts.isIdentifier(candidate)) {
    if (seen.has(candidate.text)) return null;
    const initializer = context.constants.get(candidate.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(candidate.text);
    return normalizedRawSql(initializer, context, nextSeen);
  }
  if (ts.isBinaryExpression(candidate) && candidate.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = normalizedRawSql(candidate.left, context, seen);
    const right = normalizedRawSql(candidate.right, context, seen);
    return left !== null && right !== null ? `${left}${right}`.replace(/\s+/g, " ").trim() : null;
  }
  if (ts.isCallExpression(candidate)) {
    const callee = unwrapExpression(candidate.expression);
    if (
      ts.isPropertyAccessExpression(callee)
      && ts.isIdentifier(callee.expression)
      && callee.expression.text === "Prisma"
      && (callee.name.text === "raw" || callee.name.text === "sql")
      && candidate.arguments.length === 1
    ) return normalizedRawSql(candidate.arguments[0], context, seen);
  }
  return null;
}

function rawSqlSnapshot(method: string, sql: string): string {
  return `${method}:${createHash("sha256").update(sql).digest("hex")}`;
}

function sourcePosition(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relative(sourceFile.fileName)}:${position.line + 1}`;
}

function recordRawSql(
  method: string,
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  analysis: PrismaAnalysis,
): void {
  if (!expression) {
    analysis.offenders.push(`${sourcePosition(sourceFile, node)} ${method} has no SQL body`);
    return;
  }
  const context: StaticPathContext = { sourceFile, constants: collectConstantInitializers(sourceFile) };
  const sql = normalizedRawSql(expression, context);
  if (sql === null) {
    analysis.offenders.push(`${sourcePosition(sourceFile, node)} ${method} has an unresolvable SQL body`);
    return;
  }
  const snapshot = rawSqlSnapshot(method, sql);
  analysis.rawSql.push(snapshot);
  const upper = sql.toUpperCase();
  const hasDml = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY)\b/.test(upper)
    || (/^WITH\b/.test(upper) && /\bINTO\b/.test(upper));
  const allowKey = `${relative(sourceFile.fileName)}:${snapshot}`;
  if (hasDml && !ALLOWED_RAW_DML_CALLS.has(allowKey)) {
    analysis.rawDmlOffenders.push(`${sourcePosition(sourceFile, node)} ${method} contains non-allow-listed DML`);
  }
}

function trackPrismaCall(
  node: ts.CallExpression,
  scope: Scope,
  sourceFile: ts.SourceFile,
  analysis: PrismaAnalysis,
): void {
  const directCallee = unwrapExpression(node.expression);
  if (
    (ts.isPropertyAccessExpression(directCallee) || ts.isElementAccessExpression(directCallee))
    && propertyNameText(directCallee) === "bind"
  ) return;
  const method = resolvePrismaMethodExpression(node.expression, scope);
  if (method?.kind === "write") {
    analysis.writes.push(`${method.delegate}.${method.method}`);
    if (method.delegate === "source" || method.delegate === "alertSource") analysis.sourceTableWriter = true;
    return;
  }
  if (method?.kind === "raw") {
    recordRawSql(method.method, node.arguments[0], sourceFile, node, analysis);
  }
}

function trackUnresolvedPrismaShape(
  node: ts.Node,
  scope: Scope,
  sourceFile: ts.SourceFile,
  analysis: PrismaAnalysis,
): void {
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const methodName = propertyNameText(callee);
      const receiver = unwrapExpression(receiverExpression(callee));
      const computedDelegate = ts.isElementAccessExpression(receiver) && !propertyNameText(receiver);
      const reflectedDelegate = ts.isCallExpression(receiver)
        && ts.isPropertyAccessExpression(receiver.expression)
        && ts.isIdentifier(receiver.expression.expression)
        && receiver.expression.expression.text === "Reflect"
        && receiver.expression.name.text === "get"
        && receiver.arguments.length >= 2
        && !ts.isStringLiteralLike(receiver.arguments[1]);
      if (methodName && PRISMA_WRITE_METHODS.has(methodName) && (computedDelegate || reflectedDelegate)) {
        analysis.offenders.push(`${sourcePosition(sourceFile, node)} write call has an unresolvable delegate identity`);
      }
    }
    if (ts.isElementAccessExpression(callee)) {
      const delegate = resolveDelegateExpression(callee.expression, scope);
      if (delegate && !propertyNameText(callee)) {
        analysis.offenders.push(`${sourcePosition(sourceFile, node)} ${delegate} call has an unresolvable method identity`);
      }
    }
    if (
      ts.isPropertyAccessExpression(callee)
      && ts.isIdentifier(callee.expression)
      && callee.expression.text === "Reflect"
      && callee.name.text === "get"
      && node.arguments.length >= 2
      && !ts.isStringLiteralLike(node.arguments[1])
    ) {
      analysis.offenders.push(`${sourcePosition(sourceFile, node)} Reflect.get has an unresolvable delegate identity`);
    }
  }
}

function trackPrismaRawTag(
  node: ts.TaggedTemplateExpression,
  scope: Scope,
  sourceFile: ts.SourceFile,
  analysis: PrismaAnalysis,
): void {
  const method = resolvePrismaMethodExpression(node.tag, scope);
  if (method?.kind === "raw") {
    recordRawSql(method.method, node.template, sourceFile, node, analysis);
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
  const analysis: PrismaAnalysis = {
    writes: [],
    rawSql: [],
    sourceTableWriter: false,
    offenders: [],
    rawDmlOffenders: [],
  };

  const preloadAliases = (node: ts.Node, scope: Scope): void => {
    if (ts.isVariableDeclaration(node)) trackVariableAlias(node, scope);
    else if (ts.isExpressionStatement(node)) trackAssignmentAlias(node.expression, scope);
    ts.forEachChild(node, (child) => {
      if (!isFunctionLikeWithBody(child)) preloadAliases(child, scope);
    });
  };

  const visit = (node: ts.Node, scope: Scope): void => {
    if (isFunctionLikeWithBody(node)) {
      const childScope = cloneScope(scope);
      preloadAliases(node.body, childScope);
      if (node.body) visit(node.body, childScope);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      trackVariableAlias(node, scope);
    } else if (ts.isExpressionStatement(node)) {
      trackAssignmentAlias(node.expression, scope);
    } else if (ts.isCallExpression(node)) {
      trackPrismaCall(node, scope, sourceFile, analysis);
    } else if (ts.isTaggedTemplateExpression(node)) {
      trackPrismaRawTag(node, scope, sourceFile, analysis);
    }
    // Fail-closed invariant: whenever a delegate, method, path, SQL body, or network target is needed
    // to prove safety, an unresolvable value is recorded as an offender and is never silently skipped.
    trackUnresolvedPrismaShape(node, scope, sourceFile, analysis);

    ts.forEachChild(node, (child) => visit(child, scope));
  };

  const rootScope: Scope = { delegates: new Map(), methods: new Map() };
  preloadAliases(sourceFile, rootScope);
  visit(sourceFile, rootScope);
  analysis.writes.sort();
  analysis.rawSql.sort();
  analysis.offenders.sort();
  analysis.rawDmlOffenders.sort();
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

  const registerFsBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      fsNamespaces.add(name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(name)) return;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        ? element.propertyName.text
        : element.name.text;
      if (imported === "promises") fsNamespaces.add(element.name.text);
      else fsFunctions.set(element.name.text, imported);
    }
  };

  const requiredFsModule = (expression: ts.Expression): string | null => {
    const candidate = unwrapExpression(expression);
    if (
      !ts.isCallExpression(candidate)
      || !ts.isIdentifier(candidate.expression)
      || candidate.expression.text !== "require"
      || candidate.arguments.length !== 1
    ) return null;
    const specifier = moduleName(candidate.arguments[0])?.replace(/^node:/, "");
    return specifier === "fs" || specifier === "fs/promises" ? specifier : null;
  };

  const collectFsAcquisitions = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text.replace(/^node:/, "");
      if (specifier === "fs" || specifier === "fs/promises") {
        const clause = node.importClause;
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
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (requiredFsModule(initializer)) registerFsBinding(node.name);
      if (
        ts.isPropertyAccessExpression(initializer)
        && initializer.name.text === "promises"
        && requiredFsModule(initializer.expression) === "fs"
      ) registerFsBinding(node.name);
    }
    ts.forEachChild(node, collectFsAcquisitions);
  };
  collectFsAcquisitions(sourceFile);

  const directRequiredFsMethod = (expression: ts.Expression): string | null => {
    const candidate = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(candidate) && !ts.isElementAccessExpression(candidate)) return null;
    const method = propertyNameText(candidate);
    if (!method) return null;
    if (requiredFsModule(candidate.expression)) return method;
    const namespace = unwrapExpression(candidate.expression);
    if (
      ts.isPropertyAccessExpression(namespace)
      && namespace.name.text === "promises"
      && requiredFsModule(namespace.expression) === "fs"
    ) return method;
    return null;
  };

  const fsAcquisitionIsRegistered = (call: ts.CallExpression, ancestors: ts.Node[]): boolean => {
    const parent = ancestors[ancestors.length - 1];
    const grandparent = ancestors[ancestors.length - 2];
    const greatGrandparent = ancestors[ancestors.length - 3];
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === call) return true;
    if (!parent) return false;
    if (!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) return false;
    const property = propertyNameText(parent);
    if (property === "promises") {
      if (grandparent && ts.isVariableDeclaration(grandparent) && grandparent.initializer === parent) return true;
      if (grandparent && (ts.isPropertyAccessExpression(grandparent) || ts.isElementAccessExpression(grandparent))) {
        return ts.isCallExpression(greatGrandparent) && greatGrandparent.expression === grandparent;
      }
      return false;
    }
    return ts.isCallExpression(grandparent) && grandparent.expression === parent;
  };

  const inspectFsAcquisitions = (node: ts.Node, ancestors: ts.Node[] = []): void => {
    if (ts.isCallExpression(node) && requiredFsModule(node) && !fsAcquisitionIsRegistered(node, ancestors)) {
      offenders.push(`${sourcePosition(sourceFile, node)} fs module acquisition is not registered`);
    }
    ts.forEachChild(node, (child) => inspectFsAcquisitions(child, [...ancestors, node]));
  };
  inspectFsAcquisitions(sourceFile);

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
      fsMethod ??= directRequiredFsMethod(callee);
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && ts.isIdentifier(callee.expression)
        && fsNamespaces.has(callee.expression.text)
      ) fsMethod = propertyNameText(callee);
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && ts.isPropertyAccessExpression(callee.expression)
        && ts.isIdentifier(callee.expression.expression)
        && fsNamespaces.has(callee.expression.expression.text)
        && callee.expression.name.text === "promises"
      ) fsMethod = propertyNameText(callee);
      if (
        ts.isElementAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && fsNamespaces.has(callee.expression.text)
        && !propertyNameText(callee)
      ) offenders.push(`${sourcePosition(sourceFile, node)} fs call has an unresolvable method identity`);
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

function networkImportClosure(rootFiles: string[]): ts.SourceFile[] {
  const parsed = readTsConfig("tsconfig.json", "leg 5 network guard");
  const seen = new Map<string, ts.SourceFile>();

  const visitFile = (filePath: string): void => {
    const absolute = path.resolve(filePath);
    if (seen.has(absolute)) return;
    const sourceFile = ts.createSourceFile(
      absolute,
      fs.readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(absolute),
    );
    seen.set(absolute, sourceFile);

    const followModule = (specifier: string, importedNames: string[] = []): void => {
      const resolved = ts.resolveModuleName(
        specifier,
        absolute,
        parsed.options,
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (!resolved) return;
      const resolvedAbsolute = path.resolve(resolved);
      if (!resolvedAbsolute.startsWith(`${REPO_ROOT}${path.sep}`) || resolvedAbsolute.includes(`${path.sep}node_modules${path.sep}`)) {
        return;
      }

      const boundaryKey = `${relative(absolute)}->${relative(resolvedAbsolute)}#${importedNames.join(",")}`;
      const expectedHash = NETWORK_IMPORT_BOUNDARY_SNAPSHOTS[boundaryKey];
      if (expectedHash) {
        const actualHash = createHash("sha256").update(fs.readFileSync(resolvedAbsolute)).digest("hex");
        assert.equal(actualHash, expectedHash, `leg 5: network import-boundary snapshot changed: ${boundaryKey}`);
        return;
      }
      visitFile(resolvedAbsolute);
    };

    const visitImports = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause;
        const importedNames = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements.map((element) => element.propertyName?.text ?? element.name.text).sort()
          : [];
        followModule(node.moduleSpecifier.text, importedNames);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        followModule(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        const callee = unwrapExpression(node.expression);
        if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
          followModule(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, visitImports);
    };
    visitImports(sourceFile);
  };

  rootFiles.forEach(visitFile);
  return [...seen.values()];
}

function evaluateNetworkTargets(
  expression: ts.Expression,
  context: StaticPathContext,
  seen = new Set<string>(),
): string[] | null {
  const resolved = evaluateStaticPaths(expression, context, seen);
  if (resolved) return resolved;
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) {
    if (seen.has(candidate.text)) return null;
    const initializer = context.constants.get(candidate.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(candidate.text);
    return evaluateNetworkTargets(initializer, context, nextSeen);
  }
  if (ts.isTemplateExpression(candidate)) {
    const headOrigin = candidate.head.text.match(/^https?:\/\/[^/]+/i)?.[0];
    return headOrigin ? [headOrigin] : null;
  }
  if (ts.isNewExpression(candidate) && ts.isIdentifier(candidate.expression) && candidate.expression.text === "URL") {
    const first = candidate.arguments?.[0];
    return first ? evaluateNetworkTargets(first, context, seen) : null;
  }
  if (ts.isCallExpression(candidate)) {
    const callee = unwrapExpression(candidate.expression);
    if (
      ts.isPropertyAccessExpression(callee)
      && callee.name.text === "toString"
      && candidate.arguments.length === 0
    ) return evaluateNetworkTargets(callee.expression, context, seen);
  }
  return null;
}

function networkTargetOffenders(sourceFiles: ts.SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const sourceFile of sourceFiles) {
    const context: StaticPathContext = { sourceFile, constants: collectConstantInitializers(sourceFile) };
    const requestNamespaces = new Set(["http", "https"]);
    const collectRequestNamespaces = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text.replace(/^node:/, "");
        if (specifier === "http" || specifier === "https") {
          if (node.importClause?.name) requestNamespaces.add(node.importClause.name.text);
          if (node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
            requestNamespaces.add(node.importClause.namedBindings.name.text);
          }
        }
      }
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && ts.isCallExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression)
        && node.initializer.expression.text === "require"
        && node.initializer.arguments.length === 1
        && ts.isStringLiteralLike(node.initializer.arguments[0])
      ) {
        const specifier = node.initializer.arguments[0].text.replace(/^node:/, "");
        if (specifier === "http" || specifier === "https") requestNamespaces.add(node.name.text);
      }
      ts.forEachChild(node, collectRequestNamespaces);
    };
    collectRequestNamespaces(sourceFile);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        const isFetch = ts.isIdentifier(callee) && callee.text === "fetch";
        const isHttpRequest = ts.isPropertyAccessExpression(callee)
          && ts.isIdentifier(callee.expression)
          && requestNamespaces.has(callee.expression.text)
          && callee.name.text === "request";
        if (isFetch || isHttpRequest) {
          const target = node.arguments[0];
          const values = target ? evaluateNetworkTargets(target, context) : null;
          if (!values || values.length === 0) {
            offenders.push(`${sourcePosition(sourceFile, node)} network target is unresolvable`);
          } else {
            for (const value of values) {
              let parsed: URL;
              try {
                parsed = new URL(value);
              } catch {
                offenders.push(`${sourcePosition(sourceFile, node)} network target is not an absolute URL`);
                continue;
              }
              if (!ALLOWED_NETWORK_ORIGINS.has(parsed.origin)) {
                offenders.push(`${sourcePosition(sourceFile, node)} network origin is not allow-listed: ${parsed.origin}`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return offenders.sort((left, right) => left.localeCompare(right));
}

function assertWriterImportGraphsDoNotReadData(writerFiles: string[], sourceWriterFiles: string[]): void {
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
  const networkOffenders = networkTargetOffenders(networkImportClosure(sourceWriterFiles));
  assert.deepEqual(
    networkOffenders,
    [],
    `leg 5: source/alertSource writer import closure has unsafe network targets: ${networkOffenders.join("; ")}`,
  );
}

function databaseWriterLeg(): void {
  const writes: Record<string, string[]> = {};
  const rawSql: Record<string, string[]> = {};
  const analysisOffenders: string[] = [];
  const rawDmlOffenders: string[] = [];
  const sourceWriterFiles: string[] = [];

  for (const filePath of walkSourceFiles(REPO_ROOT, true)) {
    if (path.resolve(filePath) === path.resolve(__filename)) continue;
    const analysis = analyzePrismaFile(filePath);
    if (analysis.writes.length > 0) writes[relative(filePath)] = analysis.writes;
    if (analysis.rawSql.length > 0) rawSql[relative(filePath)] = analysis.rawSql;
    if (analysis.sourceTableWriter) sourceWriterFiles.push(filePath);
    analysisOffenders.push(...analysis.offenders);
    rawDmlOffenders.push(...analysis.rawDmlOffenders);
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

  assert.deepEqual(analysisOffenders, [], "leg 5: fail-closed Prisma analysis found unresolved values");
  assert.deepEqual(normalizedWrites, expectedWrites, "leg 5: repository-wide Prisma write call-site allow-list changed");
  assert.deepEqual(normalizedRawSql, expectedRawSql, "leg 5: Prisma raw-SQL allow-list changed");
  assert.deepEqual(rawDmlOffenders, [], "leg 5: non-allow-listed raw SQL DML found");
  const writerFiles = [...new Set([...Object.keys(writes), ...Object.keys(rawSql)])]
    .map((filePath) => path.join(REPO_ROOT, filePath));
  assertWriterImportGraphsDoNotReadData(writerFiles, sourceWriterFiles);
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
