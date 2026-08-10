import fs from "fs";
import path from "path";
import { TextDecoder } from "util";
import { z } from "zod";
import { HANDLE_RE } from "../x-handle";

export { HANDLE_RE } from "../x-handle";

export enum CommunityCheckId {
  C1 = "C1",
  C2 = "C2",
  C3 = "C3",
  C4 = "C4",
  C5 = "C5",
  C6 = "C6",
  C7 = "C7",
  C8 = "C8",
  C9 = "C9",
  C10 = "C10",
}

export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const COMMUNITY_PATH_RE = /^data\/community-sources\/[a-z0-9][a-z0-9._-]{0,99}\.json$/;
export const COMMUNITY_DIRECTORY = path.resolve(process.cwd(), "data/community-sources");
export const MAX_SOURCE_BYTES = 2048;

const LANGUAGE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOPIC_CHARS_RE = /^[\p{L}\p{N} .,:;!?'"()&+\/-]+$/u;
const UNSAFE_TOPIC_RE = /[\p{Cc}\p{Cf}\u200B-\u200F\u202A-\u202E\u2060-\u206F]/u;
const RESERVED_ROUTES = new Set([
  "about", "account", "ads", "bookmarks", "business", "communities", "compose", "connect",
  "developers", "download", "explore", "followers", "following", "grok", "hashtag", "help",
  "home", "i", "intent", "lists", "login", "logout", "messages", "notifications", "privacy",
  "search", "settings", "share", "signin", "signup", "spaces", "status", "topics", "tos",
]);

const communitySourceSchema = z.object({
  schema_version: z.literal(1),
  platform: z.literal("x"),
  identifier: z.string(),
  topic: z.string(),
  language: z.string(),
  submitted_by: z.string(),
  first_seen: z.string(),
}).strict();

export type CommunitySource = z.infer<typeof communitySourceSchema>;

export type ValidationFailure = {
  checkId: CommunityCheckId;
  detail: string;
};

export type ValidationResult =
  | { ok: true; source: CommunitySource; dedupKey: string; filename: string }
  | { ok: false; failures: ValidationFailure[] };

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isRealUtcDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isReservedXRoute(handle: string): boolean {
  const lower = handle.toLowerCase();
  return RESERVED_ROUTES.has(lower) || /^[a-z]{2}$/.test(lower);
}

export function derivedFilename(source: Pick<CommunitySource, "identifier">): string {
  return `x--${source.identifier.toLowerCase()}.json`;
}

function decodeJson(buffer: Buffer): { value?: unknown; failure?: ValidationFailure } {
  if (buffer.length > MAX_SOURCE_BYTES) {
    return { failure: { checkId: CommunityCheckId.C4, detail: `decoded file exceeds ${MAX_SOURCE_BYTES} bytes` } };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { failure: { checkId: CommunityCheckId.C4, detail: "UTF-8 BOM is not allowed" } };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { failure: { checkId: CommunityCheckId.C4, detail: "file is not valid UTF-8" } };
  }

  try {
    return { value: JSON.parse(text) };
  } catch {
    return { failure: { checkId: CommunityCheckId.C4, detail: "file is not valid JSON" } };
  }
}

function schemaFailures(value: unknown): { source?: CommunitySource; failures: ValidationFailure[] } {
  const parsed = communitySourceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.map((issue) => ({
        checkId: CommunityCheckId.C4,
        detail: `schema ${issue.path.join(".") || "root"}: ${issue.message}`,
      })),
    };
  }

  const source = parsed.data;
  const failures: ValidationFailure[] = [];
  if (!HANDLE_RE.test(source.identifier)) {
    failures.push({ checkId: CommunityCheckId.C5, detail: "identifier must be 1-15 ASCII letters, digits, or underscores" });
  } else if (isReservedXRoute(source.identifier)) {
    failures.push({ checkId: CommunityCheckId.C5, detail: "identifier matches a reserved X route" });
  }
  if (
    source.topic.length < 3
    || source.topic.length > 80
    || !TOPIC_CHARS_RE.test(source.topic)
    || UNSAFE_TOPIC_RE.test(source.topic)
    || source.topic.includes("://")
    || source.topic.includes("\n")
    || source.topic.includes("\r")
  ) {
    failures.push({ checkId: CommunityCheckId.C7, detail: "topic does not satisfy the single-line length and character policy" });
  }
  if (!LANGUAGE_RE.test(source.language)) {
    failures.push({ checkId: CommunityCheckId.C4, detail: "language must match xx or xx-YY" });
  }
  if (!GITHUB_LOGIN_RE.test(source.submitted_by)) {
    failures.push({ checkId: CommunityCheckId.C4, detail: "submitted_by is not a valid GitHub login" });
  }
  if (
    !isRealUtcDate(source.first_seen)
    || source.first_seen < "2006-01-01"
    || source.first_seen > utcToday()
  ) {
    failures.push({ checkId: CommunityCheckId.C4, detail: "first_seen must be a real UTC date from 2006-01-01 through today" });
  }
  return { source, failures };
}

