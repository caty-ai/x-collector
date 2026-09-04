import { describe, expect, it } from "vitest";
import { editionMarkdownHeaders } from "../edition-markdown-response";

describe("editionMarkdownHeaders", () => {
  it("returns exactly the markdown response headers with edition metadata", () => {
    expect(
      editionMarkdownHeaders({
        id: "edition-1",
        slug: "2026-09-04",
        status: "published",
      }),
    ).toEqual({
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-edition-id": "edition-1",
      "x-edition-slug": "2026-09-04",
      "x-edition-status": "published",
    });
  });
});
