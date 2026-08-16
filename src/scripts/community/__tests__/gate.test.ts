import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Route = {
  body: unknown;
  method?: string;
  path: string;
  query?: Record<string, string>;
  status?: number;
};

type GateRunResult = {
  contract: {
    dedupKey: string;
    failedCheckIds: string[];
    headSha: string;
    identifier: string;
    prNumber: number;
    submittedBy: string;
    verdict: string;
  };
  status: number | null;
  stderr: string;
  stdout: string;
};

type RequestLogEntry = {
  body: unknown;
  matched: boolean;
  method: string;
  pathname: string;
  query: Record<string, string>;
  search: string;
};

type ActRunResult = {
  requests: RequestLogEntry[];
  status: number | null;
  stderr: string;
  stdout: string;
};

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE_PATH = path.join(REPO_ROOT, "src/scripts/community/__tests__/fixtures/compare-pr10.json");
const RUNNER_PATH = path.join(REPO_ROOT, "src/scripts/community/__tests__/helpers/gate-runner.cjs");
const DEFAULT_GATE_PATH = path.join(REPO_ROOT, "src/scripts/community/gate.ts");
const GATE_PATH = process.env.COMMUNITY_GATE_TEST_SCRIPT_PATH
  ? path.resolve(process.env.COMMUNITY_GATE_TEST_SCRIPT_PATH)
  : DEFAULT_GATE_PATH;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const FILE_SHA = "c".repeat(40);
const COMMIT_SHA = "d".repeat(40);
const MAIN_SHA = "e".repeat(40);
const COMMITS_PER_PAGE = 100;
const MAX_COMMIT_LIST_PAGES = 30;
const COMMIT_FILES_PER_PAGE = 100;
const MAX_COMMIT_FILE_PAGES = 30;
const COMMENT_MARKER = "<!-- community-sources-gate -->";
const COMMUNITY_FILE_PATH = "data/community-sources/x--openaitest.json";
const LABELS_PATH = "/repos/caty-ai/x-collector/issues/10/labels";
const MERGE_PATH = "/repos/caty-ai/x-collector/pulls/10/merge";
const COMMENTS_PATH = "/repos/caty-ai/x-collector/issues/10/comments";
const VALIDATED_LABEL_PATH = `${LABELS_PATH}/community-source%3Avalidated`;
const REJECTED_LABEL_PATH = `${LABELS_PATH}/community-source%3Arejected`;
const CHECK_CATALOG_URL = "https://github.com/caty-ai/x-collector/blob/main/docs/community-sources.md#checks";
const HEAD_CHANGED_COMMENT = `${COMMENT_MARKER}\nThe pull request head SHA changed after validation. The gate stopped before merging; rerun validation on the current head.`;
const SOURCE_EXISTS_ON_MAIN_COMMENT = `${COMMENT_MARKER}\nThe source dedup key now exists on the latest \`main\`. The gate stopped before merging to avoid duplicating a community entry.`;
const SOURCE_RECHECK_FAILED_COMMENT = `${COMMENT_MARKER}\nThe gate could not re-check the latest \`main\` state before merging. A maintainer must inspect the workflow run; the gate will not retry blindly.`;
const MERGE_REJECTED_COMMENT = `${COMMENT_MARKER}\nThe merge API rejected the validated merge attempt. A maintainer must inspect the workflow run; the gate will not retry blindly.`;
const MAINTAINER_COMMENT = `${COMMENT_MARKER}\nThis same-repository maintainer pull request touches the community list. The contribution gate is informational and will not merge it.`;
const PASS_WITH_AUTO_MERGE_OFF_COMMENT = `${COMMENT_MARKER}\nCommunity source validation passed for this exact head SHA. Automatic merge is disabled; a maintainer may merge after the required check completes.`;
const NON_PASS_ACT_CONTRACT_FIELDS = {
  identifier: "",
  submittedBy: "",
  dedupKey: "",
} as const;
const PASSING_ACT_CONTRACT: GateRunResult["contract"] = {
  verdict: "pass",
  prNumber: 10,
  headSha: HEAD_SHA,
  failedCheckIds: [],
  identifier: "OpenAITest",
  submittedBy: "CommunityUser",
  dedupKey: "openaitest",
};

