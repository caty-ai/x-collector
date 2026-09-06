import React, { createElement } from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NewsletterViewerPanel from "@/components/panels/NewsletterViewerPanel";
import ProjectsShelf from "@/components/reader/ProjectsShelf";
import type { ProjectItem } from "@/lib/projects-shelf";

// The repository uses server rendering tests, without a browser DOM renderer.
// Capture the shelf's first state/effect to exercise its fetch and render the result.
const lifecycle = vi.hoisted(() => ({
  stateIndex: 0,
  items: [] as ProjectItem[],
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (lifecycle.stateIndex++ === 0) {
        return [lifecycle.items, (items: ProjectItem[]) => { lifecycle.items = items; }];
      }
      return actual.useState(initial);
    },
    useEffect: (effect: () => void | (() => void)) => { lifecycle.effects.push(effect); },
  };
});
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("date=2026-09-06") }));

const item: ProjectItem = {
  name: "Example project", repo: "publisher/project", repoUrl: "https://github.com/publisher/project",
  description: "A useful project", latestTag: "v1.2.0", latestUrl: "https://github.com/publisher/project/releases/tag/v1.2.0",
  publishedAt: "2026-09-05T18:00:00.000Z",
};
const featuredItem: ProjectItem = {
  kind: "featured", name: "Featured project", url: "https://example.com/project",
  description: "A featured project", imageUrl: "https://example.com/image.jpg",
  latestTag: item.latestTag, latestUrl: item.latestUrl, publishedAt: item.publishedAt,
};

function render(enabled?: boolean) {
  lifecycle.stateIndex = 0;
  lifecycle.effects = [];
  return renderToStaticMarkup(createElement(NewsletterViewerPanel, {
    masthead: "Daily News",
    projectsShelf: enabled === undefined ? undefined : { enabled, title: "Our projects" },
  }));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  lifecycle.items = [];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ title: "Our projects", items: [item] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ProjectsShelf", () => {
  it("renders nothing for an empty shelf", () => {
    expect(renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [] }))).toBe("");
  });

  it("renders safe external links, clamped descriptions and shared JST dates", () => {
    const html = renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [item] }));
    expect(html).toContain('href="https://github.com/publisher/project" rel="noopener noreferrer" target="_blank"');
    expect(html).toContain(`href="${item.latestUrl}" rel="noopener noreferrer" target="_blank"`);
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("A useful project");
    expect(html).toContain(">2026-09-06</time>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it.each(["javascript:alert(1)", null])("renders the release tag as plain text for URL %s", (latestUrl) => {
    const html = renderToStaticMarkup(createElement(ProjectsShelf, {
      title: "Projects", items: [{ ...item, latestUrl }],
    }));
    expect(html).toContain(item.latestTag!);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("javascript:");
    expect(html).toContain(">2026-09-06</time>");
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "//example.com", undefined])(
    "renders unsafe or absent title href %s as text in either mode", (href) => {
      for (const card of [{ ...item, repoUrl: href }, { ...featuredItem, url: href }]) {
        const html = renderToStaticMarkup(createElement(ProjectsShelf, {
          title: "Projects", items: [{ ...card, latestTag: null }],
        }));
        expect(html).toContain(card.name);
        expect(html).not.toContain("<a ");
        expect(html).not.toContain("javascript:");
      }
    },
  );

  it("keeps repositories without releases or descriptions visible", () => {
    const html = renderToStaticMarkup(createElement(ProjectsShelf, {
      title: "Projects", items: [{ ...item, description: null, latestTag: null, latestUrl: null, publishedAt: null }],
    }));
    expect(html).toContain(item.name);
    expect(html).not.toContain("<time");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("renders featured cards with bounded images, external links and responsive scrolling", () => {
    const html = renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [featuredItem] }));
    expect(html).toContain('href="https://example.com/project" rel="noopener noreferrer" target="_blank"');
    expect(html).toContain('src="https://example.com/image.jpg" loading="lazy" decoding="async" referrerPolicy="no-referrer" alt=""');
    expect(html).toContain("aspect-[1200/630]");
    expect(html).toContain("object-cover");
    expect(html).toContain("border border-hairline");
    expect(html).toContain("overflow-x-auto snap-x snap-mandatory gap-4");
    expect(html).toContain("lg:flex-col");
    expect(html).toContain("lg:[&amp;&gt;*]:w-auto");
    expect(html).toContain("[&amp;&gt;*]:w-[80%]");
    expect(html).toContain("line-clamp-2");
    expect(html).toContain(featuredItem.description!);
    expect(html).toContain(`href="${item.latestUrl}" rel="noopener noreferrer" target="_blank"`);
    expect(html).toContain(">2026-09-06</time>");
    expect(html).not.toContain("divide-y");
  });

  it.each(["javascript:alert(1)", "data:image/png;base64,abc", "//example.com/image.jpg", null, undefined])(
    "keeps a featured card visible without an image for imageUrl %s", (imageUrl) => {
      const html = renderToStaticMarkup(createElement(ProjectsShelf, {
        title: "Projects", items: [{ ...featuredItem, imageUrl, latestTag: null, latestUrl: null, publishedAt: null }],
      }));
      expect(html).toContain(featuredItem.name);
      expect(html).toContain(featuredItem.description!);
      expect(html).toContain('href="https://example.com/project"');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<time");
      expect(html).not.toContain("aspect-[1200/630]");
      expect(html.match(/<a /g)).toHaveLength(1);
    },
  );

  it("uses the same release markup for featured cards and source rows", () => {
    for (const latestUrl of [item.latestUrl, "javascript:alert(1)", null]) {
      const source = renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [{ ...item, latestUrl }] }));
      const card = renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [{ ...featuredItem, latestUrl }] }));
      const releaseLine = /<p class="font-sans text-wired-meta text-ink\/60">.*?<\/p>/;
      expect(card.match(releaseLine)?.[0]).toBe(source.match(releaseLine)?.[0]);
    }
  });

  it("preserves legacy source markup when kind is source", () => {
    const legacy = renderToStaticMarkup(createElement(ProjectsShelf, { title: "Projects", items: [item] }));
    const source = renderToStaticMarkup(createElement(ProjectsShelf, {
      title: "Projects", items: [{ ...item, kind: "source", imageUrl: "https://example.com/ignored.jpg" }],
    }));
    expect(source).toBe(legacy);
    expect(source).toContain('class="mt-3 divide-y divide-hairline"');
    expect(source).not.toContain("<img");
  });
});

