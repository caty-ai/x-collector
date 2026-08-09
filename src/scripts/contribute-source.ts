import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import {
  COMMUNITY_DIRECTORY,
  GITHUB_LOGIN_RE,
  HANDLE_RE,
  derivedFilename,
  validateCommunitySourceBuffer,
  type CommunitySource,
} from "./community/validate-community-source";

const UPSTREAM = "caty-ai/x-collector";
const DECLINES_PATH = path.resolve(process.cwd(), ".community-source-declines.json");

type DirectOptions = {
  handle: string;
  topic: string;
  language: string;
  firstSeen?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function parseDirectOptions(argv: string[]): DirectOptions | undefined {
  if (argv.length === 0) return undefined;
  const allowed = new Set(["--handle", "--topic", "--language", "--first-seen"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || value.startsWith("--") || values.has(flag)) {
      fail("usage: contribute:source [--handle <handle> --topic <topic> --language <code> [--first-seen <date>]]");
    }
    values.set(flag, value);
  }
  const handle = values.get("--handle");
  const topic = values.get("--topic");
  const language = values.get("--language");
  if (!handle || !topic || !language) fail("--handle, --topic, and --language are required together");
  return { handle, topic, language, firstSeen: values.get("--first-seen") };
}

function contributorLogin(): string {
  const login = process.env.COMMUNITY_SUBMITTED_BY ?? process.env.GITHUB_USER ?? "";
  if (!GITHUB_LOGIN_RE.test(login)) {
    fail("Set COMMUNITY_SUBMITTED_BY to your GitHub login before running this helper.");
  }
  return login;
}

function loadDeclines(): Set<string> {
  try {
    const value = JSON.parse(fs.readFileSync(DECLINES_PATH, "utf8")) as unknown;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && HANDLE_RE.test(item))) {
      fail(`${DECLINES_PATH} is invalid`);
    }
    return new Set(value.map((item) => item.toLowerCase()));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

function recordDecline(handle: string): void {
  const declines = loadDeclines();
  declines.add(handle.toLowerCase());
  fs.writeFileSync(DECLINES_PATH, `${JSON.stringify([...declines].sort(), null, 2)}\n`, { mode: 0o600 });
}

function existingCommunityHandles(): Set<string> {
  const handles = new Set<string>();
  for (const name of fs.readdirSync(COMMUNITY_DIRECTORY)) {
    if (name.startsWith("x--") && name.endsWith(".json")) handles.add(name.slice(3, -5));
  }
  return handles;
}

async function scanCandidate(): Promise<DirectOptions | undefined> {
  if (process.env.COMMUNITY_CONTRIBUTE_PROMPT !== "on") {
    console.log("Community contribution prompts are off. Use direct mode to contribute a specific handle.");
    return undefined;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const olderThan = new Date(Date.now() - 14 * 86_400_000);
    const rows = await prisma.source.findMany({
      where: { active: true, deactivatedAt: null, createdAt: { lte: olderThan } },
      orderBy: { createdAt: "asc" },
      select: { handle: true, createdAt: true },
    });
    const excluded = new Set([...existingCommunityHandles(), ...loadDeclines()]);
    const candidates = rows.filter((row) => !excluded.has(row.handle.toLowerCase()));
    if (candidates.length === 0) {
      console.log("No eligible community-source candidates were found.");
      return undefined;
    }

    console.log("Eligible sources:");
    candidates.forEach((row, index) => console.log(`${index + 1}. @${row.handle}`));
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const selection = Number(await rl.question("Choose a source number (blank to cancel): "));
      if (!Number.isInteger(selection) || selection < 1 || selection > candidates.length) return undefined;
      const candidate = candidates[selection - 1];
      const topic = await rl.question("Public topic (3-80 characters): ");
      const language = await rl.question("Language (for example en or ja-JP): ");
      return {
        handle: candidate.handle,
        topic,
        language,
        firstSeen: candidate.createdAt.toISOString().slice(0, 10),
      };
    } finally {
      rl.close();
    }
  } catch (error) {
    throw new Error(`Could not scan the local Source database: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await prisma.$disconnect();
  }
}

function buildSource(options: DirectOptions, submittedBy: string): CommunitySource {
  return {
    schema_version: 1,
    platform: "x",
    identifier: options.handle,
    topic: options.topic,
    language: options.language,
    submitted_by: submittedBy,
    first_seen: options.firstSeen ?? new Date().toISOString().slice(0, 10),
  };
}

function validateLocally(source: CommunitySource): { json: string; filename: string } {
  const json = `${JSON.stringify(source, null, 2)}\n`;
  const filename = derivedFilename(source);
  const result = validateCommunitySourceBuffer(Buffer.from(json, "utf8"), {
    filename,
    againstDir: COMMUNITY_DIRECTORY,
  });
  if (!result.ok) {
    for (const failure of result.failures) console.error(`FAIL ${failure.checkId}: ${failure.detail}`);
    fail("Local validation failed; no network action was taken.");
  }
  return { json, filename };
}

async function consent(source: CommunitySource, json: string, filename: string): Promise<boolean> {
  console.log("\nThe following exact JSON will be published:");
  console.log(json);
  console.log(`Destination: ${UPSTREAM} (public), data/community-sources/${filename}`);
  console.log("A merged entry is permanent and cannot be removed from git history.");
  console.log("The first_seen field discloses when you started following this source.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(`Publish @${source.identifier}? Type y to continue: `)) === "y";
  } finally {
    rl.close();
  }
}

function submit(source: CommunitySource, json: string, filename: string): void {
  run("gh", ["repo", "fork", UPSTREAM, "--clone=false"]);
  const actualLogin = run("gh", ["api", "user", "--jq", ".login"]);
  if (!GITHUB_LOGIN_RE.test(actualLogin) || actualLogin.toLowerCase() !== source.submitted_by.toLowerCase()) {
    fail("The authenticated GitHub login does not match COMMUNITY_SUBMITTED_BY.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-collector-community-"));
  try {
    run("gh", ["repo", "clone", `${actualLogin}/x-collector`, tempDir, "--", "--depth=1"]);
    run("git", ["remote", "add", "upstream", "https://github.com/caty-ai/x-collector.git"], tempDir);
    run("git", ["fetch", "--depth=1", "upstream", "main"], tempDir);
    const branch = `community/x--${source.identifier.toLowerCase()}`;
    run("git", ["checkout", "-b", branch, "FETCH_HEAD"], tempDir);

    const relativePath = `data/community-sources/${filename}`;
    const destination = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, json, { flag: "wx" });
    run("git", ["config", "user.name", actualLogin], tempDir);
    run("git", ["config", "user.email", `${actualLogin}@users.noreply.github.com`], tempDir);
    run("git", ["add", relativePath], tempDir);
    run("git", ["commit", "-m", `community: propose x source ${source.identifier}`], tempDir);
    const changed = run("git", ["diff", "--name-only", "FETCH_HEAD..HEAD"], tempDir);
    if (changed !== relativePath) fail("Submission diff contains a path other than the validated source file.");
    run("git", ["push", "origin", `HEAD:${branch}`], tempDir);

    const body = [
      "Community source contribution.",
      "",
      `- Platform: x`,
      `- Identifier: ${source.identifier}`,
      `- Topic: ${source.topic}`,
      `- Language: ${source.language}`,
      `- Submitted by: ${source.submitted_by}`,
      `- First seen: ${source.first_seen}`,
      "",
      "The contributor confirmed the permanence warning in the helper.",
    ].join("\n");
    run("gh", [
      "pr", "create", "--repo", UPSTREAM, "--base", "main", "--head", `${actualLogin}:${branch}`,
      "--title", `community: propose x source ${source.identifier}`, "--body", body,
    ], tempDir);
    console.log(`Submitted @${source.identifier} for validation.`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) fail("Interactive terminal required; no network action was taken.");
  const submittedBy = contributorLogin();
  const options = parseDirectOptions(process.argv.slice(2)) ?? await scanCandidate();
  if (!options) return;
  const source = buildSource(options, submittedBy);
  const { json, filename } = validateLocally(source);
  if (!(await consent(source, json, filename))) {
    recordDecline(source.identifier);
    console.log(`Declined @${source.identifier}; it will not be proposed again by scan mode.`);
    return;
  }
  submit(source, json, filename);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
