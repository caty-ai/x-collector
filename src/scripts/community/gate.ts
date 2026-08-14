import fs from "fs";
import path from "path";
import {
  COMMUNITY_PATH_RE,
  CommunityCheckId,
  GITHUB_LOGIN_RE,
  HANDLE_RE,
  MAX_SOURCE_BYTES,
  validateCommunitySourceBuffer,
} from "./validate-community-source";

const UPSTREAM = "caty-ai/x-collector";
const API_ROOT = "https://api.github.com";
const SHA_RE = /^[0-9a-f]{40}$/;
const COMPARE_FILE_STATUSES = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);
const SAFE_DEDUP_RE = /^[a-z0-9_]{1,15}$/;
const MAX_COMMUNITY_SUBMISSIONS_PER_30_DAYS = 3;
const COMMENT_MARKER = "<!-- community-sources-gate -->";
const CHECKS_URL = "https://github.com/caty-ai/x-collector/blob/main/docs/community-sources.md#checks";

enum GateErrorId {
  E1 = "E1",
  E2 = "E2",
  E3 = "E3",
}

enum ActFailureKind {
  HeadChanged = "head_changed",
  SourceExistsOnMain = "source_exists_on_main",
  SourceRecheckFailed = "source_recheck_failed",
  MergeRejected = "merge_rejected",
}

type CheckId = CommunityCheckId | GateErrorId;
type Verdict = "pass" | "fail" | "neutral_untouched" | "neutral_maintainer" | "error";

type Contract = {
  verdict: Verdict;
  pr_number: number;
  head_sha: string;
  failed_check_ids: CheckId[];
  identifier: string;
  submitted_by: string;
  dedup_key: string;
};

type PullRequestEvent = {
  action: string;
  number: number;
  repository: { full_name: string };
  pull_request: {
    number: number;
    author_association: string;
    user: { login: string };
    base: { ref: string; sha: string; repo: { full_name: string } };
    head: { sha: string; repo: { full_name: string } | null };
  };
};

type CompareFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  sha: string;
};

type CompareResponse = {
  files?: CompareFile[];
};

type ContentsFile = {
  type: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
};

type TreeResponse = {
  truncated: boolean;
  tree: Array<{ path: string; mode: string; type: string; sha: string }>;
};

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

class ActFailure extends Error {
  constructor(readonly kind: ActFailureKind, message: string) {
    super(message);
  }
}

function token(): string {
  const value = process.env.GITHUB_TOKEN;
  if (!value) throw new Error("GITHUB_TOKEN is required");
  return value;
}