describe("projects shelf panel integration", () => {
  it.each([false, undefined])("does not fetch or render any shelf DOM when enabled is %s, even with old items", (enabled) => {
    lifecycle.items = [item];
    const html = render(enabled);
    lifecycle.effects[0]();
    expect(fetch).not.toHaveBeenCalled();
    expect(html).not.toContain("Our projects");
    expect(html).not.toContain(item.repoUrl);
    expect(html).not.toContain('aria-label="Our projects"');
    expect(html).not.toContain('<div class="mt-4"><section aria-label=');
    expect(html).not.toContain('<div class="mt-4"></div>');
  });

  it("fetches once and renders a single shelf as the last calendar child", async () => {
    expect(render(true)).not.toContain("Our projects");
    lifecycle.effects[0]();
    await vi.waitFor(() => expect(lifecycle.items).toEqual([item]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/bff/projects");
    const html = render(true);
    expect(html.match(/aria-label="Our projects"/g)).toHaveLength(1);
    const wrapper = '<div class="mt-4"><section aria-label="Our projects"';
    expect(html).toContain(wrapper);
    const shelf = html.indexOf(wrapper);
    const news = html.indexOf('class="min-w-0 flex-1 space-y-6"');
    expect(shelf).toBeGreaterThan(html.indexOf('id="reader-calendar"'));
    expect(shelf).toBeLessThan(news);
    expect(html).not.toContain('class="hidden lg:block mt-4"');
    expect(html).not.toContain('class="lg:hidden"');
    expect(html).toContain('</section></div></section><div class="min-w-0 flex-1 space-y-6">');
    expect(html.indexOf('aria-label="Our projects"', news)).toBe(-1);
    const lastShelfEnd = html.indexOf('</section>', html.lastIndexOf('aria-label="Our projects"'));
    expect(lastShelfEnd).toBeGreaterThan(shelf);
    expect(lastShelfEnd).toBeLessThan(news);
  });

  it.each(["network", "http", "json", "empty"])("silently omits the shelf for %s responses", async (kind) => {
    if (kind === "network") vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    if (kind === "http") vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
    if (kind === "json") vi.mocked(fetch).mockResolvedValue(new Response("not json"));
    if (kind === "empty") vi.mocked(fetch).mockResolvedValue(Response.json({ items: [] }));
    render(true);
    lifecycle.effects[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render(true)).not.toContain("Our projects");
    expect(render(true)).not.toContain('<div class="mt-4"></div>');
  });

  it("ignores a response received after unmount", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(true);
    const cleanup = lifecycle.effects[0]();
    if (cleanup) cleanup();
    resolve(Response.json({ items: [item] }));
    await new Promise((done) => setTimeout(done, 0));
    expect(lifecycle.items).toEqual([]);
  });
});


describe("projects shelf calendar page wiring", () => {
  it.each([undefined, "1"])("passes the configured flag %s and title to the panel", async (flag) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", flag);
    vi.stubEnv("NEWSPAPER_PROJECTS_TITLE", "Calendar projects");
    const { default: CalendarPage } = await import("@/app/calendar/page");
    lifecycle.stateIndex = 0;
    lifecycle.effects = [];
    lifecycle.items = [item];
    const html = renderToStaticMarkup(createElement(CalendarPage, { searchParams: { date: "2026-09-06" } }));
    lifecycle.effects[0]();
    expect(html).toContain('id="reader-calendar"');
    if (flag === undefined) {
      expect(fetch).not.toHaveBeenCalled();
      expect(html).not.toContain('aria-label="Calendar projects"');
      expect(html).not.toContain(item.repoUrl);
      expect(html).not.toContain('<div class="mt-4"></div>');
    } else {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("/api/bff/projects");
      expect(html.match(/aria-label="Calendar projects"/g)).toHaveLength(1);
    }
  });
});
