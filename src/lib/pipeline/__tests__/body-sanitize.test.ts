import { describe, expect, it } from "vitest";
import { sanitizeBodyFallback } from "../body-sanitize";

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
});
