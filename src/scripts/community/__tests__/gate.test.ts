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

const REPO_ROOT = process.cwd();
const FIXTURE_PATH = path.join(REPO_ROOT, "src/scripts/community/__tests__/fixtures/compare-pr10.json");
const RUNNER_PATH = path.join(REPO_ROOT, "src/scripts/community/__tests__/helpers/gate-runner.cjs");
const GATE_PATH = path.join(REPO_ROOT, "src/scripts/community/gate.ts");
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const FILE_SHA = "c".repeat(40);
const COMMIT_SHA = "d".repeat(40);

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

function compareRoute(body: unknown): Route {
  return {
    path: `/repos/caty-ai/x-collector/compare/${BASE_SHA}...${HEAD_SHA}`,
    body,
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

describe("community gate validate mode", () => {
  it("returns neutral for the real PR #10 compare fixture when community sources are untouched", () => {
    const result = runGateCase([compareRoute(JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")))]);

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
    ]);
    const atCap = runGateCase([
      compareRoute({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: Array.from({ length: 300 }, (_, index) => compareFile(index)),
      }),
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
    ]);

    expect(result.status).toBe(0);
    expect(result.contract.verdict).toBe("fail");
    expect(result.contract.failedCheckIds.sort()).toEqual(["C1", "C2"]);
  });

  it("passes a single added community source through the C-check contract path", () => {
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
