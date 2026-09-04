import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComposeScriptRow,
  composeNewsletterEditionScript,
  renderArticleBlock,
  resolveScriptSummaryMaxChars,
} from "../compose-edition-script";

const editionDate = new Date("2026-09-04T00:00:00.000Z");

function row(overrides: Partial<ComposeScriptRow> = {}): ComposeScriptRow {
  return {
    bindingId: 1,
    pipelineItemId: "item-1",
    section: "2_update",
    position: 1,
    blurb: "short blurb",
    title: "Original title",
    titleJa: "日本語タイトル",
    summaryJa: null,
    body: "Body summary.",
    url: "https://example.test/item-1",
    platform: "example",
    publishedAt: editionDate,
    primaryTag: "UPDATE",
    subTag: null,
    actionTag: "INFO",
    finalHeadlineScore: 0,
    topicClusterKey: null,
    distinctSources: 0,
    topicClusterBadge: null,
    ...overrides,
  };
}

function composeStub(options: { publishedAt?: Date | null; body?: string } = {}) {
  const pipelineRun = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 11 })),
    update: vi.fn(async () => undefined),
  };
  const editionUpdate = vi.fn(async (args: Record<string, any>) => args);
  const publishedAt = options.publishedAt === undefined ? null : options.publishedAt;
  const prisma = {
    newsletterEdition: {
      findUnique: vi.fn(async () => ({
        id: "edition-1",
        editionDate,
        publishedAt,
      })),
      update: editionUpdate,
    },
    newsletterBinding: {
      findMany: vi.fn(async () => [{
        id: 1,
        pipelineItemId: "item-1",
        section: "2_update",
        position: 1,
        blurb: "short blurb",
        pipelineItem: {
          id: "item-1",
          title: "Original title",
          body: options.body ?? "Body summary.",
          url: "https://example.test/item-1",
          canonicalUrl: null,
          platform: "example",
          publishedAt: editionDate,
        },
        classification: {
          primaryTag: "UPDATE",
          subTag: null,
          actionTag: "INFO",
          titleJa: "日本語タイトル",
          summaryJa: null,
        },
      }]),
    },
    pipelineCrosslinkLlmDecision: { findMany: vi.fn(async () => []) },
    pipelineRun,
  };

  return { editionUpdate, pipelineRun, prisma: prisma as any };
}

describe("compose script rendering", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the stable article shape without Why it matters and sanitizes body fallback", () => {
    const rendered = renderArticleBlock(
      row({
        body: "---\ntitle: hidden\n---\n## Clean <strong>body</strong>. Second.",
        blurb: "Ignored blurb.",
      }),
      320,
      false,
    );

    expect(rendered).toContain("### Original title\nClean body.\nSecond.\n引用元: [example](https://example.test/item-1)");
    expect(rendered).not.toContain("Why it matters");
    expect(rendered).not.toContain("hidden");
    expect(rendered).not.toContain("Ignored blurb");
  });

  it("uses localized summary first and guards empty rendered summaries", () => {
    expect(renderArticleBlock(row({ summaryJa: "日本語要約。", body: "English body." }), 320, true))
      .toContain("日本語要約。");
    expect(renderArticleBlock(row({ body: "。。。", blurb: null }), 320, false))
      .toContain("\n概要情報なし。\n引用元:");
  });

  it("ignores summaryJa and uses sanitized body when title localization is disabled", () => {
    const rendered = renderArticleBlock(
      row({
        summaryJa: "Ignored Japanese summary.",
        body: "## Body fallback.",
        blurb: "Blurb fallback.",
      }),
      320,
      false,
    );

    expect(rendered).toContain("### Original title\nBody fallback.\n引用元:");
    expect(rendered).not.toContain("Ignored Japanese summary");
    expect(rendered).not.toContain("Blurb fallback");
  });

  it("resolves the new default independently of the test environment override", () => {
    expect(resolveScriptSummaryMaxChars(undefined)).toBe(320);
    expect(resolveScriptSummaryMaxChars("220")).toBe(220);
    expect(resolveScriptSummaryMaxChars("abc")).toBe(320);
  });

  it("keeps dry-run side-effect free and returns sanitized captured content", async () => {
    vi.stubEnv("STEP_LOCALIZE_JA", "false");
    const malformed = `Body ${String.fromCharCode(0xd800)} summary.`;
    const { editionUpdate, pipelineRun, prisma } = composeStub({ body: malformed });

    const result = await composeNewsletterEditionScript(prisma, {
      editionDate,
      dryRun: true,
      captureContent: true,
      summaryMaxChars: 320,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(pipelineRun.findFirst).not.toHaveBeenCalled();
    expect(pipelineRun.create).not.toHaveBeenCalled();
    expect(pipelineRun.update).not.toHaveBeenCalled();
    expect(editionUpdate).not.toHaveBeenCalled();
    expect(result.contentMd).toContain("Body � summary.");
    expect(result.contentMd).not.toContain(String.fromCharCode(0xd800));
  });

  it("preserves an existing publish timestamp on a non-dry recompose", async () => {
    vi.stubEnv("STEP_LOCALIZE_JA", "false");
    const originalPublishedAt = new Date("2026-09-04T03:00:00.000Z");
    const { editionUpdate, pipelineRun, prisma } = composeStub({ publishedAt: originalPublishedAt });

    await composeNewsletterEditionScript(prisma, {
      editionDate,
      dryRun: false,
      summaryMaxChars: 320,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(editionUpdate).toHaveBeenCalledOnce();
    expect(editionUpdate.mock.calls[0][0].data).toMatchObject({
      status: "published",
      publishedAt: originalPublishedAt,
    });
    expect(pipelineRun.create).toHaveBeenCalledOnce();
    expect(pipelineRun.update).toHaveBeenCalledOnce();
  });

  it("sets a fresh publish timestamp for an edition that was never published", async () => {
    vi.stubEnv("STEP_LOCALIZE_JA", "false");
    const { editionUpdate, prisma } = composeStub({ publishedAt: null });
    const before = Date.now();

    await composeNewsletterEditionScript(prisma, {
      editionDate,
      dryRun: false,
      captureContent: true,
      summaryMaxChars: 320,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const data = editionUpdate.mock.calls[0][0].data;
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(data.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.contentMd).toContain("### Original title");
  });
});
