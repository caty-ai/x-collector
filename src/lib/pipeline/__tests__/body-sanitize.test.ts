import { describe, expect, it } from "vitest";
import { BODY_SANITIZE_MAX_INPUT_CHARS, sanitizeBodyFallback } from "../body-sanitize";

describe("sanitizeBodyFallback", () => {
  it("removes multi-line and single-line leading front matter", () => {
    expect(sanitizeBodyFallback("\uFEFF---\ntitle: Hidden\n---\n# Visible" )).toBe("Visible");
    expect(sanitizeBodyFallback("--- title: Hidden --- Visible" )).toBe("Visible");
  });

  it("removes closed backtick and tilde fences but keeps unclosed fence content", () => {
    expect(sanitizeBodyFallback("before\n```ts\nconst x = 1\n```\nafter" )).toBe("before after");
    expect(sanitizeBodyFallback("before\n~~~\nsecret\n~~~\nafter" )).toBe("before after");
    expect(sanitizeBodyFallback("before\n```ts\nkept code" )).toBe("before kept code");
  });

  it("removes HTML, comments, scripts, styles, and unclosed executable elements", () => {
    const raw = "a<img src=x>b<details>c</details><iframe>x</iframe><!-- no --><script>x</script><style>y</style>d";
    expect(sanitizeBodyFallback(raw)).toBe("a b c x d");
    expect(sanitizeBodyFallback("before <script>alert(1)" )).toBe("before");
    expect(sanitizeBodyFallback("before <style>body{}" )).toBe("before");
  });

  it("decodes named and numeric entities after stripping real HTML", () => {
    expect(sanitizeBodyFallback("A&amp;B &lt;x&gt; &quot;q&quot; &#39;a&#39; &apos;b&apos;&nbsp;<https://a.test/x>"))
      .toBe("A&B <x> \"q\" 'a' 'b' https://a.test/x");
    expect(sanitizeBodyFallback("Caf&#233; &#8217;test&#x2019; &#x110000; &#xD800;")).toBe(
      "Café ’test’ &#x110000; &#xD800;",
    );
    expect(sanitizeBodyFallback("A&nbsp;&nbsp;B")).toBe("A B");
    expect(sanitizeBodyFallback("literal &lt;script&gt; and &lt;div&gt;")).toBe(
      "literal <script> and <div>",
    );
    expect(sanitizeBodyFallback("inject &lt;script&gt; into a page. The rest matters.")).toBe(
      "inject <script> into a page. The rest matters.",
    );
  });

  it("removes images, unwraps simple links and emphasis", () => {
    expect(sanitizeBodyFallback("![alt](image.png) [label](https://x.test) **bold** __strong__ *em* _under_"))
      .toBe("label bold strong em under");
    expect(sanitizeBodyFallback("snake_case_name 2*3*4 **bold** *em* __b__ _i_")).toBe(
      "snake_case_name 2*3*4 bold em b i",
    );
  });

  it("strips line-level markdown while preserving inline comparisons", () => {
    const raw = "# H1\r\n## H2\r\n### H3\r\n| a | b |\r\n---\r\n- bullet\r\n1. numbered\r\n+ [x] task\r\n> quote\r\nrange -5 to 5. a - b dash\r\nスコア > 0.5\r\nStep 1. Do this.";
    expect(sanitizeBodyFallback(raw)).toBe(
      "H1 H2 H3 bullet numbered task quote range -5 to 5. a - b dash スコア > 0.5 Step 1. Do this.",
    );
  });

  it("strips ruby and namespaced/custom HTML while preserving email and generics", () => {
    const raw = "<ruby>漢<rt>かん</rt><rp>(</rp></ruby><o:p>x</o:p><mj-text>y</mj-text><v:shape x=\"1\">z</v:shape> <name@host> Array<T> Array <T> here. Array<string>";
    expect(sanitizeBodyFallback(raw)).toBe("漢 かん ( x y z <name@host> Array<T> Array <T> here. Array<string>");
  });

  it("cleans structural markers from whitespace-collapsed blurb text", () => {
    expect(sanitizeBodyFallback("--- ## Heading | col | - item Step 1. Do this."))
      .toBe("Heading | col | - item Step 1. Do this.");
    expect(sanitizeBodyFallback("result a || b fallback\n| table | row |\nkept | inline")).toBe(
      "result a || b fallback kept | inline",
    );
  });

  it("documents parenthesized markdown URL and unclosed front-matter behavior", () => {
    expect(sanitizeBodyFallback("[text](https://x/y_(z))" )).toBe("[text](https://x/y_(z))");
    expect(sanitizeBodyFallback("---\nkey: value\nbody" )).toContain("key: value");
  });

  it("returns an empty string for absent input", () => {
    expect(sanitizeBodyFallback(null)).toBe("");
    expect(sanitizeBodyFallback(undefined)).toBe("");
  });

  it("caps input before sanitizing and leaves shorter input unchanged", () => {
    expect(BODY_SANITIZE_MAX_INPUT_CHARS).toBe(20_000);
    expect(sanitizeBodyFallback("x".repeat(20_000))).toBe("x".repeat(20_000));
    expect(sanitizeBodyFallback("x".repeat(20_001))).toBe("x".repeat(20_000));
    expect(sanitizeBodyFallback("x".repeat(25_000))).toBe("x".repeat(20_000));
    expect(sanitizeBodyFallback("short body")).toBe("short body");
    expect(sanitizeBodyFallback("short body\uD83D")).toBe("short body\uD83D");
  });

  it("does not leave a split surrogate pair at the input cap", () => {
    expect(sanitizeBodyFallback("a".repeat(19_999) + "😀tail")).toBe("a".repeat(19_999));
  });

  it("applies the cap before existing sanitizer passes", () => {
    const sanitized = sanitizeBodyFallback("intro\n```ts\n" + "c".repeat(30_000));

    expect(sanitized).toMatch(/^intro/);
    expect(sanitized.length).toBeLessThanOrEqual(BODY_SANITIZE_MAX_INPUT_CHARS);
  });

  it("bounds entity-heavy input before decoding", () => {
    const sanitized = sanitizeBodyFallback("&#x110000;".repeat(25_000));

    expect(sanitized.length).toBeLessThanOrEqual(BODY_SANITIZE_MAX_INPUT_CHARS);
  });

  it("strips symmetric unknown tags while preserving text-like openers", () => {
    expect(sanitizeBodyFallback("<foo>bar</foo> and <x>y</x> tail")).toBe("bar and y tail");
    expect(sanitizeBodyFallback("Array<T> of items")).toBe("Array<T> of items");
    expect(sanitizeBodyFallback("<T>x</T>")).toBe("x");
    expect(sanitizeBodyFallback("mail <a@b.c> ok")).toBe("mail <a@b.c> ok");
    expect(sanitizeBodyFallback("<foo>only opener")).toBe("<foo>only opener");
    expect(sanitizeBodyFallback("<Foo>bar</FOO>")).toBe("bar");
  });

  it("strips a kept-style opener when a matching closer appears anywhere later (accepted §1.2 consequence)", () => {
    expect(sanitizeBodyFallback("Array<T> of items\n\nlater </T> end")).toBe("Array of items later end");
  });
});