function duplicateFailures(source: CommunitySource, againstDir: string, currentFile?: string): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const current = currentFile ? path.resolve(currentFile) : undefined;
  const dedupKey = source.identifier.toLowerCase();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(againstDir, { withFileTypes: true });
  } catch (error) {
    return [{ checkId: CommunityCheckId.C6, detail: `cannot read comparison directory: ${String(error)}` }];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const candidatePath = path.resolve(againstDir, entry.name);
    if (candidatePath === current) continue;
    try {
      const decoded = decodeJson(fs.readFileSync(candidatePath));
      const parsed = communitySourceSchema.safeParse(decoded.value);
      if (parsed.success && parsed.data.identifier.toLowerCase() === dedupKey) {
        failures.push({ checkId: CommunityCheckId.C6, detail: `duplicate identifier already exists in ${entry.name}` });
      }
    } catch (error) {
      failures.push({ checkId: CommunityCheckId.C6, detail: `cannot inspect ${entry.name}: ${String(error)}` });
    }
  }
  return failures;
}

export function validateCommunitySourceBuffer(
  buffer: Buffer,
  options: { filename?: string; againstDir?: string; currentFile?: string } = {},
): ValidationResult {
  const decoded = decodeJson(buffer);
  if (decoded.failure) return { ok: false, failures: [decoded.failure] };
  const checked = schemaFailures(decoded.value);
  if (!checked.source) return { ok: false, failures: checked.failures };

  const filename = derivedFilename(checked.source);
  const failures = [...checked.failures];
  if (options.filename !== undefined && path.basename(options.filename) !== filename) {
    failures.push({ checkId: CommunityCheckId.C4, detail: `filename must be ${filename}` });
  }
  if (options.againstDir) {
    failures.push(...duplicateFailures(checked.source, options.againstDir, options.currentFile));
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, source: checked.source, dedupKey: checked.source.identifier.toLowerCase(), filename };
}

export function validateCommunitySourceFile(
  filePath: string,
  options: { againstDir?: string } = {},
): ValidationResult {
  try {
    return validateCommunitySourceBuffer(fs.readFileSync(filePath), {
      filename: filePath,
      againstDir: options.againstDir,
      currentFile: filePath,
    });
  } catch (error) {
    return { ok: false, failures: [{ checkId: CommunityCheckId.C4, detail: `cannot read file: ${String(error)}` }] };
  }
}

function parseArgs(argv: string[]): { mode: "file"; file: string; against?: string } | { mode: "all" } {
  if (argv.length === 1 && argv[0] === "--all") return { mode: "all" };
  if (argv[0] === "--file" && argv[1] && (argv.length === 2 || (argv.length === 4 && argv[2] === "--against" && argv[3]))) {
    return { mode: "file", file: argv[1], against: argv[3] };
  }
  throw new Error("usage: --file <path> [--against <dir>] | --all");
}

function printFailures(failures: ValidationFailure[]): void {
  for (const failure of failures) console.error(`FAIL ${failure.checkId}: ${failure.detail}`);
}

export function runValidatorCli(argv = process.argv.slice(2)): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (error) {
    printFailures([{ checkId: CommunityCheckId.C4, detail: String(error) }]);
    return 1;
  }

  if (args.mode === "file") {
    const result = validateCommunitySourceFile(path.resolve(args.file), {
      againstDir: args.against ? path.resolve(args.against) : undefined,
    });
    if (!result.ok) {
      printFailures(result.failures);
      return 1;
    }
    console.log("OK");
    return 0;
  }

  const failures: ValidationFailure[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(COMMUNITY_DIRECTORY).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    printFailures([{ checkId: CommunityCheckId.C4, detail: `cannot read community directory: ${String(error)}` }]);
    return 1;
  }
  for (const name of names) {
    const filePath = path.join(COMMUNITY_DIRECTORY, name);
    const result = validateCommunitySourceFile(filePath, { againstDir: COMMUNITY_DIRECTORY });
    if (!result.ok) failures.push(...result.failures);
  }
  if (failures.length > 0) {
    printFailures(failures);
    return 1;
  }
  console.log("OK");
  return 0;
}

if (require.main === module) process.exitCode = runValidatorCli();
