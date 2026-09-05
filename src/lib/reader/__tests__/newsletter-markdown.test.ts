import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNewsletterMarkdown } from "../newsletter-markdown";

const fixture = (name: string, suffix: string) => readFileSync(new URL(`./fixtures/editions/${name}.${suffix}`, import.meta.url), "utf8");
describe("newsletter markdown golden fixtures", () => {
  it.each(["synthetic-a", "synthetic-b", "empty"])("matches the pre-move parser: %s", (name) => {
    expect(parseNewsletterMarkdown(fixture(name, "md"))).toEqual(JSON.parse(fixture(name, "parsed.json")));
  });
  it("preserves the odd source and body cases", () => {
    const parsed = parseNewsletterMarkdown(fixture("synthetic-a", "md"));
    const articles = parsed.sections[0].articles;
    expect(articles[2].source).toBe("[platform](https://example.net/final)");
    expect(articles[2].body).toContain("引用元: [platform](https://example.net/earlier)");
    expect(articles[3].source).toBe("");
    expect(articles[3].body).toContain("引用元：");
    expect(articles[4].body).toContain("#### Detail heading\n**Pseudo heading**");
    expect(articles[0].body).toContain("Why it matters:");
    expect(parsed.sections[1].articles).toEqual([]);
    expect(parsed.preamble).not.toBe("");
    expect(parsed.sections[0].intro).not.toBe("");
  });
  it("keeps B as CRLF without a trailing newline and empty as zero bytes", () => {
    const b = fixture("synthetic-b", "md");
    expect(b).toContain("\r\n");
    expect(b.replace(/\r\n/g, "")).not.toContain("\n");
    expect(b.endsWith("\n")).toBe(false);
    expect(fixture("empty", "md")).toBe("");
  });
  it("parses 250 articles in under 200 ms", () => {
    const markdown = "# Load fixture\n## Section\n" + Array.from({ length: 250 }, (_, i) => `### Article ${i}\n${"Summary line. ".repeat(30)}\n引用元: [platform](https://example.com/${i})\n\n`).join("");
    expect(markdown.length).toBeGreaterThanOrEqual(100_000);
    const start = performance.now();
    const parsed = parseNewsletterMarkdown(markdown);
    const elapsed = performance.now() - start;
    expect(parsed.sections.flatMap((section) => section.articles)).toHaveLength(250);
    expect(elapsed).toBeLessThan(200);
  });
});