function createEvent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    action: "opened",
    number: 10,
    repository: { full_name: "caty-ai/x-collector" },
    pull_request: {
      number: 10,
      author_association: "NONE",
      user: { login: "CommunityUser" },
      base: {
        ref: "main",
        sha: BASE_SHA,
        repo: { full_name: "caty-ai/x-collector" },
      },
      head: {
        sha: HEAD_SHA,
        repo: { full_name: "contrib/x-collector-fork" },
      },
    },
    ...overrides,
  };
}

function compareFile(index: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    filename: `docs/file-${index}.md`,
    sha: index.toString(16).padStart(40, "0").slice(-40),
    status: "modified",
    ...overrides,
  };
}

function parseContract(outputPath: string): GateRunResult["contract"] {
  const values = Object.fromEntries(
    fs.readFileSync(outputPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      }),
  );

  return {
    verdict: values.verdict || "",
    prNumber: Number(values.pr_number || "0"),
    headSha: values.head_sha || "",
    failedCheckIds: values.failed_check_ids ? values.failed_check_ids.split(",").filter(Boolean) : [],
    identifier: values.identifier || "",
    submittedBy: values.submitted_by || "",
    dedupKey: values.dedup_key || "",
  };
}

function parseRequestLog(logPath: string): RequestLogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, "utf8").trim();
  if (content === "") return [];
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RequestLogEntry);
}