async function github<T>(apiPath: string, init: RequestInit = {}): Promise<T> {
  if (!apiPath.startsWith("/")) throw new Error("GitHub API path must be absolute");
  const response = await fetch(`${API_ROOT}${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, `GitHub API returned ${response.status}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function emptyContract(verdict: Verdict, prNumber: number, headSha: string, ids: CheckId[] = []): Contract {
  return {
    verdict,
    pr_number: prNumber,
    head_sha: headSha,
    failed_check_ids: [...new Set(ids)],
    identifier: "",
    submitted_by: "",
    dedup_key: "",
  };
}

function readEvent(): PullRequestEvent {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  return JSON.parse(fs.readFileSync(eventPath, "utf8")) as PullRequestEvent;
}

function basicEventValues(event: PullRequestEvent): { prNumber: number; headSha: string } {
  const prNumber = Number.isSafeInteger(event?.pull_request?.number) && event.pull_request.number > 0
    ? event.pull_request.number
    : 0;
  const headSha = typeof event?.pull_request?.head?.sha === "string" && SHA_RE.test(event.pull_request.head.sha)
    ? event.pull_request.head.sha
    : "";
  return { prNumber, headSha };
}

function preconditionsPass(event: PullRequestEvent): boolean {
  const pr = event?.pull_request;
  return Boolean(
    pr
    && Number.isSafeInteger(pr.number)
    && pr.number > 0
    && event.number === pr.number
    && event.repository?.full_name === UPSTREAM
    && pr.base?.ref === "main"
    && pr.base?.repo?.full_name === UPSTREAM
    && SHA_RE.test(pr.base?.sha ?? "")
    && SHA_RE.test(pr.head?.sha ?? "")
    && GITHUB_LOGIN_RE.test(pr.user?.login ?? "")
    && pr.head?.repo?.full_name
  );
}

function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

async function compareSnapshot(baseSha: string, headSha: string): Promise<{ files: CompareFile[] }> {
  const response = await github<CompareResponse>(`/repos/${UPSTREAM}/compare/${baseSha}...${headSha}`);
  const files = response.files;
  if (
    !Array.isArray(files)
    || files.length < 1
    || files.length >= 300
    || files.some((file) => (
      typeof file?.filename !== "string"
      || file.filename.length === 0
      || typeof file.status !== "string"
      || file.status.length === 0
      || !COMPARE_FILE_STATUSES.has(file.status)
      || typeof file.sha !== "string"
      || !SHA_RE.test(file.sha)
      || (file.previous_filename !== undefined && (
        typeof file.previous_filename !== "string"
        || file.previous_filename.length === 0
      ))
      || (file.status === "renamed" && file.previous_filename === undefined)
    ))
  ) {
    throw new Error("compare response failed the completeness assertion");
  }
  return { files };
}

async function readTree(headSha: string): Promise<TreeResponse> {
  const tree = await github<TreeResponse>(`/repos/${UPSTREAM}/git/trees/${headSha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("git tree response was truncated or invalid");
  return tree;
}

async function readPinnedContent(filePath: string, ref: string): Promise<ContentsFile> {
  if (!SHA_RE.test(ref)) throw new Error("content ref is not a full SHA");
  return await github<ContentsFile>(`/repos/${UPSTREAM}/contents/${encodePath(filePath)}?ref=${ref}`);
}

async function baseHasDedupKey(dedupKey: string, baseSha: string): Promise<boolean> {
  const expectedPath = `data/community-sources/x--${dedupKey}.json`;
  try {
    await readPinnedContent(expectedPath, baseSha);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

async function accountIsOldEnough(login: string): Promise<boolean> {
  const rawDays = process.env.MIN_ACCOUNT_AGE_DAYS;
  if (!rawDays || !/^\d+$/.test(rawDays)) return false;
  const days = Number(rawDays);
  if (!Number.isSafeInteger(days) || days < 0) return false;
  try {
    const user = await github<{ created_at?: string }>(`/users/${login}`);
    if (!user.created_at) return false;
    const created = new Date(user.created_at);
    return !Number.isNaN(created.getTime()) && Date.now() - created.getTime() >= days * 86_400_000;
  } catch {
    return false;
  }
}

async function recentSubmissionCount(login: string, baseSha: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const foldedLogin = login.toLowerCase();
  let count = 0;

  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      path: "data/community-sources",
      since,
      sha: baseSha,
      per_page: "100",
      page: String(page),
    });
    const commits = await github<Array<{ sha: string }>>(`/repos/${UPSTREAM}/commits?${query.toString()}`);
    for (const commit of commits) {
      if (!SHA_RE.test(commit.sha)) throw new Error("commits API returned an invalid SHA");
      const detail = await github<{ files?: CompareFile[] }>(`/repos/${UPSTREAM}/commits/${commit.sha}`);
      for (const file of detail.files ?? []) {
        if (file.status !== "added" || !COMMUNITY_PATH_RE.test(file.filename)) continue;
        try {
          const content = await readPinnedContent(file.filename, commit.sha);
          if (content.type !== "file" || content.encoding !== "base64" || typeof content.content !== "string") {
            throw new Error("community-source content was not inspectable");
          }
          const parsed = validateCommunitySourceBuffer(Buffer.from(content.content.replace(/\s/g, ""), "base64"), {
            filename: file.filename,
          });
          if (parsed.ok && parsed.source.submitted_by.toLowerCase() === foldedLogin) count++;
          if (count >= MAX_COMMUNITY_SUBMISSIONS_PER_30_DAYS) return count;
        } catch {
          throw new Error("could not inspect a recent community-source commit");
        }
      }
    }
    if (commits.length < 100) break;
  }
  return count;
}

async function validateMode(): Promise<Contract> {
  let event: PullRequestEvent;
  try {
    event = readEvent();
  } catch {
    return emptyContract("error", 0, "", [GateErrorId.E1]);
  }
  const { prNumber, headSha } = basicEventValues(event);
  if (!preconditionsPass(event)) return emptyContract("error", prNumber, headSha, [GateErrorId.E1]);

  let snapshot: { files: CompareFile[] };
  try {
    snapshot = await compareSnapshot(event.pull_request.base.sha, event.pull_request.head.sha);
  } catch {
    return emptyContract("error", prNumber, headSha, [GateErrorId.E2]);
  }

  const touchesCommunity = snapshot.files.some((file) => (
    file.filename.startsWith("data/community-sources/")
    || file.previous_filename?.startsWith("data/community-sources/")
  ));
  if (!touchesCommunity) return emptyContract("neutral_untouched", prNumber, headSha);

  const trusted = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
  if (
    trusted.has(event.pull_request.author_association)
    && event.pull_request.head.repo?.full_name === event.pull_request.base.repo.full_name
  ) {
    return emptyContract("neutral_maintainer", prNumber, headSha);
  }

  const failed = new Set<CheckId>();
  const onlyFile = snapshot.files.length === 1 ? snapshot.files[0] : undefined;
  if (!snapshot.files.every((file) => COMMUNITY_PATH_RE.test(file.filename))) failed.add(CommunityCheckId.C1);
  if (snapshot.files.length !== 1 || !onlyFile || onlyFile.status !== "added") failed.add(CommunityCheckId.C2);

  let content: ContentsFile | undefined;
  if (!failed.has(CommunityCheckId.C1) && !failed.has(CommunityCheckId.C2) && onlyFile) {
    try {
      const tree = await readTree(headSha);
      const treeEntry = tree.tree.find((entry) => entry.path === onlyFile.filename);
      content = await readPinnedContent(onlyFile.filename, headSha);
      if (
        !treeEntry
        || treeEntry.mode !== "100644"
        || treeEntry.type !== "blob"
        || treeEntry.sha !== onlyFile.sha
        || content.type !== "file"
        || content.sha !== onlyFile.sha
      ) {
        failed.add(CommunityCheckId.C3);
      }
    } catch {
      failed.add(CommunityCheckId.C3);
    }
  }

  let validated: ReturnType<typeof validateCommunitySourceBuffer> | undefined;
  if (
    !failed.has(CommunityCheckId.C1)
    && !failed.has(CommunityCheckId.C2)
    && !failed.has(CommunityCheckId.C3)
    && onlyFile
    && content
  ) {
    if (
      content.encoding !== "base64"
      || typeof content.content !== "string"
      || !Number.isSafeInteger(content.size)
      || content.size > MAX_SOURCE_BYTES
    ) {
      failed.add(CommunityCheckId.C4);
    } else {
      validated = validateCommunitySourceBuffer(Buffer.from(content.content.replace(/\s/g, ""), "base64"), {
        filename: onlyFile.filename,
      });
      if (!validated.ok) for (const failure of validated.failures) failed.add(failure.checkId);
    }
  }

  if (validated?.ok) {
    try {
      if (await baseHasDedupKey(validated.dedupKey, event.pull_request.base.sha)) failed.add(CommunityCheckId.C6);
    } catch {
      failed.add(CommunityCheckId.C6);
    }
    if (validated.source.submitted_by.toLowerCase() !== event.pull_request.user.login.toLowerCase()) {
      failed.add(CommunityCheckId.C8);
    }
    if (!(await accountIsOldEnough(event.pull_request.user.login))) failed.add(CommunityCheckId.C9);
    try {
      const recentCount = await recentSubmissionCount(event.pull_request.user.login, event.pull_request.base.sha);
      if (recentCount >= MAX_COMMUNITY_SUBMISSIONS_PER_30_DAYS) failed.add(CommunityCheckId.C10);
    } catch {
      failed.add(CommunityCheckId.C10);
    }
  }

  if (failed.size > 0 || !validated?.ok) {
    if (failed.size === 0) failed.add(CommunityCheckId.C4);
    return emptyContract("fail", prNumber, headSha, [...failed]);
  }
  return {
    verdict: "pass",
    pr_number: prNumber,
    head_sha: headSha,
    failed_check_ids: [],
    identifier: validated.source.identifier,
    submitted_by: validated.source.submitted_by,
    dedup_key: validated.dedupKey,
  };
}

function writeContract(contract: Contract): void {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required in validate mode");
  const values: Record<string, string> = {
    verdict: contract.verdict,
    pr_number: String(contract.pr_number),
    head_sha: contract.head_sha,
    failed_check_ids: contract.failed_check_ids.join(","),
    identifier: contract.identifier,
    submitted_by: contract.submitted_by,
    dedup_key: contract.dedup_key,
  };
  for (const [key, value] of Object.entries(values)) fs.appendFileSync(output, `${key}=${value}\n`);
}

const ALL_CHECK_IDS = new Set<string>([
  ...Object.values(CommunityCheckId),
  ...Object.values(GateErrorId),
]);

function contractFromEnvironment(): Contract {
  const verdict = process.env.CONTRACT_VERDICT;
  if (!(["pass", "fail", "neutral_untouched", "neutral_maintainer", "error"] as string[]).includes(verdict ?? "")) {
    throw new Error("invalid contract verdict");
  }
  const prNumberText = process.env.CONTRACT_PR_NUMBER ?? "";
  const prNumber = Number(prNumberText);
  const headSha = process.env.CONTRACT_HEAD_SHA ?? "";
  if (!/^\d+$/.test(prNumberText) || !Number.isSafeInteger(prNumber) || prNumber < 0) {
    throw new Error("invalid contract pull request number");
  }
  if (verdict === "pass") {
    if (prNumber < 1 || !SHA_RE.test(headSha)) throw new Error("invalid contract identity");
  } else if (headSha !== "" && !SHA_RE.test(headSha)) {
    throw new Error("invalid contract head SHA");
  }
  const rawIds = process.env.CONTRACT_FAILED_CHECK_IDS ?? "";
  const failedIds = rawIds === "" ? [] : rawIds.split(",");
  if (!failedIds.every((id) => ALL_CHECK_IDS.has(id))) throw new Error("invalid contract check IDs");
  const identifier = process.env.CONTRACT_IDENTIFIER ?? "";
  const submittedBy = process.env.CONTRACT_SUBMITTED_BY ?? "";
  const dedupKey = process.env.CONTRACT_DEDUP_KEY ?? "";
  if (verdict === "pass") {
    if (!HANDLE_RE.test(identifier) || !GITHUB_LOGIN_RE.test(submittedBy) || !SAFE_DEDUP_RE.test(dedupKey)) {
      throw new Error("invalid validated fields in contract");
    }
    if (identifier.toLowerCase() !== dedupKey) throw new Error("contract dedup key mismatch");
  } else if (identifier !== "" || submittedBy !== "" || dedupKey !== "") {
    throw new Error("non-pass contract carried content fields");
  }
  return {
    verdict: verdict as Verdict,
    pr_number: prNumber,
    head_sha: headSha,
    failed_check_ids: failedIds as CheckId[],
    identifier,
    submitted_by: submittedBy,
    dedup_key: dedupKey,
  };
}

function renderComment(contract: Contract, kind?: ActFailureKind): string {
  if (kind === ActFailureKind.HeadChanged) {
    return `${COMMENT_MARKER}\nThe pull request head SHA changed after validation. The gate stopped before merging; rerun validation on the current head.`;
  }
  if (kind === ActFailureKind.SourceExistsOnMain) {
    return `${COMMENT_MARKER}\nThe source dedup key now exists on the latest \`main\`. The gate stopped before merging to avoid duplicating a community entry.`;
  }
  if (kind === ActFailureKind.SourceRecheckFailed) {
    return `${COMMENT_MARKER}\nThe gate could not re-check the latest \`main\` state before merging. A maintainer must inspect the workflow run; the gate will not retry blindly.`;
  }
  if (kind === ActFailureKind.MergeRejected) {
    return `${COMMENT_MARKER}\nThe merge API rejected the validated merge attempt. A maintainer must inspect the workflow run; the gate will not retry blindly.`;
  }
  if (contract.verdict === "neutral_maintainer") {
    return `${COMMENT_MARKER}\nThis same-repository maintainer pull request touches the community list. The contribution gate is informational and will not merge it.`;
  }
  if (contract.verdict === "pass") {
    return `${COMMENT_MARKER}\nCommunity source validation passed for this exact head SHA. Automatic merge is disabled; a maintainer may merge after the required check completes.`;
  }
  const ids = contract.failed_check_ids.length > 0
    ? contract.failed_check_ids.map((id) => `- \`${id}\``).join("\n")
    : "- `E3`";
  return `${COMMENT_MARKER}\nCommunity source validation did not pass.\n\n${ids}\n\nSee the [check catalog](${CHECKS_URL}).`;
}

async function upsertStickyComment(prNumber: number, body: string): Promise<void> {
  const comments = await github<Array<{ id: number; body?: string }>>(`/repos/${UPSTREAM}/issues/${prNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing) {
    await github(`/repos/${UPSTREAM}/issues/comments/${existing.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
  } else {
    await github(`/repos/${UPSTREAM}/issues/${prNumber}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  }
}

async function addLabel(prNumber: number, label: string): Promise<void> {
  await github(`/repos/${UPSTREAM}/issues/${prNumber}/labels`, { method: "POST", body: JSON.stringify({ labels: [label] }) });
}

async function removeLabel(prNumber: number, label: string): Promise<void> {
  try {
    await github(`/repos/${UPSTREAM}/issues/${prNumber}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
}

async function latestMainHasDedupKey(dedupKey: string): Promise<boolean> {
  const ref = await github<{ object: { sha: string } }>(`/repos/${UPSTREAM}/git/ref/heads/main`);
  if (!SHA_RE.test(ref.object.sha)) throw new Error("main ref returned an invalid SHA");
  const tree = await readTree(ref.object.sha);
  return tree.tree.some((entry) => entry.path === `data/community-sources/x--${dedupKey}.json`);
}

function hasPullRequestIdentity(contract: Contract): boolean {
  return contract.pr_number >= 1;
}

async function actMode(): Promise<number> {
  const contract = contractFromEnvironment();
  if (hasPullRequestIdentity(contract)) {
    await removeLabel(contract.pr_number, "community-source:validated");
  }

  if (contract.verdict === "neutral_untouched") return 0;
  if (contract.verdict === "neutral_maintainer") {
    if (!hasPullRequestIdentity(contract)) return 0;
    await upsertStickyComment(contract.pr_number, renderComment(contract));
    return 0;
  }
  if (contract.verdict === "fail" || contract.verdict === "error") {
    if (!hasPullRequestIdentity(contract)) return 1;
    await addLabel(contract.pr_number, "community-source:rejected");
    await upsertStickyComment(contract.pr_number, renderComment(contract));
    return 1;
  }

  await removeLabel(contract.pr_number, "community-source:rejected");
  if (process.env.AUTO_MERGE !== "true") {
    await addLabel(contract.pr_number, "community-source:validated");
    await upsertStickyComment(contract.pr_number, renderComment(contract));
    return 0;
  }

  try {
    const pull = await github<{ head: { sha: string } }>(`/repos/${UPSTREAM}/pulls/${contract.pr_number}`);
    if (pull.head.sha !== contract.head_sha) {
      throw new ActFailure(ActFailureKind.HeadChanged, "pull request head changed after validation");
    }
    let sourceExistsOnMain: boolean;
    try {
      sourceExistsOnMain = await latestMainHasDedupKey(contract.dedup_key);
    } catch {
      throw new ActFailure(ActFailureKind.SourceRecheckFailed, "could not re-check the latest main state");
    }
    if (sourceExistsOnMain) {
      throw new ActFailure(ActFailureKind.SourceExistsOnMain, "source now exists on main");
    }
    try {
      await github(`/repos/${UPSTREAM}/pulls/${contract.pr_number}/merge`, {
        method: "PUT",
        body: JSON.stringify({
          sha: contract.head_sha,
          merge_method: "squash",
          commit_title: `community: add x source ${contract.identifier}`,
          commit_message: `Submitted by ${contract.submitted_by}. Validated by the community-sources gate. PR #${contract.pr_number}.`,
        }),
      });
    } catch {
      throw new ActFailure(ActFailureKind.MergeRejected, "merge API rejected the validated merge attempt");
    }
    return 0;
  } catch (error) {
    const kind = error instanceof ActFailure ? error.kind : ActFailureKind.MergeRejected;
    await upsertStickyComment(contract.pr_number, renderComment(contract, kind));
    return 1;
  }
}

async function main(): Promise<number> {
  const mode = process.env.COMMUNITY_GATE_MODE;
  if (mode === "validate") {
    const contract = await validateMode();
    writeContract(contract);
    return 0;
  }
  if (mode === "act") return await actMode();
  throw new Error("COMMUNITY_GATE_MODE must be validate or act");
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(error instanceof Error ? error.message : "community gate failed");
  process.exitCode = 1;
});
