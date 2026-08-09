/**
 * Community sources are discoverable data, never subscription input.
 *
 * The static legs are the load-bearing tripwire. Delegate-shaped writes fail closed without proving
 * the receiver is a Prisma client; raw calls include a normalized SQL-body hash and DML policy; and
 * approved writer closures reject unsafe filesystem reads and network acquisition, while every
 * repository source file is checked for writes under data/. The checks target ordinary code shapes
 * and fail closed when a value used by a recognised shape cannot be resolved.
 * Deliberately unusual spellings remain outside the stated threat model. The behavioural legs remain
 * best-effort convenience checks for ordinary executed paths.
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
const NEXT_CONFIG_PATH = path.join(REPO_ROOT, "next.config.js");
const SENTINEL_IDENTIFIER = "ZZSentinelSrc";
const PROMOTED_IDENTIFIER = "ManualSource";
const SENTINEL_KEY = SENTINEL_IDENTIFIER.toLowerCase();
const SENTINEL_FILENAME = `x--${SENTINEL_KEY}.json`;
const NEXT_DEFAULT_PAGE_EXTENSIONS = ["js", "jsx", "ts", "tsx"] as const;
const NODE_LOADABLE_SOURCE_EXTENSIONS = ["mjs", "cjs", "mts", "cts"] as const;
const REPOSITORY_SOURCE_EXTENSIONS = new Set(
  [...NEXT_DEFAULT_PAGE_EXTENSIONS, ...NODE_LOADABLE_SOURCE_EXTENSIONS].map((extension) => `.${extension}`),
);
const EXCLUDED_REPOSITORY_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".next"]);
const COMMUNITY_SOURCE_LITERAL = "community-sources";
const ALLOWED_NETWORK_ORIGINS = new Set([
  "https://api.scrapecreators.com",
  "https://openrouter.ai",
  "https://transcriptapi.com",
  "https://www.youtube.com",
]);
const NETWORK_CAPABLE_BUILTINS = new Set(["http", "https", "net", "tls", "dgram"]);
const KNOWN_HTTP_CLIENT_PACKAGES = new Set(["axios", "got", "ky", "node-fetch", "superagent", "undici"]);
const ALLOWED_NETWORK_MODULE_ACQUISITIONS = new Set([
  "src/lib/net/safe-fetch.ts:http",
  "src/lib/net/safe-fetch.ts:https",
  "src/lib/net/safe-fetch.ts:net",
]);
const ALLOWED_UNRESOLVED_NETWORK_TARGETS = new Set([
  "src/lib/net/safe-fetch.ts:sha256:f5012582daf4459128b740d094d0ee0d1ad734fd20356d7ab12188a2a17dc027",
  "src/lib/ops-alert.ts:webhookUrl",
  "src/lib/ops-alert.ts:url",
  "src/lib/pipeline/enrich-youtube-transcript.ts:targetUrl",
]);

const EXPECTED_DEPENDENCIES: Record<string, string> = {
  "@modelcontextprotocol/sdk": "1.26.0",
  "@prisma/client": "^5.20.0",
  dotenv: "^17.4.2",
  "ipaddr.js": "^2.4.0",
  "mcp-handler": "^1.1.0",
  next: "^14.2.0",
  "next-auth": "^4.24.13",
  "node-cron": "^3.0.3",
  react: "^18.3.0",
  "react-dom": "^18.3.0",
  "react-markdown": "^9.1.0",
  "rss-parser": "^3.13.0",
  zod: "^3.25.76",
};

const EXPECTED_DEV_DEPENDENCIES: Record<string, string> = {
  "@types/node": "^20.14.0",
  "@types/react": "^18.3.0",
  autoprefixer: "^10.4.24",
  postcss: "^8.5.6",
  prisma: "^5.20.0",
  tailwindcss: "^3.4.19",
  "ts-node": "^10.9.2",
  typescript: "^5.5.0",
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
const ALLOWED_NON_PRISMA_DELEGATE_SHAPES = new Set<string>();
const PRISMA_MODELS = prismaDelegatesFromSchema();
const PRISMA_RELATIONS = prismaRelationsFromSchema(PRISMA_MODELS);
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

type PrismaMethod =
  | { kind: "write"; method: string; delegate: DelegateModel }
  | { kind: "raw"; method: string };

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

function prismaRelationsFromSchema(models: Set<string>): Map<string, Map<string, string>> {
  const schema = fs.readFileSync(PRISMA_SCHEMA_PATH, "utf8");
  const relations = new Map<string, Map<string, string>>();
  for (const match of schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm)) {
    const model = match[1];
    const delegate = `${model[0].toLowerCase()}${model.slice(1)}`;
    const fields = new Map<string, string>();
    for (const line of match[2].split("\n")) {
      const field = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\[\])?\??(?:\s|$)/);
      if (!field) continue;
      const target = `${field[2][0].toLowerCase()}${field[2].slice(1)}`;
      if (models.has(target)) fields.set(field[1], target);
    }
    relations.set(delegate, fields);
  }
  return relations;
}

function effectiveNextPageExtensions(): string[] {
  let loaded: unknown;
  try {
    const resolved = require.resolve(NEXT_CONFIG_PATH);
    delete require.cache[resolved];
    loaded = require(resolved) as unknown;
  } catch (error) {
    assert.fail(`startup: could not read next.config.js: ${String(error)}`);
  }
  const config = loaded && typeof loaded === "object" && "default" in loaded
    ? (loaded as { default: unknown }).default
    : loaded;
  assert.ok(config && typeof config === "object", "startup: next.config.js must export an object for extension inspection");
  const pageExtensions = (config as { pageExtensions?: unknown }).pageExtensions;
  if (pageExtensions === undefined) return [...NEXT_DEFAULT_PAGE_EXTENSIONS];
  assert.ok(
    Array.isArray(pageExtensions) && pageExtensions.length > 0 && pageExtensions.every((value) => typeof value === "string"),
    "startup: next.config.js pageExtensions must be a non-empty string array",
  );
  return pageExtensions.map((extension) => extension.replace(/^\./, ""));
}

function assertRepositoryExtensionCoverage(): void {
  const uncovered = effectiveNextPageExtensions()
    .map((extension) => `.${extension}`)
    .filter((extension) => !REPOSITORY_SOURCE_EXTENSIONS.has(extension));
  assert.deepEqual(
    uncovered,
    [],
    `startup: next.config.js pageExtensions are not covered by the repository walk: ${uncovered.join(", ")}`,
  );
}

function walkSourceFiles(directory: string, wholeRepository = false): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && wholeRepository && EXCLUDED_REPOSITORY_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkSourceFiles(absolute, wholeRepository));
    else if (REPOSITORY_SOURCE_EXTENSIONS.has(path.extname(entry.name))) found.push(absolute);
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
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const actual = Object.fromEntries(Object.entries(packageJson.scripts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const expected = Object.fromEntries(Object.entries(EXPECTED_SCRIPTS).sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(actual, expected, "leg 4: package.json script name→value map changed");
  assert.deepEqual(packageJson.dependencies ?? {}, EXPECTED_DEPENDENCIES, "leg 4: package.json dependencies changed");
  assert.deepEqual(packageJson.devDependencies ?? {}, EXPECTED_DEV_DEPENDENCIES, "leg 4: package.json devDependencies changed");
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
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
    if (ts.isAwaitExpression(current) || ts.isSatisfiesExpression(current)) {
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
        const initializer = constantInitializerAt(candidate, candidate.text, context);
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
    const initializer = constantInitializerAt(candidate, candidate.text, context);
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
  const context = staticPathContext(sourceFile);
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

function recordPrismaWrite(method: Extract<PrismaMethod, { kind: "write" }>, analysis: PrismaAnalysis): void {
  analysis.writes.push(`${method.delegate}.${method.method}`);
  if (method.delegate === "source" || method.delegate === "alertSource") analysis.sourceTableWriter = true;
}

function delegateShapeAllowKey(sourceFile: ts.SourceFile, expression: ts.Expression): string {
  return `${relative(sourceFile.fileName)}:${expression.getText(sourceFile).replace(/\s+/g, " ").trim()}`;
}

function propertyInitializer(
  property: ts.ObjectLiteralElementLike,
  context: StaticPathContext,
): { name: string; expression: ts.Expression } | null {
  if (ts.isPropertyAssignment(property)) {
    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      ? property.name.text
      : null;
    return name ? { name, expression: property.initializer } : null;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    const initializer = constantInitializerAt(property.name, property.name.text, context);
    return initializer ? { name: property.name.text, expression: initializer } : null;
  }
  return null;
}

function resolveStaticExpression(
  expression: ts.Expression,
  context: StaticPathContext,
  seen = new Set<string>(),
): ts.Expression | null {
  const candidate = unwrapExpression(expression);
  if (!ts.isIdentifier(candidate)) return candidate;
  if (seen.has(candidate.text)) return null;
  const initializer = constantInitializerAt(candidate, candidate.text, context);
  if (!initializer) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(candidate.text);
  return resolveStaticExpression(initializer, context, nextSeen);
}

function forEachObjectLiteral(
  expression: ts.Expression,
  context: StaticPathContext,
  visit: (object: ts.ObjectLiteralExpression) => void,
): void {
  const resolved = resolveStaticExpression(expression, context);
  if (!resolved) return;
  if (ts.isArrayLiteralExpression(resolved)) {
    for (const element of resolved.elements) {
      if (!ts.isSpreadElement(element)) forEachObjectLiteral(element, context, visit);
    }
    return;
  }
  if (ts.isObjectLiteralExpression(resolved)) visit(resolved);
}

function inspectNestedRelationWrites(
  expression: ts.Expression,
  delegate: DelegateModel,
  context: StaticPathContext,
  analysis: PrismaAnalysis,
): void {
  forEachObjectLiteral(expression, context, (dataObject) => {
    for (const property of dataObject.properties) {
      if (ts.isSpreadAssignment(property)) {
        inspectNestedRelationWrites(property.expression, delegate, context, analysis);
        continue;
      }
      const field = propertyInitializer(property, context);
      if (!field) continue;
      const targetDelegate = PRISMA_RELATIONS.get(delegate)?.get(field.name);
      if (!targetDelegate) {
        if (field.name === "data" || field.name === "create" || field.name === "update") {
          inspectNestedRelationWrites(field.expression, delegate, context, analysis);
        }
        continue;
      }

      forEachObjectLiteral(field.expression, context, (relationObject) => {
        for (const relationProperty of relationObject.properties) {
          const action = propertyInitializer(relationProperty, context);
          if (!action) continue;
          const record = (method: string, payload: ts.Expression): void => {
            recordPrismaWrite({ kind: "write", delegate: targetDelegate, method }, analysis);
            inspectNestedRelationWrites(payload, targetDelegate, context, analysis);
          };
          if (action.name === "create" || action.name === "createMany") {
            if (action.name === "createMany") {
              forEachObjectLiteral(action.expression, context, (container) => {
                const data = container.properties
                  .map((candidate) => propertyInitializer(candidate, context))
                  .find((candidate) => candidate?.name === "data");
                record("createMany", data?.expression ?? action.expression);
              });
            } else {
              record("create", action.expression);
            }
          } else if (action.name === "update") {
            record("update", action.expression);
          } else if (action.name === "connectOrCreate") {
            forEachObjectLiteral(action.expression, context, (container) => {
              const create = container.properties
                .map((candidate) => propertyInitializer(candidate, context))
                .find((candidate) => candidate?.name === "create");
              if (create) record("create", create.expression);
            });
          } else if (action.name === "upsert") {
            forEachObjectLiteral(action.expression, context, (container) => {
              for (const branch of container.properties) {
                const candidate = propertyInitializer(branch, context);
                if (candidate?.name === "create") record("create", candidate.expression);
                if (candidate?.name === "update") record("update", candidate.expression);
              }
            });
          }
        }
      });
    }
  });
}

function inspectPrismaWriteArguments(
  node: ts.CallExpression,
  method: Extract<PrismaMethod, { kind: "write" }>,
  context: StaticPathContext,
  analysis: PrismaAnalysis,
): void {
  const options = node.arguments[0];
  if (!options) return;
  forEachObjectLiteral(options, context, (object) => {
    const payloadNames = method.method === "upsert" ? new Set(["create", "update"]) : new Set(["data"]);
    for (const property of object.properties) {
      const candidate = propertyInitializer(property, context);
      if (candidate && payloadNames.has(candidate.name)) {
        inspectNestedRelationWrites(candidate.expression, method.delegate, context, analysis);
      }
    }
  });
}

function trackPrismaCall(
  node: ts.CallExpression,
  scope: Scope,
  sourceFile: ts.SourceFile,
  analysis: PrismaAnalysis,
  context: StaticPathContext,
): void {
  const directCallee = unwrapExpression(node.expression);
  if (
    (ts.isPropertyAccessExpression(directCallee) || ts.isElementAccessExpression(directCallee))
    && propertyNameText(directCallee) === "bind"
  ) return;
  const method = resolvePrismaMethodExpression(node.expression, scope);
  if (method?.kind === "write") {
    if (ALLOWED_NON_PRISMA_DELEGATE_SHAPES.has(delegateShapeAllowKey(sourceFile, node.expression))) return;
    recordPrismaWrite(method, analysis);
    inspectPrismaWriteArguments(node, method, context, analysis);
    return;
  }
  if (method?.kind === "raw") {
    recordRawSql(method.method, node.arguments[0], sourceFile, node, analysis);
  }
}

function trackDetachedPrismaMethodReference(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  scope: Scope,
  sourceFile: ts.SourceFile,
  analysis: PrismaAnalysis,
): void {
  const method = resolvePrismaMethodExpression(node, scope);
  if (method?.kind !== "write") return;
  if (ALLOWED_NON_PRISMA_DELEGATE_SHAPES.has(delegateShapeAllowKey(sourceFile, node))) return;
  let reference: ts.Expression = node;
  let parent = node.parent;
  while (
    parent
    && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent))
    && parent.expression === reference
  ) {
    reference = parent;
    parent = parent.parent;
  }
  if (parent && ts.isCallExpression(parent) && parent.expression === reference) return;
  analysis.offenders.push(
    `${sourcePosition(sourceFile, node)} ${method.delegate}.${method.method} method reference is not directly invoked`,
  );
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
  const context = staticPathContext(sourceFile);

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
      trackPrismaCall(node, scope, sourceFile, analysis, context);
    } else if (ts.isTaggedTemplateExpression(node)) {
      trackPrismaRawTag(node, scope, sourceFile, analysis);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      trackDetachedPrismaMethodReference(node, scope, sourceFile, analysis);
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

type FsPathArguments = { read?: number[]; write?: number[] };

const FS_PATH_ARGUMENTS: Record<string, FsPathArguments> = {
  access: { read: [0] }, accessSync: { read: [0] }, appendFile: { write: [0] }, appendFileSync: { write: [0] },
  chmod: { write: [0] }, chmodSync: { write: [0] }, chown: { write: [0] }, chownSync: { write: [0] },
  copyFile: { read: [0], write: [1] }, copyFileSync: { read: [0], write: [1] },
  cp: { read: [0], write: [1] }, cpSync: { read: [0], write: [1] },
  createReadStream: { read: [0] }, createWriteStream: { write: [0] },
  exists: { read: [0] }, existsSync: { read: [0] }, lstat: { read: [0] }, lstatSync: { read: [0] },
  mkdir: { write: [0] }, mkdirSync: { write: [0] }, mkdtemp: { write: [0] }, mkdtempSync: { write: [0] },
  open: { read: [0], write: [0] }, openSync: { read: [0], write: [0] },
  opendir: { read: [0] }, opendirSync: { read: [0] }, readFile: { read: [0] }, readFileSync: { read: [0] },
  readdir: { read: [0] }, readdirSync: { read: [0] }, readlink: { read: [0] }, readlinkSync: { read: [0] },
  realpath: { read: [0] }, realpathSync: { read: [0] }, rename: { write: [0, 1] },
  renameSync: { read: [0], write: [0, 1] }, rm: { write: [0] }, rmSync: { write: [0] },
  rmdir: { write: [0] }, rmdirSync: { write: [0] }, stat: { read: [0] }, statSync: { read: [0] },
  symlink: { write: [1] }, symlinkSync: { write: [1] }, truncate: { write: [0] },
  truncateSync: { write: [0] }, unlink: { write: [0] }, unlinkSync: { write: [0] },
  utimes: { write: [0] }, utimesSync: { write: [0] }, watch: { read: [0] }, watchFile: { read: [0] },
  writeFile: { write: [0] }, writeFileSync: { write: [0] },
};

const FS_DESCRIPTOR_FIRST_METHODS = new Set([
  "close", "closeSync", "fdatasync", "fdatasyncSync", "fstat", "fstatSync", "fsync", "fsyncSync",
  "ftruncate", "ftruncateSync", "futimes", "futimesSync", "read", "readSync", "readv", "readvSync",
  "write", "writeSync", "writev", "writevSync",
]);

const SAFE_COMPUTED_FS_READS: Record<string, Record<string, string>> = {
  // These remain necessary after module-binding resolution: the optional promptDir parameter makes
  // the base dynamic. Keep the exact established filenames and initializer shape so this cannot
  // become a general computed-path bypass.
  "src/lib/pipeline/classify-llm.ts": {
    sharedPath: "final-shared-common.md",
    groupAPath: "group-a-short-social.md",
    groupBPath: "group-b-longform.md",
    groupCPath: "group-c-repo.md",
  },
};

// Key format: "repository-relative-file:fsMethod:repository-relative-target".
// Product code currently has no sanctioned write under data/.
const ALLOWED_DATA_WRITES = new Set<string>();

const SAFE_COMPUTED_FS_WRITES = new Set([
  // GitHub Actions owns this runner-temporary path; the workflow supplies it as GITHUB_OUTPUT.
  "src/scripts/community/gate.ts:appendFileSync:output",
]);

type StaticPathContext = {
  sourceFile: ts.SourceFile;
  lexicalScopes: Map<ts.Node, StaticLexicalScope>;
  moduleNamespaces: Map<string, StaticPathModule>;
  moduleFunctions: Map<string, StaticModuleFunction>;
};

type StaticLexicalScope = {
  parent: StaticLexicalScope | null;
  bindings: Map<string, StaticLexicalBinding | null>;
};

type StaticLexicalBinding = {
  initializer: ts.Expression | null;
  numeric: boolean;
};

type StaticPathModule = "os" | "path" | "process";

type StaticModuleFunction = {
  module: StaticPathModule;
  method: string;
  pathFlavor?: "posix" | "win32";
};

const STATIC_PATH_MODULE_METHODS: Record<StaticPathModule, Set<string>> = {
  os: new Set(["homedir", "tmpdir"]),
  path: new Set(["basename", "dirname", "join", "normalize", "resolve"]),
  process: new Set(["cwd"]),
};

function staticPathModuleName(specifier: string): StaticPathModule | null {
  const normalized = specifier.replace(/^node:/, "");
  return normalized === "os" || normalized === "path" || normalized === "process" ? normalized : null;
}

function requiredStaticPathModule(expression: ts.Expression): StaticPathModule | null {
  const candidate = unwrapExpression(expression);
  if (
    !ts.isCallExpression(candidate)
    || !ts.isIdentifier(candidate.expression)
    || candidate.expression.text !== "require"
    || candidate.arguments.length !== 1
    || !ts.isStringLiteralLike(candidate.arguments[0])
  ) return null;
  return staticPathModuleName(candidate.arguments[0].text);
}

function collectStaticPathModuleBindings(sourceFile: ts.SourceFile): {
  namespaces: Map<string, StaticPathModule>;
  functions: Map<string, StaticModuleFunction>;
} {
  const namespaces = new Map<string, StaticPathModule>([["process", "process"]]);
  const functions = new Map<string, StaticModuleFunction>();
  const explicitNamespaces = new Set<string>();

  const setNamespace = (name: string, module: StaticPathModule): void => {
    namespaces.set(name, module);
    explicitNamespaces.add(name);
  };

  const registerBinding = (name: ts.BindingName, module: StaticPathModule): void => {
    if (ts.isIdentifier(name)) {
      setNamespace(name.text, module);
      return;
    }
    if (!ts.isObjectBindingPattern(name)) return;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        ? element.propertyName.text
        : element.name.text;
      if (STATIC_PATH_MODULE_METHODS[module].has(imported)) {
        functions.set(element.name.text, { module, method: imported });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      const module = staticPathModuleName(node.moduleReference.expression.text);
      if (module) setNamespace(node.name.text, module);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const module = staticPathModuleName(node.moduleSpecifier.text);
      if (module) {
        const clause = node.importClause;
        if (clause?.name) setNamespace(clause.name.text, module);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          setNamespace(clause.namedBindings.name.text, module);
        }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
            const imported = element.propertyName?.text ?? element.name.text;
            if (STATIC_PATH_MODULE_METHODS[module].has(imported)) {
              functions.set(element.name.text, { module, method: imported });
            }
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      const module = requiredStaticPathModule(initializer);
      if (module) registerBinding(node.name, module);
      if (ts.isIdentifier(initializer)) {
        const reboundModule = namespaces.get(initializer.text);
        if (reboundModule) registerBinding(node.name, reboundModule);
      }
      if (
        ts.isIdentifier(node.name)
        && (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer))
      ) {
        const receiver = unwrapExpression(initializer.expression);
        const requiredModule = requiredStaticPathModule(receiver)
          ?? (ts.isIdentifier(receiver) ? namespaces.get(receiver.text) ?? null : null);
        const method = propertyNameText(initializer);
        if (requiredModule && method && STATIC_PATH_MODULE_METHODS[requiredModule].has(method)) {
          functions.set(node.name.text, { module: requiredModule, method });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const declarationCounts = collectDeclarationCounts(sourceFile);
  for (const name of namespaces.keys()) {
    const expectedCount = name === "process" && !explicitNamespaces.has(name) ? 0 : 1;
    if ((declarationCounts.get(name) ?? 0) !== expectedCount) namespaces.delete(name);
  }
  for (const name of functions.keys()) {
    if ((declarationCounts.get(name) ?? 0) !== 1) functions.delete(name);
  }
  return { namespaces, functions };
}

function staticPathContext(sourceFile: ts.SourceFile): StaticPathContext {
  const bindings = collectStaticPathModuleBindings(sourceFile);
  return {
    sourceFile,
    lexicalScopes: collectConstantInitializers(sourceFile),
    moduleNamespaces: bindings.namespaces,
    moduleFunctions: bindings.functions,
  };
}

function collectConstantInitializers(sourceFile: ts.SourceFile): Map<ts.Node, StaticLexicalScope> {
  const scopes = new Map<ts.Node, StaticLexicalScope>();
  const rootScope: StaticLexicalScope = { parent: null, bindings: new Map() };

  const registerName = (
    scope: StaticLexicalScope,
    name: ts.BindingName,
    initializer: ts.Expression | null,
    numeric = false,
  ): void => {
    if (ts.isIdentifier(name)) {
      scope.bindings.set(name.text, scope.bindings.has(name.text) ? null : { initializer, numeric });
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) registerName(scope, element.name, null);
    }
  };

  const visit = (node: ts.Node, inheritedScope: StaticLexicalScope): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      registerName(inheritedScope, node.name, null);
    }
    const createsScope = node !== sourceFile && (
      ts.isBlock(node)
      || ts.isModuleBlock(node)
      || ts.isCaseBlock(node)
      || ts.isCatchClause(node)
      || ts.isFunctionLike(node)
    );
    const scope = createsScope ? { parent: inheritedScope, bindings: new Map<string, StaticLexicalBinding | null>() } : inheritedScope;
    scopes.set(node, scope);

    if (ts.isVariableDeclaration(node)) {
      const numeric = node.type?.kind === ts.SyntaxKind.NumberKeyword
        || (node.initializer !== undefined && ts.isNumericLiteral(unwrapExpression(node.initializer)));
      registerName(scope, node.name, node.initializer ?? null, numeric);
    }
    if (ts.isParameter(node)) registerName(scope, node.name, null, node.type?.kind === ts.SyntaxKind.NumberKeyword);
    if (ts.isImportClause(node) && node.name) registerName(scope, node.name, null);
    if (ts.isImportSpecifier(node)) registerName(scope, node.name, null);
    if (ts.isNamespaceImport(node)) registerName(scope, node.name, null);

    ts.forEachChild(node, (child) => visit(child, scope));
  };
  scopes.set(sourceFile, rootScope);
  ts.forEachChild(sourceFile, (child) => visit(child, rootScope));
  return scopes;
}

function collectDeclarationCounts(sourceFile: ts.SourceFile): Map<string, number> {
  const counts = new Map<string, number>();
  const addName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      counts.set(name.text, (counts.get(name.text) ?? 0) + 1);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) addName(element.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addName(node.name);
    else if (ts.isImportClause(node) && node.name) addName(node.name);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) addName(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) addName(node.name);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
}

function constantInitializerAt(node: ts.Node, name: string, context: StaticPathContext): ts.Expression | null {
  let scope = context.lexicalScopes.get(node) ?? null;
  while (scope) {
    if (scope.bindings.has(name)) return scope.bindings.get(name)?.initializer ?? null;
    scope = scope.parent;
  }
  return null;
}

function isNumericBindingAt(node: ts.Node, name: string, context: StaticPathContext): boolean {
  let scope = context.lexicalScopes.get(node) ?? null;
  while (scope) {
    if (scope.bindings.has(name)) return scope.bindings.get(name)?.numeric ?? false;
    scope = scope.parent;
  }
  return false;
}

function evaluateStaticPaths(
  expression: ts.Expression,
  context: StaticPathContext,
  seen = new Set<string>(),
): string[] | null {
  const candidate = unwrapExpression(expression);
  if (ts.isStringLiteralLike(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) return [candidate.text];
  if (ts.isTemplateExpression(candidate)) {
    let combinations = [candidate.head.text];
    for (const span of candidate.templateSpans) {
      const values = evaluateStaticPaths(span.expression, context, seen);
      if (!values) return null;
      combinations = combinations.flatMap((prefix) => values.map((value) => prefix + value + span.literal.text));
    }
    return combinations;
  }
  if (ts.isIdentifier(candidate)) {
    if (candidate.text === "__dirname") return [path.dirname(context.sourceFile.fileName)];
    if (candidate.text === "__filename") return [context.sourceFile.fileName];
    if (seen.has(candidate.text)) return null;
    const initializer = constantInitializerAt(candidate, candidate.text, context);
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
  const staticFunction = (() => {
    if (ts.isIdentifier(callee)) return context.moduleFunctions.get(callee.text) ?? null;
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
    const method = propertyNameText(callee);
    if (!method) return null;
    const receiver = unwrapExpression(callee.expression);
    let pathFlavor: "posix" | "win32" | undefined;
    let module = ts.isIdentifier(receiver)
      ? context.moduleNamespaces.get(receiver.text) ?? null
      : requiredStaticPathModule(receiver);
    if (
      !module
      && (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver))
      && (propertyNameText(receiver) === "posix" || propertyNameText(receiver) === "win32")
    ) {
      const base = unwrapExpression(receiver.expression);
      module = ts.isIdentifier(base) ? context.moduleNamespaces.get(base.text) ?? null : requiredStaticPathModule(base);
      pathFlavor = propertyNameText(receiver) as "posix" | "win32";
    }
    if (!module || !STATIC_PATH_MODULE_METHODS[module].has(method)) return null;
    return { module, method, pathFlavor } satisfies StaticModuleFunction;
  })();
  if (!staticFunction) return null;
  if (staticFunction.module === "os") {
    if (candidate.arguments.length !== 0) return null;
    return [staticFunction.method === "tmpdir" ? os.tmpdir() : os.homedir()];
  }
  if (staticFunction.module === "process") {
    return candidate.arguments.length === 0 ? [REPO_ROOT] : null;
  }

  const parts = candidate.arguments.map((argument) => evaluateStaticPaths(argument, context, seen));
  if (parts.some((part) => part === null)) return null;
  let combinations: string[][] = [[]];
  for (const part of parts as string[][]) {
    combinations = combinations.flatMap((prefix) => part.map((value) => [...prefix, value]));
  }
  const pathApi = staticFunction.pathFlavor ? path[staticFunction.pathFlavor] : path;
  switch (staticFunction.method) {
    case "join":
      return combinations.map((values) => pathApi.join(...values));
    case "resolve":
      return combinations.map((values) => pathApi.resolve(REPO_ROOT, ...values));
    case "normalize":
      return combinations.length > 0 && combinations.every((values) => values.length === 1)
        ? combinations.map(([value]) => pathApi.normalize(value))
        : null;
    case "basename":
      return combinations.length > 0 && combinations.every((values) => values.length === 1 || values.length === 2)
        ? combinations.map(([value, suffix]) => suffix === undefined ? pathApi.basename(value) : pathApi.basename(value, suffix))
        : null;
    case "dirname":
      return combinations.length > 0 && combinations.every((values) => values.length === 1)
        ? combinations.map(([value]) => pathApi.dirname(value))
        : null;
  }
  return null;
}

function resolvedRepositoryPath(sourceFile: ts.SourceFile, value: string, moduleSpecifier: boolean): string | null {
  const portableValue = value.split(/[\\/]+/).join(path.sep);
  if (moduleSpecifier && !portableValue.startsWith(".") && !path.isAbsolute(portableValue) && !/^data(?:[/\\]|$)/.test(value)) {
    return null;
  }
  if (path.isAbsolute(portableValue)) return path.normalize(portableValue);
  if (portableValue.startsWith(".")) return path.resolve(path.dirname(sourceFile.fileName), portableValue);
  return path.resolve(REPO_ROOT, portableValue);
}

function pathIsUnderData(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  return normalized === DATA_ROOT || normalized.startsWith(`${DATA_ROOT}${path.sep}`);
}

function isOnlyAllowedDataRead(sourceFile: ts.SourceFile, filePath: string): boolean {
  return relative(sourceFile.fileName) === "src/scripts/import-x-handles.ts"
    && path.resolve(filePath) === X_HANDLES_PATH;
}

function isAllowedDataWrite(sourceFile: ts.SourceFile, method: string, filePath: string): boolean {
  return ALLOWED_DATA_WRITES.has(`${relative(sourceFile.fileName)}:${method}:${relative(filePath)}`);
}

function isVerifiedSafeComputedFsRead(
  relativeFile: string,
  argument: ts.Expression,
  context: StaticPathContext,
): boolean {
  if (!ts.isIdentifier(argument)) return false;
  const expectedFilename = SAFE_COMPUTED_FS_READS[relativeFile]?.[argument.text];
  if (!expectedFilename) return false;
  const pathInitializer = constantInitializerAt(argument, argument.text, context);
  const baseInitializer = pathInitializer ? constantInitializerAt(pathInitializer, "base", context) : null;
  if (!pathInitializer || !baseInitializer) return false;
  const compact = (expression: ts.Expression): string => expression.getText(context.sourceFile).replace(/\s+/g, "");
  return compact(pathInitializer) === `path.join(base,"${expectedFilename}")`
    && compact(baseInitializer) === "promptDir||path.join(process.cwd(),\"docs\",\"prompts\",\"step1-3\")";
}

function isVerifiedSafeComputedFsWrite(
  relativeFile: string,
  method: string,
  argument: ts.Expression,
  context: StaticPathContext,
): boolean {
  const compact = (expression: ts.Expression): string => expression.getText(context.sourceFile).replace(/\s+/g, "");
  if (SAFE_COMPUTED_FS_WRITES.has(`${relativeFile}:${method}:${compact(argument)}`)) return true;
  if (relativeFile !== "src/scripts/contribute-source.ts") return false;

  const tempDir = constantInitializerAt(argument, "tempDir", context);
  if (!tempDir) return false;
  const safeCloneRoot = compact(tempDir) === 'fs.mkdtempSync(path.join(os.tmpdir(),"x-collector-community-"))';
  if (method === "rmSync") return safeCloneRoot && compact(argument) === "tempDir";
  const relativePath = constantInitializerAt(argument, "relativePath", context);
  const destination = constantInitializerAt(argument, "destination", context);
  if (!relativePath || !destination) return false;
  const cloneRelativeDestination = compact(relativePath) === '`data/community-sources/${filename}`'
    && compact(destination) === "path.join(tempDir,relativePath)";
  if (!safeCloneRoot || !cloneRelativeDestination) return false;
  const argumentText = compact(argument);
  return (method === "mkdirSync" && argumentText === "path.dirname(destination)")
    || (method === "writeFileSync" && argumentText === "destination");
}

type FilesystemAccess = "read" | "write";

function staticDataAccessOffenders(sourceFile: ts.SourceFile, access: FilesystemAccess): string[] {
  const context = staticPathContext(sourceFile);
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
      || candidate.arguments.length !== 1
    ) return null;
    const callee = unwrapExpression(candidate.expression);
    if (callee.kind !== ts.SyntaxKind.ImportKeyword && !(ts.isIdentifier(callee) && callee.text === "require")) return null;
    const specifier = moduleName(candidate.arguments[0])?.replace(/^node:/, "");
    return specifier === "fs" || specifier === "fs/promises" ? specifier : null;
  };

  const importHasValueBinding = (node: ts.ImportDeclaration): boolean => {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return false;
    if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
    return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
  };

  const collectFsAcquisitions = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && importHasValueBinding(node)) {
      const specifier = node.moduleSpecifier.text.replace(/^node:/, "");
      if (specifier === "fs" || specifier === "fs/promises") {
        const clause = node.importClause;
        if (clause?.name) fsNamespaces.add(clause.name.text);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) fsNamespaces.add(clause.namedBindings.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
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
  const fsDeclarationCounts = collectDeclarationCounts(sourceFile);
  for (const name of fsNamespaces) {
    if ((fsDeclarationCounts.get(name) ?? 0) !== 1) {
      fsNamespaces.delete(name);
      offenders.push(`${relativeFile}: fs acquisition binding is redeclared: ${name}`);
    }
  }
  for (const name of fsFunctions.keys()) {
    if ((fsDeclarationCounts.get(name) ?? 0) !== 1) {
      fsFunctions.delete(name);
      offenders.push(`${relativeFile}: fs acquisition binding is redeclared: ${name}`);
    }
  }

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
    let index = ancestors.length - 1;
    while (index >= 0 && (
      ts.isAwaitExpression(ancestors[index])
      || ts.isParenthesizedExpression(ancestors[index])
      || ts.isAsExpression(ancestors[index])
      || ts.isTypeAssertionExpression(ancestors[index])
      || ts.isNonNullExpression(ancestors[index])
      || ts.isSatisfiesExpression(ancestors[index])
    )) index -= 1;
    const parent = ancestors[index];
    const grandparent = ancestors[index - 1];
    const greatGrandparent = ancestors[index - 2];
    if (parent && ts.isVariableDeclaration(parent)) return true;
    if (!parent || (!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent))) return false;
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
      if (access === "read" && !moduleSpecifier && isVerifiedSafeComputedFsRead(relativeFile, argument, context)) return;
      if (access === "write" && isVerifiedSafeComputedFsWrite(relativeFile, method, argument, context)) return;
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      offenders.push(`${relativeFile}:${position.line + 1} ${method} has a non-literal ${access} path`);
      return;
    }
    for (const value of values) {
      const resolved = resolvedRepositoryPath(sourceFile, value, moduleSpecifier);
      const allowed = access === "read"
        ? isOnlyAllowedDataRead(sourceFile, resolved ?? "")
        : isAllowedDataWrite(sourceFile, method, resolved ?? "");
      if (resolved && pathIsUnderData(resolved) && !allowed) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        offenders.push(`${relativeFile}:${position.line + 1} ${method} ${access}s ${relative(resolved)}`);
      }
    }
  };

  const couldBePathArgument = (argument: ts.Expression): boolean => {
    const candidate = unwrapExpression(argument);
    const initializer = ts.isIdentifier(candidate) ? constantInitializerAt(candidate, candidate.text, context) : null;
    if (
      ts.isArrowFunction(candidate)
      || ts.isFunctionExpression(candidate)
      || ts.isObjectLiteralExpression(candidate)
      || ts.isNumericLiteral(candidate)
      || (initializer !== null && ts.isNumericLiteral(unwrapExpression(initializer)))
      || (ts.isIdentifier(candidate) && isNumericBindingAt(candidate, candidate.text, context))
      || candidate.kind === ts.SyntaxKind.TrueKeyword
      || candidate.kind === ts.SyntaxKind.FalseKeyword
      || candidate.kind === ts.SyntaxKind.NullKeyword
    ) return false;
    if (ts.isArrayLiteralExpression(candidate)) {
      return candidate.elements.some((element) => !ts.isSpreadElement(element) && couldBePathArgument(element));
    }
    return true;
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
      if (fsMethod) {
        const methodPathArguments = FS_PATH_ARGUMENTS[fsMethod];
        let argumentIndexes = methodPathArguments
          ? methodPathArguments[access] ?? []
          : (FS_DESCRIPTOR_FIRST_METHODS.has(fsMethod)
            ? []
            : node.arguments.flatMap((argument, index) => couldBePathArgument(argument) ? [index] : []));
        if (access === "write" && (fsMethod === "open" || fsMethod === "openSync")) {
          const flags = node.arguments[1] ? evaluateStaticPaths(node.arguments[1], context) : null;
          if (flags?.every((flag) => flag === "r" || flag === "rs" || flag === "sr")) argumentIndexes = [];
        }
        for (const argumentIndex of argumentIndexes) inspectArgument(node, fsMethod, argumentIndex);
      }
      if (access === "read" && callee.kind === ts.SyntaxKind.ImportKeyword) inspectArgument(node, "import", 0, true);
      if (access === "read" && ts.isIdentifier(callee) && callee.text === "require") inspectArgument(node, "require", 0, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function staticDataReadOffenders(sourceFile: ts.SourceFile): string[] {
  return staticDataAccessOffenders(sourceFile, "read");
}

function staticDataWriteOffenders(sourceFile: ts.SourceFile): string[] {
  return staticDataAccessOffenders(sourceFile, "write");
}

function staticPathBindingLeg(): void {
  const sourcePath = path.join(REPO_ROOT, "src", "__static-path-binding-regression.ts");
  const sourceFile = (source: string): ts.SourceFile => ts.createSourceFile(
    sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const analyze = (source: string): string[] => staticDataReadOffenders(sourceFile(source));
  const analyzeWrites = (source: string): string[] => staticDataWriteOffenders(sourceFile(source));
  const cases = [
    {
      label: "namespace path import",
      safe: `
        import * as fs from "fs";
        import * as os from "os";
        import * as path from "path";
        fs.mkdtempSync(path.join(os.tmpdir(), "zz-"));
      `,
      unsafe: `
        import * as fs from "fs";
        import * as path from "path";
        fs.readFileSync(path.join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "aliased namespace path import",
      safe: `
        import * as nodeFs from "node:fs";
        import * as hostOs from "node:os";
        import * as nodePath from "node:path";
        nodeFs.mkdtempSync(nodePath.join(hostOs.tmpdir(), "zz-"));
      `,
      unsafe: `
        import * as nodeFs from "node:fs";
        import * as nodePath from "node:path";
        nodeFs.readFileSync(nodePath.join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "named join import",
      safe: `
        import { mkdtempSync } from "fs";
        import { tmpdir } from "os";
        import { join } from "path";
        mkdtempSync(join(tmpdir(), "zz-"));
      `,
      unsafe: `
        import { readFileSync } from "fs";
        import { join } from "path";
        readFileSync(join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "template expression",
      safe: `
        import fs from "fs";
        fs.readFileSync(\`\${__dirname}/fixture.json\`, "utf8");
      `,
      unsafe: `
        import fs from "fs";
        fs.readFileSync(\`\${process.cwd()}/data/community-sources/fixture.json\`, "utf8");
      `,
    },
    {
      label: "path.posix.join",
      safe: `
        import fs from "fs";
        import path from "path";
        fs.readFileSync(path.posix.join("/tmp", "fixture.json"), "utf8");
      `,
      unsafe: `
        import fs from "fs";
        import path from "path";
        fs.readFileSync(path.posix.join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "path.win32.join",
      safe: `
        import fs from "fs";
        import path from "path";
        fs.readFileSync(path.win32.join("/tmp", "fixture.json"), "utf8");
      `,
      unsafe: `
        import fs from "fs";
        import path from "path";
        fs.readFileSync(path.win32.join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "destructured path namespace",
      safe: `
        import fs from "fs";
        import path from "path";
        const { join } = path;
        fs.readFileSync(join("/tmp", "fixture.json"), "utf8");
      `,
      unsafe: `
        import fs from "fs";
        import path from "path";
        const { join } = path;
        fs.readFileSync(join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
    {
      label: "path method rebinding",
      safe: `
        import fs from "fs";
        import path from "path";
        const join = path.join;
        fs.readFileSync(join("/tmp", "fixture.json"), "utf8");
      `,
      unsafe: `
        import fs from "fs";
        import path from "path";
        const join = path.join;
        fs.readFileSync(join(process.cwd(), "data", "community-sources", "fixture.json"), "utf8");
      `,
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(analyze(testCase.safe), [], `leg 5 path bindings: ${testCase.label} rejected a safe temp path`);
    const unsafeOffenders = analyze(testCase.unsafe);
    assert.ok(
      unsafeOffenders.some((offender) => offender.includes("reads data/community-sources/fixture.json")),
      `leg 5 path bindings: ${testCase.label} did not reject a community-source read: ${unsafeOffenders.join("; ")}`,
    );
    console.log(`PASS leg 5 path bindings: ${testCase.label} accepts temp paths and rejects data/community-sources`);
  }

  assert.deepEqual(
    analyze(`
      import { readFileSync } from "node:fs";
      import { homedir } from "node:os";
      import { cwd as processCwd } from "node:process";
      import {
        basename as pathBasename,
        dirname as pathDirname,
        join as pathJoin,
        normalize as pathNormalize,
        resolve as pathResolve,
      } from "node:path";
      readFileSync(pathJoin(homedir(), "fixture.json"), "utf8");
      readFileSync(pathResolve(processCwd(), "docs", "fixture.json"), "utf8");
      readFileSync(pathNormalize("/tmp/fixture.json"), "utf8");
      readFileSync(pathBasename("/tmp/fixture.json"), "utf8");
      readFileSync(pathDirname("/tmp/fixture.json"), "utf8");
    `),
    [],
    "leg 5 path bindings: named imports for a supported path method did not resolve",
  );

  assert.deepEqual(
    analyze(`
      const fs = require("node:fs");
      const osAlias = require("os");
      const processAlias = require("node:process");
      const pathAlias = require("node:path");
      const { join: joinAlias, resolve, normalize, basename, dirname } = require("path");
      import importEqualsPath = require("node:path");
      fs.mkdtempSync(pathAlias.join(osAlias.tmpdir(), "zz-"));
      fs.readFileSync(joinAlias(osAlias.homedir(), "fixture.json"), "utf8");
      fs.readFileSync(resolve(processAlias.cwd(), "docs", "fixture.json"), "utf8");
      fs.readFileSync(normalize("/tmp/fixture.json"), "utf8");
      fs.readFileSync(basename("/tmp/fixture.json"), "utf8");
      fs.readFileSync(dirname("/tmp/fixture.json"), "utf8");
      fs.readFileSync(require("path").join(osAlias.tmpdir(), "fixture.json"), "utf8");
      fs.readFileSync(importEqualsPath.join(osAlias.tmpdir(), "fixture.json"), "utf8");
    `),
    [],
    "leg 5 path bindings: require bindings or a supported path method did not resolve",
  );

  const localUnsafe = analyze(`
    import fs from "fs";
    function load() {
      const p = "data/community-sources/fixture.json";
      fs.readFileSync(p, "utf8");
    }
    const p = "/tmp/ok";
  `);
  assert.ok(
    localUnsafe.some((offender) => offender.includes("reads data/community-sources/fixture.json")),
    `leg 5 lexical constants: local data path was not reported: ${localUnsafe.join("; ")}`,
  );
  assert.deepEqual(
    analyze(`
      import fs from "fs";
      function load() {
        const p = "/tmp/ok";
        fs.readFileSync(p, "utf8");
      }
      const p = "data/community-sources/fixture.json";
    `),
    [],
    "leg 5 lexical constants: a safe local path was misattributed to a same-named outer binding",
  );

  assert.deepEqual(
    analyzeWrites(`
      import fs from "fs";
      fs.writeFileSync("/tmp/fixture.json", "ok");
      fs.openSync("data/community-sources/fixture.json", "r");
      function flush(fd: number) {
        fs.writeSync(fd, "ok");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.futureDescriptorApi(fd);
      }
    `),
    [],
    "leg 5 filesystem writes: descriptor APIs, numeric arguments, or a write outside data/ were rejected",
  );
  const unsafeWrite = analyzeWrites(`
    import fs from "fs";
    fs.writeFileSync("data/x-handles.json", "[]");
    fs.openSync("data/community-sources/created.json", "w");
  `);
  assert.ok(
    unsafeWrite.some((offender) => offender.includes("writes data/x-handles.json")),
    `leg 5 filesystem writes: data/x-handles.json write was not rejected: ${unsafeWrite.join("; ")}`,
  );
  const twoHopSource = `
    import fs from "fs";
    const entries = fs.readdirSync("data/community-sources");
    fs.writeFileSync("data/x-handles.json", JSON.stringify(entries));
  `;
  assert.ok(
    analyze(twoHopSource).some((offender) => offender.includes("reads data/community-sources"))
      && analyzeWrites(twoHopSource).some((offender) => offender.includes("writes data/x-handles.json")),
    "leg 5 filesystem writes: filesystem-mediated two-hop did not fail on both its read and write",
  );
  console.log("PASS leg 5 lexical constants, descriptor APIs, and repository data-write policy regressions");
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

    const followModule = (specifier: string): void => {
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

      visitFile(resolvedAbsolute);
    };

    const visitImports = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        followModule(node.moduleSpecifier.text);
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
    const initializer = constantInitializerAt(candidate, candidate.text, context);
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
    const context = staticPathContext(sourceFile);
    const networkNamespaces = new Set<string>();
    const networkFunctions = new Set<string>();
    const relativeFile = relative(sourceFile.fileName);

    const acquisitionAllowed = (specifier: string): boolean => {
      const allowed = ALLOWED_NETWORK_MODULE_ACQUISITIONS.has(`${relativeFile}:${specifier}`);
      if (!allowed) offenders.push(`${relativeFile}: network module acquisition is not allow-listed: ${specifier}`);
      return allowed;
    };

    const registerBindings = (name: ts.BindingName, specifier: string): void => {
      if (ts.isIdentifier(name)) {
        networkNamespaces.add(name.text);
        return;
      }
      if (!ts.isObjectBindingPattern(name)) return;
      for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const imported = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
          ? element.propertyName.text
          : element.name.text;
        if (`${relativeFile}:${specifier}:${imported}` !== "src/lib/net/safe-fetch.ts:net:isIP") {
          networkFunctions.add(element.name.text);
        }
      }
    };

    const requiredNetworkModule = (expression: ts.Expression): string | null => {
      const candidate = unwrapExpression(expression);
      if (
        !ts.isCallExpression(candidate)
        || candidate.arguments.length !== 1
        || !ts.isStringLiteralLike(candidate.arguments[0])
      ) return null;
      const callee = unwrapExpression(candidate.expression);
      if (callee.kind !== ts.SyntaxKind.ImportKeyword && !(ts.isIdentifier(callee) && callee.text === "require")) return null;
      const specifier = candidate.arguments[0].text.replace(/^node:/, "");
      return NETWORK_CAPABLE_BUILTINS.has(specifier) || KNOWN_HTTP_CLIENT_PACKAGES.has(specifier)
        ? specifier
        : null;
    };

    const importHasValueBinding = (node: ts.ImportDeclaration): boolean => {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) return false;
      if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
      return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
    };

    const isAcquiredNetworkFunction = (expression: ts.Expression): boolean => {
      const candidate = unwrapExpression(expression);
      if (ts.isIdentifier(candidate)) return networkFunctions.has(candidate.text);
      if (
        (ts.isPropertyAccessExpression(candidate) || ts.isElementAccessExpression(candidate))
        && ts.isIdentifier(candidate.expression)
      ) return networkNamespaces.has(candidate.expression.text);
      if (ts.isConditionalExpression(candidate)) {
        return isAcquiredNetworkFunction(candidate.whenTrue) || isAcquiredNetworkFunction(candidate.whenFalse);
      }
      return false;
    };

    const collectAcquisitionsAndAliases = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && importHasValueBinding(node)) {
        const specifier = node.moduleSpecifier.text.replace(/^node:/, "");
        if (NETWORK_CAPABLE_BUILTINS.has(specifier) || KNOWN_HTTP_CLIENT_PACKAGES.has(specifier)) {
          if (acquisitionAllowed(specifier)) {
            const clause = node.importClause;
            if (clause?.name) networkNamespaces.add(clause.name.text);
            if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
              networkNamespaces.add(clause.namedBindings.name.text);
            }
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) {
                if (element.isTypeOnly) continue;
                const imported = element.propertyName?.text ?? element.name.text;
                if (`${relativeFile}:${specifier}:${imported}` !== "src/lib/net/safe-fetch.ts:net:isIP") {
                  networkFunctions.add(element.name.text);
                }
              }
            }
          }
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const specifier = requiredNetworkModule(node.initializer);
        if (specifier && acquisitionAllowed(specifier)) registerBindings(node.name, specifier);
        if (ts.isIdentifier(node.name)) {
          const initializer = unwrapExpression(node.initializer);
          if (isAcquiredNetworkFunction(initializer)) networkFunctions.add(node.name.text);
        }
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
        && isAcquiredNetworkFunction(node.right)
      ) networkFunctions.add(node.left.text);
      ts.forEachChild(node, collectAcquisitionsAndAliases);
    };
    collectAcquisitionsAndAliases(sourceFile);
    const networkDeclarationCounts = collectDeclarationCounts(sourceFile);
    for (const name of networkNamespaces) {
      if ((networkDeclarationCounts.get(name) ?? 0) !== 1) {
        networkNamespaces.delete(name);
        offenders.push(`${relativeFile}: network module binding is redeclared: ${name}`);
      }
    }
    for (const name of networkFunctions) {
      if ((networkDeclarationCounts.get(name) ?? 0) !== 1) {
        networkFunctions.delete(name);
        offenders.push(`${relativeFile}: network module binding is redeclared: ${name}`);
      }
    }

    const inspectTarget = (node: ts.CallExpression): void => {
      const target = node.arguments[0];
      const values = target ? evaluateNetworkTargets(target, context) : null;
      if (!values || values.length === 0) {
        const targetText = target?.getText(sourceFile).replace(/\s+/g, " ").trim() ?? "<missing>";
        const readableAllowKey = `${relativeFile}:${targetText}`;
        const hashedAllowKey = `${relativeFile}:sha256:${createHash("sha256").update(node.getText(sourceFile)).digest("hex")}`;
        if (
          !ALLOWED_UNRESOLVED_NETWORK_TARGETS.has(readableAllowKey)
          && !ALLOWED_UNRESOLVED_NETWORK_TARGETS.has(hashedAllowKey)
        ) {
          offenders.push(`${sourcePosition(sourceFile, node)} network target is unresolvable (allow-list key ${hashedAllowKey})`);
        }
        return;
      }
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
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        const isFetch = ts.isIdentifier(callee) && callee.text === "fetch";
        const isGlobalFetch = ts.isPropertyAccessExpression(callee)
          && ts.isIdentifier(callee.expression)
          && callee.expression.text === "globalThis"
          && callee.name.text === "fetch";
        const isAcquiredFunction = isAcquiredNetworkFunction(callee);
        const isNamespaceMember = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
          && ts.isIdentifier(callee.expression)
          && networkNamespaces.has(callee.expression.text);
        const directSpecifier = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
          ? requiredNetworkModule(callee.expression)
          : null;
        if (directSpecifier) acquisitionAllowed(directSpecifier);
        if (isFetch || isGlobalFetch || isAcquiredFunction || isNamespaceMember || directSpecifier) inspectTarget(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return offenders.sort((left, right) => left.localeCompare(right));
}

function acquisitionRegressionLeg(): void {
  const sourcePath = path.join(REPO_ROOT, "src", "__acquisition-regression.ts");
  const sourceFile = (source: string): ts.SourceFile => ts.createSourceFile(
    sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );

  assert.deepEqual(
    networkTargetOffenders([sourceFile(`
      import { type IncomingMessage } from "http";
      import type { ClientRequest } from "https";
      const value: IncomingMessage | ClientRequest | null = null;
      void value;
    `)]),
    [],
    "leg 5 acquisitions: type-only network imports were treated as runtime acquisition",
  );
  assert.deepEqual(
    staticDataReadOffenders(sourceFile(`
      import { type PathLike } from "fs";
      import type { FileHandle } from "fs/promises";
      const value: PathLike | FileHandle | null = null;
      void value;
    `)),
    [],
    "leg 5 acquisitions: type-only filesystem imports were treated as runtime acquisition",
  );

  const dynamicFs = staticDataReadOffenders(sourceFile(`
    async function load() {
      const fs = await import("fs");
      fs.readFileSync("data/community-sources/fixture.json", "utf8");
    }
  `));
  assert.ok(
    dynamicFs.some((offender) => offender.includes("reads data/community-sources/fixture.json")),
    `leg 5 acquisitions: dynamic fs import was not registered: ${dynamicFs.join("; ")}`,
  );
  const dynamicNetwork = networkTargetOffenders([sourceFile(`
    async function load() {
      const http = await import("http");
      http.get("https://example.com");
    }
  `)]);
  assert.ok(
    dynamicNetwork.some((offender) => offender.includes("network module acquisition is not allow-listed: http")),
    `leg 5 acquisitions: dynamic network import was not registered: ${dynamicNetwork.join("; ")}`,
  );
  console.log("PASS leg 5 type-only and dynamic module acquisition regressions");
}

function assertWriterImportGraphsDoNotReadData(writerFiles: string[], sourceWriterFiles: string[]): void {
  // Scanned sets are intentionally different: data writes are checked across every repository source
  // file in databaseWriterLeg. Data reads and the community-sources literal are checked here only for
  // every recorded Prisma/raw-SQL writer plus its downward local import closure. Network targets are
  // checked for source/alertSource writers plus their downward local import closure.
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

function databaseWriterLeg(): boolean {
  const writes: Record<string, string[]> = {};
  const rawSql: Record<string, string[]> = {};
  const analysisOffenders: string[] = [];
  const rawDmlOffenders: string[] = [];
  const dataWriteOffenders: string[] = [];
  const sourceWriterFiles: string[] = [];

  for (const filePath of walkSourceFiles(REPO_ROOT, true)) {
    if (path.resolve(filePath) === path.resolve(__filename)) continue;
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath),
    );
    const fileWriteOffenders = staticDataWriteOffenders(sourceFile);
    dataWriteOffenders.push(...fileWriteOffenders);
    if (fileWriteOffenders.length > 0) dataWriteOffenders.push(...staticDataReadOffenders(sourceFile));
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
  if (process.argv.includes("--print-raw-sql-snapshot")) {
    console.log("EXPECTED_RAW_SQL_CALLS candidate:");
    console.log(JSON.stringify(normalizedRawSql, null, 2));
    console.log("Raw DML calls requiring explicit ALLOWED_RAW_DML_CALLS review:");
    console.log(rawDmlOffenders.length > 0 ? rawDmlOffenders.join("\n") : "(none)");
    return true;
  }
  assert.deepEqual(normalizedWrites, expectedWrites, "leg 5: repository-wide Prisma write call-site allow-list changed");
  assert.deepEqual(normalizedRawSql, expectedRawSql, "leg 5: Prisma raw-SQL allow-list changed");
  assert.deepEqual(rawDmlOffenders, [], "leg 5: non-allow-listed raw SQL DML found");
  assert.deepEqual(
    dataWriteOffenders.sort((left, right) => left.localeCompare(right)),
    [],
    `leg 5: repository-wide filesystem guard found unsafe access in a file that writes under data/: ${dataWriteOffenders.join("; ")}`,
  );
  const writerFiles = [...new Set([...Object.keys(writes), ...Object.keys(rawSql)])]
    .map((filePath) => path.join(REPO_ROOT, filePath));
  assertWriterImportGraphsDoNotReadData(writerFiles, sourceWriterFiles);
  return false;
}

async function main(): Promise<void> {
  assertRepositoryExtensionCoverage();
  assertFixtureIdentifiersAreValid();
  staticPathBindingLeg();
  acquisitionRegressionLeg();
  if (databaseWriterLeg()) return;
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
    console.log("PASS leg 4: package scripts and dependencies snapshot");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