function runGateCase(routes: Route[], eventOverrides: Partial<Record<string, unknown>> = {}): GateRunResult {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-case-"));
  const casePath = path.join(tempRoot, "case.json");
  const eventPath = path.join(tempRoot, "event.json");
  const outputPath = path.join(tempRoot, "github-output.txt");

  try {
    fs.writeFileSync(casePath, JSON.stringify({ routes }, null, 2));
    fs.writeFileSync(eventPath, JSON.stringify(createEvent(eventOverrides), null, 2));
    fs.writeFileSync(outputPath, "");

    const result = spawnSync(process.execPath, [RUNNER_PATH, casePath, GATE_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        COMMUNITY_GATE_MODE: "validate",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_TOKEN: "test-token",
        HOME: process.env.HOME || os.homedir(),
        MIN_ACCOUNT_AGE_DAYS: "30",
        NODE_ENV: "test",
        PATH: process.env.PATH || "",
        TMPDIR: process.env.TMPDIR || os.tmpdir(),
        TZ: "UTC",
      },
    });

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      contract: parseContract(outputPath),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runActCase(
  routes: Route[],
  contractOverrides: Partial<GateRunResult["contract"]> = {},
  envOverrides: Record<string, string | null> = {},
): ActRunResult {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-act-case-"));
  const casePath = path.join(tempRoot, "case.json");
  const requestLogPath = path.join(tempRoot, "requests.ndjson");
  const contract = { ...PASSING_ACT_CONTRACT, ...contractOverrides };

  try {
    fs.writeFileSync(casePath, JSON.stringify({ routes }, null, 2));
    const env: NodeJS.ProcessEnv = {
      AUTO_MERGE: "true",
      COMMUNITY_GATE_MODE: "act",
      CONTRACT_DEDUP_KEY: contract.dedupKey,
      CONTRACT_FAILED_CHECK_IDS: contract.failedCheckIds.join(","),
      CONTRACT_HEAD_SHA: contract.headSha,
      CONTRACT_IDENTIFIER: contract.identifier,
      CONTRACT_PR_NUMBER: String(contract.prNumber),
      CONTRACT_SUBMITTED_BY: contract.submittedBy,
      CONTRACT_VERDICT: contract.verdict,
      GATE_REQUEST_LOG: requestLogPath,
      GITHUB_TOKEN: "test-token",
      HOME: process.env.HOME || os.homedir(),
      NODE_ENV: "test",
      PATH: process.env.PATH || "",
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      TZ: "UTC",
    };
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === null) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const result = spawnSync(process.execPath, [RUNNER_PATH, casePath, GATE_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    });

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      requests: parseRequestLog(requestLogPath),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function compareRoute(body: unknown): Route {
  return {
    path: `/repos/caty-ai/x-collector/compare/${BASE_SHA}...${HEAD_SHA}`,
    body,
  };
}

function pullRoute(changedFiles: number, headSha = HEAD_SHA): Route {
  return {
    path: "/repos/caty-ai/x-collector/pulls/10",
    body: {
      changed_files: changedFiles,
      head: { sha: headSha },
    },
  };
}

function passCaseRoutes(): Route[] {
  const source = {
    schema_version: 1,
    platform: "x",
    identifier: "OpenAITest",
    topic: "AI lab announcements",
    language: "en",
    submitted_by: "CommunityUser",
    first_seen: "2026-08-01",
  };
  const filename = "data/community-sources/x--openaitest.json";
  const encoded = Buffer.from(JSON.stringify(source, null, 2)).toString("base64");

  return [
    compareRoute({
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      files: [
        {
          filename,
          sha: FILE_SHA,
          status: "added",
        },
      ],
    }),
    pullRoute(1),
    {
      path: `/repos/caty-ai/x-collector/git/trees/${HEAD_SHA}`,
      query: { recursive: "1" },
      body: {
        truncated: false,
        tree: [
          {
            path: filename,
            mode: "100644",
            type: "blob",
            sha: FILE_SHA,
          },
        ],
      },
    },
    {
      path: "/repos/caty-ai/x-collector/contents/data/community-sources/x--openaitest.json",
      query: { ref: HEAD_SHA },
      body: {
        type: "file",
        sha: FILE_SHA,
        size: Buffer.byteLength(JSON.stringify(source, null, 2)),
        encoding: "base64",
        content: encoded,
      },
    },
    {
      path: "/repos/caty-ai/x-collector/contents/data/community-sources/x--openaitest.json",
      query: { ref: BASE_SHA },
      status: 404,
      body: { message: "Not Found" },
    },
    {
      path: "/users/CommunityUser",
      body: { created_at: "2020-01-01T00:00:00.000Z" },
    },
    {
      path: "/repos/caty-ai/x-collector/commits",
      query: {
        path: "data/community-sources",
        sha: BASE_SHA,
        per_page: "100",
        page: "1",
      },
      body: [],
    },
  ];
}

function labelCleanupRoutes(): Route[] {
  return [
    {
      method: "DELETE",
      path: VALIDATED_LABEL_PATH,
      status: 404,
      body: { message: "Not Found" },
    },
    {
      method: "DELETE",
      path: REJECTED_LABEL_PATH,
      status: 404,
      body: { message: "Not Found" },
    },
  ];
}

function commentsListRoute(body: Array<{ body?: string; id: number }> = []): Route {
  return {
    path: COMMENTS_PATH,
    query: { per_page: "100" },
    body,
  };
}

function stickyCommentCreateRoute(): Route {
  return {
    method: "POST",
    path: COMMENTS_PATH,
    body: { id: 101 },
  };
}

function stickyCommentUpdateRoute(commentId: number): Route {
  return {
    method: "PATCH",
    path: `/repos/caty-ai/x-collector/issues/comments/${commentId}`,
    body: {},
  };
}

function labelsCreateRoute(): Route {
  return {
    method: "POST",
    path: LABELS_PATH,
    body: {},
  };
}

function actPullRoute(headSha = HEAD_SHA, status = 200): Route {
  return {
    path: "/repos/caty-ai/x-collector/pulls/10",
    status,
    body: status >= 200 && status < 300 ? { head: { sha: headSha } } : { message: "pull failed" },
  };
}

function mainRefRoute(sha = MAIN_SHA): Route {
  return {
    path: "/repos/caty-ai/x-collector/git/ref/heads/main",
    body: { object: { sha } },
  };
}

function mainTreeRoute(
  tree: Array<{ mode: string; path: string; sha: string; type: string }> = [],
  truncated = false,
): Route {
  return {
    path: `/repos/caty-ai/x-collector/git/trees/${MAIN_SHA}`,
    query: { recursive: "1" },
    body: { truncated, tree },
  };
}

function mergeRoute(status = 200): Route {
  return {
    method: "PUT",
    path: MERGE_PATH,
    status,
    body: status >= 200 && status < 300 ? { merged: true } : { message: "merge rejected" },
  };
}

function mergeRequests(requests: RequestLogEntry[]): RequestLogEntry[] {
  return requests.filter((request) => request.method === "PUT" && request.pathname === MERGE_PATH);
}

function stickyCommentCreates(requests: RequestLogEntry[]): RequestLogEntry[] {
  return requests.filter((request) => request.method === "POST" && request.pathname === COMMENTS_PATH);
}

function stickyCommentUpdates(requests: RequestLogEntry[]): RequestLogEntry[] {
  return requests.filter((request) => (
    request.method === "PATCH" && request.pathname.startsWith("/repos/caty-ai/x-collector/issues/comments/")
  ));
}

function stickyCommentWrites(requests: RequestLogEntry[]): RequestLogEntry[] {
  return requests.filter((request) => (
    (request.method === "POST" && request.pathname === COMMENTS_PATH)
    || (request.method === "PATCH" && request.pathname.startsWith("/repos/caty-ai/x-collector/issues/comments/"))
  ));
}

function labelAdditions(requests: RequestLogEntry[], label: string): RequestLogEntry[] {
  return requests.filter((request) => (
    request.method === "POST"
    && request.pathname === LABELS_PATH
    && typeof request.body === "object"
    && request.body !== null
    && Array.isArray((request.body as { labels?: unknown }).labels)
    && (request.body as { labels: unknown[] }).labels.length === 1
    && (request.body as { labels: unknown[] }).labels[0] === label
  ));
}

function labelDeletions(requests: RequestLogEntry[], labelPath: string): RequestLogEntry[] {
  return requests.filter((request) => request.method === "DELETE" && request.pathname === labelPath);
}

function stickyBodies(requests: RequestLogEntry[]): string[] {
  return stickyCommentWrites(requests).map((request) => {
    if (
      typeof request.body === "object"
      && request.body !== null
      && typeof (request.body as { body?: unknown }).body === "string"
    ) {
      return (request.body as { body: string }).body;
    }
    throw new Error("sticky comment request body was not recorded as JSON");
  });
}

function failureComment(failedCheckIds: string[]): string {
  const ids = failedCheckIds.length > 0 ? failedCheckIds : ["E3"];
  return `${COMMENT_MARKER}\nCommunity source validation did not pass.\n\n${ids.map((id) => `- \`${id}\``).join("\n")}\n\nSee the [check catalog](${CHECK_CATALOG_URL}).`;
}

function expectAllRequestsMatched(requests: RequestLogEntry[]): void {
  const unmatched = requests
    .filter((request) => !request.matched)
    .map((request) => `${request.method} ${request.pathname}${request.search}`);
  if (unmatched.length > 0) {
    throw new Error(`unmatched requests:\n${unmatched.join("\n")}`);
  }
}

function labelAdditionIndex(requests: RequestLogEntry[], label: string): number {
  return requests.findIndex((request) => (
    request.method === "POST"
    && request.pathname === LABELS_PATH
    && typeof request.body === "object"
    && request.body !== null
    && Array.isArray((request.body as { labels?: unknown }).labels)
    && (request.body as { labels: unknown[] }).labels.length === 1
    && (request.body as { labels: unknown[] }).labels[0] === label
  ));
}

function labelDeletionIndex(requests: RequestLogEntry[], labelPath: string): number {
  return requests.findIndex((request) => request.method === "DELETE" && request.pathname === labelPath);
}

function commitListRoute(body: unknown = [{ sha: COMMIT_SHA }], page = 1): Route {
  return {
    path: "/repos/caty-ai/x-collector/commits",
    query: {
      path: "data/community-sources",
      sha: BASE_SHA,
      per_page: "100",
      page: String(page),
    },
    body,
  };
}

function commitDetailRoute(body: unknown, page: number): Route {
  return {
    path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`,
    query: {
      per_page: String(COMMIT_FILES_PER_PAGE),
      page: String(page),
    },
    body,
  };
}

