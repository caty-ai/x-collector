export type ProjectItem = {
  name: string;
  repo?: string;
  repoUrl?: string;
  url?: string;
  imageUrl?: string | null;
  kind?: "featured" | "source";
  description: string | null;
  latestTag: string | null;
  latestUrl: string | null;
  publishedAt: string | null;
};

export type FeaturedProject = {
  title: string;
  url: string;
  description?: string;
  image?: string;
};

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Inspect the original authority because URL removes an explicit default :443 port.
    const authority = /^https:\/\/([^/?#\\]+)/i.exec(value.trim())?.[1];
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    return url.protocol === "https:" && !!authority && !/[:@\s]/.test(authority)
      && !url.username && !url.password && !url.port
      && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !hostname.startsWith("[")
      && hostname !== "localhost" && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local") && !hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

let cachedFeaturedRaw: string | undefined;
let cachedFeaturedProjects: FeaturedProject[] = [];

export function getFeaturedProjects(): FeaturedProject[] {
  const raw = process.env.NEWSPAPER_PROJECTS_FEATURED;
  if (raw !== cachedFeaturedRaw) {
    cachedFeaturedRaw = raw;
    cachedFeaturedProjects = parseFeaturedProjects(raw);
  }
  return cachedFeaturedProjects;
}

function parseFeaturedProjects(raw: string | undefined): FeaturedProject[] {
  if (raw !== undefined && new TextEncoder().encode(raw).length > 8 * 1024) {
    console.warn("[projects-shelf] NEWSPAPER_PROJECTS_FEATURED exceeds 8 KiB; ignoring config");
    return [];
  }
  if (!raw?.trim()) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    console.warn("[projects-shelf] NEWSPAPER_PROJECTS_FEATURED must be a JSON array");
    return [];
  }
  if (!Array.isArray(entries)) {
    console.warn("[projects-shelf] NEWSPAPER_PROJECTS_FEATURED must be a JSON array");
    return [];
  }
  if (entries.length > 3) console.warn("[projects-shelf] featured projects limited to the first 3 entries");
  const projects: FeaturedProject[] = [];
  entries.slice(0, 3).forEach((entry: unknown, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      console.warn(`[projects-shelf] invalid featured entry ${index + 1}`);
      return;
    }
    const { title, url, description, image } = entry as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim() || title.trim().length > 80
      || !httpUrl(url) || (image !== undefined && (!httpUrl(image) || new URL(image).protocol !== "https:"))
      || (description !== undefined && typeof description !== "string")) {
      console.warn(`[projects-shelf] invalid featured entry ${index + 1}`);
      return;
    }
    projects.push({
      title: title.trim(), url: url.trim(),
      ...(typeof description === "string" ? { description: description.trim() } : {}),
      ...(typeof image === "string" ? { image: image.trim() } : {}),
    });
  });
  return projects;
}

export function isFeaturedMode(): boolean {
  return getFeaturedProjects().length > 0;
}

export function isProjectsShelfEnabled(): boolean {
  return ["1", "true"].includes(process.env.NEWSPAPER_PROJECTS_SHELF?.trim().toLowerCase() ?? "");
}

export function getProjectsShelfConfig() {
  const rawLimit = process.env.NEWSPAPER_PROJECTS_LIMIT?.trim();
  const limit = rawLimit ? Number(rawLimit) : 12;
  return {
    tag: process.env.NEWSPAPER_PROJECTS_TAG?.trim().toLowerCase() || "family",
    title: process.env.NEWSPAPER_PROJECTS_TITLE?.trim() || "Projects",
    limit: Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.trunc(limit))) : 12,
  };
}
