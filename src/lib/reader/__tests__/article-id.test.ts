import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTICLE_ID_RE, articleIdFromSource, extractSourceUrl, indexArticles, normalizeSourceUrl } from "../article-id";
import { parseNewsletterMarkdown } from "../newsletter-markdown";

const read = (name: string, suffix: string) => readFileSync(new URL(`./fixtures/editions/${name}.${suffix}`, import.meta.url), "utf8");
const parse = (name: string) => parseNewsletterMarkdown(read(name, "md"));

describe("frozen URL normalization", () => {
  it.each([
    ["https://example.com/a?z=2&a=3&a=1", "https://example.com/a?a=1&a=3&z=2"],
    ["https://example.com/a?UTM_SOURCE=x&utm_medium=y&FBCLID=z&gclid=z&mc_cid=z&mc_eid=z&igshid=z&ref_src=z&ok=1", "https://example.com/a?ok=1"],
    ["https://example.com/a?s=keep", "https://example.com/a?s=keep"],
    ["https://example.com/a#part", "https://example.com/a"],
    ["https://example.com/a/", "https://example.com/a"],
    ["https://example.com/", "https://example.com/"],
    ["https://example.com", "https://example.com/"],
    ["HTTPS://EXAMPLE.COM/a", "https://example.com/a"],
    ["https://example.com:443/a", "https://example.com/a"],
    ["http://example.com:80/a", "http://example.com/a"],
    ["https://example.com:8443/a", "https://example.com:8443/a"],
    ["https://example.com/a///", "https://example.com/a"],
    ["https://example.com/a?b=two%20words&a=%7E", "https://example.com/a?a=%7E&b=two+words"],
    ["https://example.com/a?A=2&a=1&A=1", "https://example.com/a?A=1&A=2&a=1"],
    ["https://example.com/a?x=1&x=1&x=", "https://example.com/a?x=&x=1&x=1"],
    ["https://example.com/%7Euser", "https://example.com/~user"],
    ["https://example.com/a%2fb", "https://example.com/a%2Fb"],
    ["https://example.com/%41", "https://example.com/A"],
    ["https://example.com/%e3%81%82", "https://example.com/%E3%81%82"],
    ["https://m.example.com/a", "https://m.example.com/a"],
  ])("normalizes and is idempotent: %s", (input, expected) => {
    expect(normalizeSourceUrl(input)).toBe(expected);
    expect(normalizeSourceUrl(expected)).toBe(expected);
  });
  it("keeps encoded reserved characters distinct from literal path separators", () => {
    expect(normalizeSourceUrl("https://example.com/a%2fb")).not.toBe(normalizeSourceUrl("https://example.com/a/b"));
  });
  it.each(["https://user:pass@example.com/a", "https://user@example.com/a", "https://:pass@example.com/a", "ftp://example.com/a", "javascript:alert(1)", "mailto:box@example.com", "about:blank", "", "not a URL", "/relative"])("rejects %s", (input) => {
    expect(normalizeSourceUrl(input)).toBeNull();
  });
});

describe("source-only IDs", () => {
  it.each([
    ["[platform](https://example.com/a)", "https://example.com/a"],
    ["https://example.net/first [platform](https://example.com/second)", "https://example.com/second"],
    ["https://example.com/a and https://example.org/b", "https://example.com/a"],
    ["https://example.org/bare。、）」』】,.;:!?", "https://example.org/bare"],
    ["[platform](https://example.com/a!)", "https://example.com/a!"],
    ["", null], ["about:blank", null], ["[source](about:blank)", null],
    ["javascript:alert(1)", null], ["mailto:box@example.com", null],
  ])("extracts from source: %s", (input, expected) => {
    expect(extractSourceUrl(input)).toBe(expected);
  });
  it("hashes normalized UTF-8 synchronously to twelve lowercase hex digits", () => {
    const expected = createHash("sha256").update("https://example.com/toolkit").digest("hex").slice(0, 12);
    expect(articleIdFromSource("[platform](https://example.com/toolkit/?utm_source=test#part)")).toBe(expected);
    expect(expected).toMatch(ARTICLE_ID_RE);
    expect(ARTICLE_ID_RE.test("ABCDEF123456")).toBe(false);
    expect(ARTICLE_ID_RE.test("abcdef1234567")).toBe(false);
  });
  it("never obtains an ID from body-only URLs or unusable sources", () => {
    const articles = parse("synthetic-a").sections[0].articles;
    expect(articles[4].body).toContain("https://example.net/body-only");
    for (const i of [4, 5]) expect(articleIdFromSource(articles[i].source)).toBeNull();
    expect(articleIdFromSource("https://user:pass@example.com/private")).toBeNull();
  });
  it.each(["synthetic-a", "synthetic-b"])("matches independently authored ID map: %s", (name) => {
    const indexed = indexArticles(parse(name));
    const positions = Object.fromEntries(Array.from(indexed.byId, ([id, { sectionIndex, articleIndex }]) => [id, { sectionIndex, articleIndex }]));
    expect(positions).toEqual(JSON.parse(read(name, "ids.json")));
  });
  it("preserves half-width IDs and gives the full-width article its source ID", () => {
    const articles = parse("synthetic-a").sections[0].articles;
    expect(articles.slice(0, 4).map((article) => articleIdFromSource(article.source))).toEqual([
      "19e0bd97ba47", "94617bde3383", "2575c483be96", "a001bd27664e",
    ]);
  });
  it("uses the first duplicate, skips missing IDs, and counts every article", () => {
    const parsed = parse("synthetic-a");
    const indexed = indexArticles(parsed);
    const id = articleIdFromSource(parsed.sections[0].articles[0].source)!;
    expect(indexed.total).toBe(7);
    expect(indexed.byId.size).toBe(4);
    expect(indexed.byId.get(id)).toEqual({ sectionIndex: 0, articleIndex: 0, article: parsed.sections[0].articles[0], sectionTitle: "Experiments" });
    expect(indexed.byId.get(id)?.article).toBe(parsed.sections[0].articles[0]);
    expect(Array.from(indexed.byId.values()).map((entry) => entry.articleIndex)).toEqual([0, 1, 2, 3]);
    expect(id).toBe(articleIdFromSource(parse("synthetic-b").sections[0].articles[0].source));
  });
  it("counts all sections and keeps the first occurrence across sections", () => {
    const a = parse("synthetic-a");
    const b = parse("synthetic-b");
    const result = indexArticles({ ...a, sections: [...a.sections, ...b.sections] });
    expect(result.total).toBe(12);
    expect(result.byId.size).toBe(7);
    expect(result.byId.get(articleIdFromSource(b.sections[0].articles[1].source)!)?.sectionIndex).toBe(2);
    expect(result.byId.get(articleIdFromSource(b.sections[0].articles[0].source)!)?.sectionIndex).toBe(0);
  });
  it("indexes an empty edition", () => {
    expect(indexArticles(parse("empty"))).toEqual({ byId: new Map(), total: 0 });
  });
});