function withCommitHistory(detailRoutes: Route[], extraRoutes: Route[] = []): Route[] {
  return [
    ...passCaseRoutes().filter((route) => route.path !== "/repos/caty-ai/x-collector/commits"),
    commitListRoute(),
    ...detailRoutes,
    ...extraRoutes,
  ];
}

function historicalCommunitySource(index: number): {
  contentRoute: Route;
  file: { filename: string; sha: string; status: string };
} {
  const identifier = `Hist${index}`;
  const filename = `data/community-sources/x--${identifier.toLowerCase()}.json`;
  const source = {
    schema_version: 1,
    platform: "x",
    identifier,
    topic: `Historical source ${index}`,
    language: "en",
    submitted_by: "CommunityUser",
    first_seen: "2026-08-01",
  };
  const serialized = JSON.stringify(source, null, 2);
  return {
    file: {
      filename,
      sha: (1000 + index).toString(16).padStart(40, "0"),
      status: "added",
    },
    contentRoute: {
      path: `/repos/caty-ai/x-collector/contents/${filename}`,
      query: { ref: COMMIT_SHA },
      body: {
        type: "file",
        sha: (1000 + index).toString(16).padStart(40, "0"),
        size: Buffer.byteLength(serialized),
        encoding: "base64",
        content: Buffer.from(serialized).toString("base64"),
      },
    },
  };
}

