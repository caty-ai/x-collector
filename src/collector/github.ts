import { Prisma, PrismaClient } from "@prisma/client";
import { userAgent } from "../lib/branding";

const prisma = new PrismaClient();

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  author?: { login?: string };
  published_at?: string;
}

interface GitHubRepo {
  id: number;
  full_name: string;
  description?: string;
  html_url: string;
  stargazers_count?: number;
  forks_count?: number;
  language?: string;
  topics?: string[];
  owner?: { login?: string };
  pushed_at?: string;
  created_at?: string;
}

const GITHUB_API_URL = "https://api.github.com";
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent(),
    "Accept": "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Extract owner/repo from a GitHub URL or return as-is if already in that format.
 */
export function extractRepo(input: string): string {
  try {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) return match[1];
    return input.trim();
  } catch {
    return input.trim();
  }
}

async function upsertRelease(release: GitHubRelease, sourceId: number) {
  const itemId = `${release.tag_name}`;
  if (!itemId) return null;

  return prisma.ghItem.upsert({
    where: { id: itemId },
    create: {
      id: itemId,
      sourceId,
      type: "release",
      title: release.name || release.tag_name,
      body: release.body || null,
      url: release.html_url,
      author: release.author?.login || null,
      tagName: release.tag_name,
      publishedAt: release.published_at ? new Date(release.published_at) : null,
    },
    update: {
      title: release.name || release.tag_name,
      body: release.body || null,
      author: release.author?.login || null,
      fetchedAt: new Date(),
    },
  });
}

async function upsertRepo(repo: GitHubRepo, sourceId: number) {
  const itemId = repo.full_name;
  if (!itemId) return null;

  return prisma.ghItem.upsert({
    where: { id: itemId },
    create: {
      id: itemId,
      sourceId,
      type: "repo",
      title: repo.full_name,
      body: repo.description || null,
      url: repo.html_url,
      author: repo.owner?.login || null,
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      language: repo.language || null,
      topics: repo.topics || [],
      publishedAt: repo.pushed_at ? new Date(repo.pushed_at) : repo.created_at ? new Date(repo.created_at) : null,
    },
    update: {
      title: repo.full_name,
      body: repo.description || null,
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      language: repo.language || null,
      topics: repo.topics || [],
      fetchedAt: new Date(),
    },
  });
}

/**
 * Fetch items for a single source.
 * Returns { upserted, error? }
 */
export async function fetchSourceItems(
  source: { id: number; name: string; type: string; repo?: string | null; query?: string | null },
  maxItemsOverride?: number
): Promise<{ upserted: number; error?: string }> {
  const maxItems = maxItemsOverride ?? 30;

  try {
    let upserted = 0;

    if (source.type === "repo" && source.repo) {
      // Mode 1: Repo Releases
      const apiUrl = `${GITHUB_API_URL}/repos/${source.repo}/releases?per_page=${Math.min(maxItems, 100)}`;

      const res = await fetch(apiUrl, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorMsg = `HTTP ${res.status}`;
        if (res.status === 403) {
          return { upserted: 0, error: "Rate limited. Set GITHUB_TOKEN for higher limits." };
        }
        if (res.status === 404) {
          return { upserted: 0, error: "Repository not found." };
        }
        return { upserted: 0, error: errorMsg };
      }

      const releases: GitHubRelease[] = await res.json();

      if (!Array.isArray(releases)) {
        return { upserted: 0, error: "Invalid response format" };
      }

      for (const release of releases) {
        if (!release.tag_name) continue;

        try {
          await upsertRelease(release, source.id);
          upserted++;
        } catch (err) {
          console.error(`  [GitHub] Error upserting release ${release.tag_name}:`, err);
        }

        await delay(50);
      }
    } else if (source.type === "search" && source.query) {
      // Mode 2: Search/Trending
      const apiUrl = `${GITHUB_API_URL}/search/repositories?q=${encodeURIComponent(source.query)}&sort=stars&order=desc&per_page=${Math.min(maxItems, 100)}`;

      const res = await fetch(apiUrl, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorMsg = `HTTP ${res.status}`;
        if (res.status === 403) {
          return { upserted: 0, error: "Rate limited. Set GITHUB_TOKEN for higher limits." };
        }
        return { upserted: 0, error: errorMsg };
      }

      const data = await res.json();
      const repos: GitHubRepo[] = data?.items || [];

      if (!Array.isArray(repos)) {
        return { upserted: 0, error: "Invalid response format" };
      }

      for (const repo of repos) {
        if (!repo.full_name) continue;

        try {
          await upsertRepo(repo, source.id);
          upserted++;
        } catch (err) {
          console.error(`  [GitHub] Error upserting repo ${repo.full_name}:`, err);
        }

        await delay(50);
      }
    } else {
      return { upserted: 0, error: "Invalid source configuration" };
    }

    // Update lastFetchedAt
    await prisma.ghSource.update({
      where: { id: source.id },
      data: { lastFetchedAt: new Date() },
    });

    return { upserted };
  } catch (err: any) {
    return { upserted: 0, error: err.message || "Unknown error" };
  }
}

export async function collectGithub(): Promise<CollectorCounters> {
  const sources = await prisma.ghSource.findMany({ where: { active: true } });
  console.log(`[GitHub] Found ${sources.length} active GitHub sources`);

  if (sources.length === 0) {
    console.log("[GitHub] No sources to collect");
    return { sources: 0, errors: 0, total: 0 };
  }

  const run = await prisma.run.create({ data: { kind: "github_collect" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      console.log(`[GitHub] Fetching items for "${source.name}" (type: ${source.type}, repo/query: ${source.repo || source.query})...`);
      const result = await fetchSourceItems(source);
      total += result.upserted;
      if (result.error) {
        console.error(`  [GitHub] Error: ${result.error}`);
        errors++;
      } else {
        console.log(`  [GitHub] Upserted ${result.upserted} items for "${source.name}"`);
      }
      // Respectful delay between sources
      await delay(1000);
    } catch (err) {
      console.error(`  [GitHub] Error for "${source.name}":`, err);
      errors++;
    }
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      status: errors ? "partial" : "done",
      meta: { total, errors },
    },
  });

  console.log(`[GitHub] Run #${run.id} complete: ${total} items, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectGithub()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
