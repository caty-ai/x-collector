/**
 * Community sources are discoverable data, never subscription input.
 *
 * This suite is a strong tripwire against maintainer regressions, not a proof. An implementation
 * review demonstrated a seventh evasion against the first implementation; this version closes it by
 * running leg 1 against a discriminating temporary fixture and by failing leg 3 on any writer child
 * process spawn.
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
const DATA_ROOT = path.join(REPO_ROOT, "data");
const COMMUNITY_DIR = path.join(DATA_ROOT, "community-sources");
const X_HANDLES_PATH = path.join(DATA_ROOT, "x-handles.json");
const SENTINEL_IDENTIFIER = "ZZSentinelSource";
const SENTINEL_KEY = SENTINEL_IDENTIFIER.toLowerCase();
const SENTINEL_FILENAME = `x--${SENTINEL_KEY}.json`;
const API_ROUTE_ROOTS = [
  "src/app/api/sources/route.ts",
  "src/app/api/alert-sources/route.ts",
] as const;

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

const EXPECTED_RAW_SQL_CALLS: Record<string, string[]> = {
  "src/app/api/family-feed/route.ts": ["$queryRaw"],
  "src/collector/discover.ts": ["$queryRaw"],
  "src/collector/source-score.ts": ["$queryRaw"],
  "src/lib/pipeline/topic-cluster.ts": ["$executeRaw", "$queryRaw"],
};
const PRISMA_MODELS = new Set(["source", "alertSource"]);
const PRISMA_WRITE_METHODS = new Set(["create", "upsert", "createMany", "update", "updateMany", "delete", "deleteMany"]);
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

type DelegateModel = "source" | "alertSource";

type PrismaAnalysis = {
  writes: string[];
  rawSql: string[];
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
function record(event) {
  try {
    append(trace, JSON.stringify(event) + "\\n");
  } catch {}
}
function normalizePath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return String(value);
}
function wrapPathMethod(target, name) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function(pathValue, ...args) {
    record({ kind: "path", method: name, value: normalizePath(pathValue) });
    return original.call(this, pathValue, ...args);
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
for (const name of ["readFileSync", "readFile", "createReadStream", "openSync", "open", "readdirSync", "readdir"]) {
  wrapPathMethod(fs, name);
}
for (const name of ["readFile", "open", "readdir"]) {
  wrapPathMethod(fs.promises, name);
}
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
    const fixtureXHandleIds = new Set(xHandleIdentifiers(fixtureXHandlesPath));

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
      data: { handle: "ManualSource", status: "approved", mentionCount: 1 },
    });

    const { hookPath, tracePath } = createTraceHook(tempDir);
    for (const writer of WRITER_COMMANDS) {
      runWriter(fixture.repoRoot, writer.label, [...writer.args], hookPath, database);
    }

    const actual = (await prisma.source.findMany({ select: { handle: true }, orderBy: { handle: "asc" } }))
      .map((row) => row.handle)
      .sort((left, right) => left.localeCompare(right));
    const nonCommunity = JSON.parse(fs.readFileSync(fixtureXHandlesPath, "utf8")) as Array<{ handle: string }>;
    const expected = [...new Set([...nonCommunity.map((entry) => entry.handle), "ManualSource"])]
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
  return filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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
  const name = bindingIdentifier(node.name);
  if (!name || !node.initializer) return;
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
  const analysis: PrismaAnalysis = { writes: [], rawSql: [] };

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

    ts.forEachChild(node, (child) => visit(child, scope));
  };

  visit(sourceFile, { clients: new Set(), delegates: new Map() });
  analysis.writes.sort();
  analysis.rawSql.sort();
  return analysis;
}

function dataPathRegex(): RegExp {
  return /(^|[./\\])data(?:[/\\]|$)/;
}

function collectDataPathLiterals(sourceFile: ts.SourceFile): string[] {
  const literals = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      const text = node.text.trim();
      if (text === "data" || dataPathRegex().test(text)) {
        literals.add(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...literals].sort((left, right) => left.localeCompare(right));
}

function assertApiRouteImportGraphsDoNotReadData(): void {
  const appParsed = readTsConfig("tsconfig.json", "leg 5");
  const rootNames = API_ROUTE_ROOTS.map((relativePath) => path.join(REPO_ROOT, relativePath));
  const program = ts.createProgram({ rootNames, options: appParsed.options });
  const reachable = program.getSourceFiles()
    .filter((source) => !source.isDeclarationFile)
    .filter((source) => path.resolve(source.fileName).startsWith(`${SRC_ROOT}${path.sep}`));

  const offenders: string[] = [];
  for (const sourceFile of reachable) {
    const literals = collectDataPathLiterals(sourceFile);
    if (literals.length > 0) {
      offenders.push(`${relative(sourceFile.fileName)} -> ${literals.join(", ")}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `leg 5: API source route import graph must not read under data/: ${offenders.join("; ")}`,
  );
}

function databaseWriterLeg(): void {
  const writes: Record<string, string[]> = {};
  const rawSql: Record<string, string[]> = {};

  for (const filePath of walkSourceFiles(SRC_ROOT)) {
    if (filePath === __filename) continue;
    const analysis = analyzePrismaFile(filePath);
    if (analysis.writes.length > 0) writes[relative(filePath)] = analysis.writes;
    if (analysis.rawSql.length > 0) rawSql[relative(filePath)] = analysis.rawSql;
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

  assert.deepEqual(normalizedWrites, expectedWrites, "leg 5: Source/AlertSource write call-site allow-list changed");
  assert.deepEqual(normalizedRawSql, expectedRawSql, "leg 5: Prisma raw-SQL allow-list changed");
  assertApiRouteImportGraphsDoNotReadData();
}

async function main(): Promise<void> {
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
    databaseWriterLeg();
    console.log("PASS leg 5: AST DB-writer allow-list, raw-SQL allow-list, and API no-data-read graph");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
