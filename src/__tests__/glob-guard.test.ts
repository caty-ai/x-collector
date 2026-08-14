import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWLIST = new Set([
  "src/scripts/community/no-auto-subscribe.test.ts",
]);

function walk(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".test.ts")) {
      found.push(absolutePath);
    }
  }

  return found;
}

describe("vitest glob guard", () => {
  it("keeps every src/**/*.test.ts file under __tests__ unless explicitly allowlisted", () => {
    const repoRoot = process.cwd();
    const srcRoot = path.join(repoRoot, "src");
    const testFiles = walk(srcRoot)
      .map((absolutePath) => path.relative(repoRoot, absolutePath).split(path.sep).join("/"))
      .sort();

    const strayFiles = testFiles.filter((relativePath) => {
      if (ALLOWLIST.has(relativePath)) return false;
      return !relativePath.includes("/__tests__/");
    });

    expect(strayFiles).toEqual([]);
  });
});
