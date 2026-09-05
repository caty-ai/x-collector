import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("allows only example hosts throughout all fixture files", () => {
  const allowed = new Set(["example.com", "example.org", "example.net"]);
  let urls = 0;
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(path); continue; }
      for (const match of readFileSync(path, "utf8").matchAll(/https?:\/\/[^\s)"<>\\]+/gi)) {
        expect(allowed.has(new URL(match[0]).hostname), `${entry.name}: ${match[0]}`).toBe(true);
        urls += 1;
      }
    }
  }
  inspect(new URL("./fixtures", import.meta.url).pathname);
  expect(urls).toBeGreaterThan(0);
});