describe("community gate validate mode", () => {
  it("returns neutral for the real PR #10 compare fixture when community sources are untouched", () => {
    // Provenance: real PR #10 compare 98800d1...a20e5b2 via GitHub API, trimmed to fields gate.ts reads.
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    const result = runGateCase([compareRoute(fixture), pullRoute(fixture.files.length)]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("neutral_untouched");
    expect(result.contract.failedCheckIds).toEqual([]);
  });

  it("treats 299 files as normal but rejects 300-file compare snapshots as E2", () => {
    const belowCap = runGateCase([
      compareRoute({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: Array.from({ length: 299 }, (_, index) => compareFile(index)),
      }),
      pullRoute(299),
    ]);
    const atCap = runGateCase([
      compareRoute({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: Array.from({ length: 300 }, (_, index) => compareFile(index)),
      }),
      pullRoute(300),
    ]);

    expect(belowCap.status).toBe(0);
    expect(belowCap.contract.verdict).toBe("neutral_untouched");
    expect(atCap.status).toBe(0);
    expect(atCap.contract.verdict).toBe("error");
    expect(atCap.contract.failedCheckIds).toEqual(["E2"]);
  });

  it.each([
    {
      name: "missing files key",
      compareBody: { status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1 },
    },
    {
      name: "empty files list",
      compareBody: { status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, files: [] },
    },
    {
      name: "null sha entry",
      compareBody: {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{ filename: "data/community-sources/x--broken.json", status: "added", sha: null }],
      },
    },
    {
      name: "empty status entry",
      compareBody: {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{ filename: "data/community-sources/x--broken.json", status: "", sha: FILE_SHA }],
      },
    },
    {
      name: "unknown status entry",
      compareBody: {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{ filename: "data/community-sources/x--broken.json", status: "moved", sha: FILE_SHA }],
      },
    },
  ])("returns E2 for malformed compare payloads: $name", ({ compareBody }) => {
    const result = runGateCase([compareRoute(compareBody)]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("error");
    expect(result.contract.failedCheckIds).toEqual(["E2"]);
  });

  it("fails renamed community-source moves out instead of going neutral", () => {
    const result = runGateCase([
      compareRoute({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{
          filename: "docs/moved.md",
          previous_filename: "data/community-sources/x--openai.json",
          status: "renamed",
          sha: FILE_SHA,
        }],
      }),
      pullRoute(1),
    ]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds.sort()).toEqual(["C1", "C2"]);
  });

  it.each([
    { name: "missing files", body: {} },
    { name: "null files", body: { files: null } },
    { name: "non-array files", body: { files: "not-an-array" } },
    {
      name: "malformed file entry",
      body: { files: [{ filename: "docs/history.md", sha: FILE_SHA, status: "invented" }] },
    },
  ])("fails C10 when commit detail has $name", ({ body }) => {
    const result = runGateCase(withCommitHistory([
      commitDetailRoute(body, 1),
      // The queryless fallback lets the same assertion run against the pre-fix script.
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body },
    ]));

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it("counts commit-detail files across pages before applying C10", () => {
    const first = historicalCommunitySource(1);
    const second = historicalCommunitySource(2);
    const third = historicalCommunitySource(3);
    const firstPage = Array.from(
      { length: COMMIT_FILES_PER_PAGE },
      (_, index) => compareFile(1000 + index),
    );
    firstPage[0] = first.file;
    firstPage[1] = second.file;
    const result = runGateCase(withCommitHistory([
      commitDetailRoute({ files: firstPage }, 1),
      commitDetailRoute({ files: [third.file] }, 2),
      // Pre-fix gate.ts fetches without pagination and therefore sees only two submissions.
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body: { files: firstPage } },
    ], [first.contentRoute, second.contentRoute, third.contentRoute]));

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it("fails C10 when full commit-detail pages reach the pagination bound", () => {
    const fullPage = Array.from(
      { length: COMMIT_FILES_PER_PAGE },
      (_, index) => compareFile(2000 + index),
    );
    const detailRoutes = Array.from(
      { length: MAX_COMMIT_FILE_PAGES },
      (_, index) => commitDetailRoute({ files: fullPage }, index + 1),
    );
    detailRoutes.push({
      path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`,
      body: { files: fullPage },
    });
    const result = runGateCase(withCommitHistory(detailRoutes));

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it("fails C10 when a commit-detail page exceeds the fixed page size", () => {
    const oversizedPage = Array.from(
      { length: COMMIT_FILES_PER_PAGE + 1 },
      (_, index) => compareFile(3000 + index),
    );
    const result = runGateCase(withCommitHistory([
      commitDetailRoute({ files: oversizedPage }, 1),
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body: { files: oversizedPage } },
    ]));

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it("fails C10 when full commits-list pages reach the pagination bound", () => {
    const fullPage = Array.from({ length: COMMITS_PER_PAGE }, () => ({ sha: COMMIT_SHA }));
    const listRoutes = Array.from(
      { length: MAX_COMMIT_LIST_PAGES },
      (_, index) => commitListRoute(fullPage, index + 1),
    );
    listRoutes.push(commitListRoute([], MAX_COMMIT_LIST_PAGES + 1));
    const result = runGateCase([
      ...passCaseRoutes().filter((route) => route.path !== "/repos/caty-ai/x-collector/commits"),
      ...listRoutes,
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body: { files: [] } },
    ]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it.each([
    { name: "a non-array body", body: { sha: COMMIT_SHA } },
    { name: "an entry without a valid SHA", body: [{}] },
    {
      name: "more entries than the requested page size",
      body: Array.from({ length: COMMITS_PER_PAGE + 1 }, () => ({ sha: COMMIT_SHA })),
    },
  ])("fails C10 when a commits-list page has $name", ({ body }) => {
    const result = runGateCase([
      ...passCaseRoutes().filter((route) => route.path !== "/repos/caty-ai/x-collector/commits"),
      commitListRoute(body),
      commitListRoute([], 2),
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body: { files: [] } },
    ]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds).toEqual(["C10"]);
  });

  it.each([
    { name: "the pull head SHA moved", files: [compareFile(1)], route: pullRoute(1, "e".repeat(40)) },
    { name: "the pull reports more changed files", files: [compareFile(1)], route: pullRoute(2) },
    { name: "the pull reports fewer changed files", files: [compareFile(1), compareFile(2)], route: pullRoute(1) },
  ])("returns E2 when the pull disagrees with the pinned compare: $name", ({ files, route }) => {
    const result = runGateCase([
      compareRoute({ files }),
      route,
    ]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("error");
    expect(result.contract.failedCheckIds).toEqual(["E2"]);
  });

  it("accepts a validated, provably complete empty commit-detail file list", () => {
    const emptyDetail = { files: [] };
    const result = runGateCase(withCommitHistory([
      commitDetailRoute(emptyDetail, 1),
      { path: `/repos/caty-ai/x-collector/commits/${COMMIT_SHA}`, body: emptyDetail },
    ]));

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("pass");
    expect(result.contract.failedCheckIds).toEqual([]);
  });

  it("passes a single added community source when the pull cross-check matches", () => {
    const result = runGateCase(passCaseRoutes());

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("pass");
    expect(result.contract.failedCheckIds).toEqual([]);
    expect(result.contract.identifier).toBe("OpenAITest");
    expect(result.contract.submittedBy).toBe("CommunityUser");
    expect(result.contract.dedupKey).toBe("openaitest");
    expect(result.contract.prNumber).toBe(10);
    expect(result.contract.headSha).toBe(HEAD_SHA);
  });
});

describe("community gate act mode", () => {
  it.each(["true", "false"])(
    "adds the rejected label and failure sticky comment for a fail verdict with AUTO_MERGE=%s",
    (autoMerge) => {
      const result = runActCase([
        {
          method: "DELETE",
          path: VALIDATED_LABEL_PATH,
          status: 404,
          body: { message: "Not Found" },
        },
        labelsCreateRoute(),
        commentsListRoute(),
        stickyCommentCreateRoute(),
      ], {
        verdict: "fail",
        failedCheckIds: ["C9"],
        ...NON_PASS_ACT_CONTRACT_FIELDS,
      }, { AUTO_MERGE: autoMerge });

      expectAllRequestsMatched(result.requests);
      expect(result.status).toBe(1);
      expect(mergeRequests(result.requests)).toHaveLength(0);
      expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
      expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
      expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(1);
      expect(stickyBodies(result.requests)).toEqual([failureComment(["C9"])]);
    },
  );

  it.each(["true", "false"])(
    "adds the rejected label and error sticky comment for E2 with AUTO_MERGE=%s",
    (autoMerge) => {
      const result = runActCase([
        {
          method: "DELETE",
          path: VALIDATED_LABEL_PATH,
          status: 404,
          body: { message: "Not Found" },
        },
        labelsCreateRoute(),
        commentsListRoute(),
        stickyCommentCreateRoute(),
      ], {
        verdict: "error",
        failedCheckIds: ["E2"],
        ...NON_PASS_ACT_CONTRACT_FIELDS,
      }, { AUTO_MERGE: autoMerge });

      expectAllRequestsMatched(result.requests);
      expect(result.status).toBe(1);
      expect(mergeRequests(result.requests)).toHaveLength(0);
      expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
      expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
      expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(1);
      expect(stickyBodies(result.requests)).toEqual([failureComment(["E2"])]);
    },
  );

  it("falls back to E3 in the error sticky comment when the contract carries no failed check ids", () => {
    const result = runActCase([
      {
        method: "DELETE",
        path: VALIDATED_LABEL_PATH,
        status: 404,
        body: { message: "Not Found" },
      },
      labelsCreateRoute(),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ], {
      verdict: "error",
      failedCheckIds: [],
      ...NON_PASS_ACT_CONTRACT_FIELDS,
    });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(1);
    expect(stickyBodies(result.requests)).toEqual([failureComment([])]);
  });

  it("returns exit 1 without any journal requests when a non-pass contract has prNumber 0", () => {
    const result = runActCase([], {
      verdict: "fail",
      prNumber: 0,
      failedCheckIds: ["C9"],
      ...NON_PASS_ACT_CONTRACT_FIELDS,
    });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(result.requests).toEqual([]);
  });

  it("returns neutral without labels or sticky comments when community sources are untouched", () => {
    const result = runActCase([
      {
        method: "DELETE",
        path: VALIDATED_LABEL_PATH,
        status: 404,
        body: { message: "Not Found" },
      },
    ], {
      verdict: "neutral_untouched",
      failedCheckIds: [],
      ...NON_PASS_ACT_CONTRACT_FIELDS,
    });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyCommentWrites(result.requests)).toHaveLength(0);
  });

  it("writes the maintainer sticky comment without adding outcome labels", () => {
    const result = runActCase([
      {
        method: "DELETE",
        path: VALIDATED_LABEL_PATH,
        status: 404,
        body: { message: "Not Found" },
      },
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ], {
      verdict: "neutral_maintainer",
      failedCheckIds: [],
      ...NON_PASS_ACT_CONTRACT_FIELDS,
    });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([MAINTAINER_COMMENT]);
  });

  it("stops before merging when the pull head changed after validation", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute("f".repeat(40)),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([HEAD_CHANGED_COMMENT]);
  });

  it("stops before merging when the latest main tree already contains the dedup key", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute(),
      mainRefRoute(),
      mainTreeRoute([
        {
          path: COMMUNITY_FILE_PATH,
          mode: "100644",
          type: "blob",
          sha: FILE_SHA,
        },
      ]),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([SOURCE_EXISTS_ON_MAIN_COMMENT]);
  });

  it("writes the merge-rejected sticky comment when the merge API rejects the validated merge attempt", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute(),
      mainRefRoute(),
      mainTreeRoute(),
      mergeRoute(409),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(1);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([MERGE_REJECTED_COMMENT]);
  });

  it("maps a pull re-fetch API failure to the merge-rejected sticky comment", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute(HEAD_SHA, 500),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([MERGE_REJECTED_COMMENT]);
  });

  it("stops before merging when the latest main re-check fails", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute(),
      mainRefRoute("not-a-sha"),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(1);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:rejected")).toHaveLength(0);
    expect(stickyBodies(result.requests)).toEqual([SOURCE_RECHECK_FAILED_COMMENT]);
  });

  it("merges exactly once with the pinned SHA and gate-controlled squash metadata when auto-merge is enabled", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      actPullRoute(),
      mainRefRoute(),
      mainTreeRoute(),
      mergeRoute(),
    ]);

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(stickyCommentWrites(result.requests)).toHaveLength(0);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelDeletions(result.requests, REJECTED_LABEL_PATH)).toHaveLength(1);
    expect(mergeRequests(result.requests)).toHaveLength(1);
    expect(mergeRequests(result.requests)[0]?.body).toEqual({
      sha: HEAD_SHA,
      merge_method: "squash",
      commit_title: "community: add x source OpenAITest",
      commit_message: "Submitted by CommunityUser. Validated by the community-sources gate. PR #10.",
    });
  });

  it("adds the validated label and pass sticky comment instead of merging when auto-merge is disabled", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      labelsCreateRoute(),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ], {}, { AUTO_MERGE: "false" });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(1);
    expect(labelAdditionIndex(result.requests, "community-source:validated"))
      .toBeGreaterThan(labelDeletionIndex(result.requests, VALIDATED_LABEL_PATH));
    expect(stickyBodies(result.requests)).toEqual([PASS_WITH_AUTO_MERGE_OFF_COMMENT]);
  });

  it("updates the marked sticky comment instead of creating a new one when auto-merge is disabled", () => {
    const existingCommentId = 88;
    const result = runActCase([
      ...labelCleanupRoutes(),
      labelsCreateRoute(),
      commentsListRoute([
        { id: 77, body: "Existing unrelated maintainer note" },
        { id: existingCommentId, body: `${COMMENT_MARKER}\nOld gate status` },
      ]),
      stickyCommentUpdateRoute(existingCommentId),
    ], {}, { AUTO_MERGE: "false" });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(1);
    expect(stickyCommentCreates(result.requests)).toHaveLength(0);
    expect(stickyCommentUpdates(result.requests)).toHaveLength(1);
    expect(stickyCommentUpdates(result.requests)[0]?.pathname)
      .toBe(`/repos/caty-ai/x-collector/issues/comments/${existingCommentId}`);
    expect(stickyCommentUpdates(result.requests)[0]?.body).toEqual({
      body: PASS_WITH_AUTO_MERGE_OFF_COMMENT,
    });
  });

  it.each(["", "True", "1", "yes"])(
    "treats AUTO_MERGE=%s as disabled because only the exact string true enables merging",
    (autoMergeValue) => {
      const result = runActCase([
        ...labelCleanupRoutes(),
        labelsCreateRoute(),
        commentsListRoute(),
        stickyCommentCreateRoute(),
      ], {}, { AUTO_MERGE: autoMergeValue });

      expectAllRequestsMatched(result.requests);
      expect(result.status).toBe(0);
      expect(mergeRequests(result.requests)).toHaveLength(0);
      expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
      expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(1);
      expect(stickyBodies(result.requests)).toEqual([PASS_WITH_AUTO_MERGE_OFF_COMMENT]);
    },
  );

  it("treats AUTO_MERGE being unset as disabled because only the exact string true enables merging", () => {
    const result = runActCase([
      ...labelCleanupRoutes(),
      labelsCreateRoute(),
      commentsListRoute(),
      stickyCommentCreateRoute(),
    ], {}, { AUTO_MERGE: null });

    expectAllRequestsMatched(result.requests);
    expect(result.status).toBe(0);
    expect(mergeRequests(result.requests)).toHaveLength(0);
    expect(labelDeletions(result.requests, VALIDATED_LABEL_PATH)).toHaveLength(1);
    expect(labelAdditions(result.requests, "community-source:validated")).toHaveLength(1);
    expect(stickyBodies(result.requests)).toEqual([PASS_WITH_AUTO_MERGE_OFF_COMMENT]);
  });
});
