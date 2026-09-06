import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFeaturedProjects, isPublicImageUrl, isFeaturedMode, getProjectsShelfConfig, isProjectsShelfEnabled } from "@/lib/projects-shelf";

beforeEach(() => {
  for (const key of ["SHELF", "TAG", "TITLE", "LIMIT", "FEATURED"]) {
    vi.stubEnv(`NEWSPAPER_PROJECTS_${key}`, undefined);
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("projects shelf configuration", () => {
  it("defaults to disabled with neutral display settings", () => {
    expect(isProjectsShelfEnabled()).toBe(false);
    expect(getProjectsShelfConfig()).toEqual({ tag: "family", title: "Projects", limit: 12 });
  });

  it.each(["1", "true", "TRUE", " True ", " 1 "])("enables for %j", (value) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", value);
    expect(isProjectsShelfEnabled()).toBe(true);
  });

  it.each(["", " ", "0", "false", "yes", "on", "2", "true-ish"])("stays disabled for %j", (value) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", value);
    expect(isProjectsShelfEnabled()).toBe(false);
  });

  it("normalizes the selector and trims the configured title", () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_TAG", " MyProjects ");
    vi.stubEnv("NEWSPAPER_PROJECTS_TITLE", " Our projects ");
    expect(getProjectsShelfConfig()).toMatchObject({ tag: "myprojects", title: "Our projects" });
  });

  it("uses defaults for blank tag and title", () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_TAG", "  ");
    vi.stubEnv("NEWSPAPER_PROJECTS_TITLE", "  ");
    expect(getProjectsShelfConfig()).toMatchObject({ tag: "family", title: "Projects" });
  });

  it.each([
    ["", 12], [" ", 12], ["invalid", 12], ["Infinity", 12],
    ["0", 1], ["-10", 1], ["1", 1], [" 24 ", 24], ["50", 50], ["999", 50], ["2.9", 2],
  ])("parses limit %j as %s", (value, expected) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_LIMIT", value);
    expect(getProjectsShelfConfig().limit).toBe(expected);
  });
});

describe("featured project configuration", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it("defaults to sources mode", () => {
    expect(getFeaturedProjects()).toEqual([]);
    expect(isFeaturedMode()).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts three entries, trims fields, and exposes only configured fields", () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify([
      { title: " First ", url: " https://example.com/one ", description: " Description ", image: " https://example.com/image.png ", secret: "omit" },
      { title: "Second", url: "http://example.com/two" },
      { title: "a".repeat(80), url: "https://example.com/three" },
    ]));
    expect(getFeaturedProjects()).toEqual([
      { title: "First", url: "https://example.com/one", description: "Description", image: "https://example.com/image.png" },
      { title: "Second", url: "http://example.com/two" },
      { title: "a".repeat(80), url: "https://example.com/three" },
    ]);
    expect(isFeaturedMode()).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(["{", "null", "{}", '"string"', "42"])("treats invalid JSON or non-array %s as unset with one warning", (raw) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", raw);
    expect(getFeaturedProjects()).toEqual([]);
    expect(getFeaturedProjects()).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, [], 1, {}, { title: " " }, { title: "a".repeat(81) },
    { url: "https://user:token@example.com/" }, { image: "https://user:token@example.com/" },
    { url: "https://user@example.com/" }, { image: "https://:token@example.com/" },
    { url: "javascript:alert(1)" }, { url: "ftp://example.com" }, { url: "/relative" },
    { image: "http://example.com/image.png" },
    { image: "data:image/png;base64,abc" }, { image: "invalid" }, { image: null },
    { description: 42 },
  ])("drops invalid entry %j with one warning and retains valid siblings", (invalid) => {
    const good = { title: "Valid", url: "https://example.com" };
    const entry = invalid && typeof invalid === "object" && !Array.isArray(invalid)
      ? { ...good, ...invalid, ...(Object.keys(invalid).length ? {} : { title: undefined }) }
      : invalid;
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify([entry, good]));
    expect(getFeaturedProjects()).toEqual([good]);
    expect(getFeaturedProjects()).toEqual([good]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("[projects-shelf] invalid featured entry 1");
  });

  it("retains only the first three configured entries and warns once", () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({ title: String(index), url: `https://example.com/${index}` }));
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify(entries));
    expect(getFeaturedProjects()).toEqual(entries.slice(0, 3));
    expect(getFeaturedProjects()).toEqual(entries.slice(0, 3));
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("does not validate overflow entries", () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({ title: String(index), url: "https://example.com" }));
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify([...entries, null, { image: "invalid" }]));
    expect(getFeaturedProjects()).toEqual(entries);
    expect(getFeaturedProjects()).toEqual(entries);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("[projects-shelf] featured projects limited to the first 3 entries");
  });

  it.each([" ".repeat(8193), JSON.stringify([{ title: "Large", url: "https://example.com", description: "あ".repeat(2800) }])])("treats an oversized raw config as unset and warns once", (raw) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", raw);
    expect(getFeaturedProjects()).toEqual([]);
    expect(isFeaturedMode()).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 8 KiB and reparses only when the raw environment changes", () => {
    const first = [{ title: "First", url: "https://example.com" }];
    const raw = JSON.stringify(first).padEnd(8192, " ");
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", raw);
    const parse = vi.spyOn(JSON, "parse");
    expect(getFeaturedProjects()).toEqual(first);
    expect(getFeaturedProjects()).toEqual(first);
    expect(isFeaturedMode()).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    const second = [{ title: "Second", url: "https://example.org" }];
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify(second));
    expect(getFeaturedProjects()).toEqual(second);
    expect(parse).toHaveBeenCalledTimes(2);
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", undefined);
    expect(getFeaturedProjects()).toEqual([]);
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", raw);
    expect(getFeaturedProjects()).toEqual(first);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not replace an invalid first-three entry with an overflow entry", () => {
    const good = { title: "Valid", url: "https://example.com" };
    vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify([null, good, good, good]));
    expect(getFeaturedProjects()).toEqual([good, good]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("public image URLs", () => {
  it.each([
    "http://example.com/image.png", "https://127.0.0.1/image.png", "https://8.8.8.8/image.png",
    "https://[::1]/image.png", "https://[2001:4860:4860::8888]/image.png", "https://2130706433/image.png",
    "https://localhost/image.png", "https://app.localhost/image.png", "https://app.local/image.png",
    "https://app.internal/image.png", "https://APP.INTERNAL./image.png", "https://localhost./image.png",
    "https://user:token@example.com/", "https://user@example.com/", "https://:token@example.com/",
    "https://example.com:8443/image.png", "https://example.com:443/image.png", "invalid", "/relative.png",
  ])("rejects %s", (url) => expect(isPublicImageUrl(url)).toBe(false));

  it.each(["https://avatars.githubusercontent.com/u/1", "https://opengraph.githubassets.com/hash/org/repo"])("accepts %s", (url) => {
    expect(isPublicImageUrl(url)).toBe(true);
  });
});
