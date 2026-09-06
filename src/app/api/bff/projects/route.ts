import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { consumePublicThrottle } from "@/lib/bff/public-throttle";
import { resolveBffReaderAuth } from "@/lib/bff/reader-auth";
import { fetchOgImage } from "@/lib/bff/og-image";
import { getFeaturedProjects, getProjectsShelfConfig, isProjectsShelfEnabled, isPublicImageUrl } from "@/lib/projects-shelf";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

const imageCache = new Map<string, { imageUrl: string | null; expiresAt: number }>();
const inFlightImages = new Map<string, Promise<string | null>>();

async function resolveImage(url: string): Promise<string | null> {
  const cached = imageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.imageUrl;
  const pending = inFlightImages.get(url);
  if (pending) return pending;
  const lookup = fetchImage(url).finally(() => { inFlightImages.delete(url); });
  inFlightImages.set(url, lookup);
  return lookup;
}

async function fetchImage(url: string): Promise<string | null> {
  let imageUrl: string | null = null;
  try {
    const result = await fetchOgImage(url);
    if (result.kind === "found" && isPublicImageUrl(result.url)) imageUrl = result.url;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ");
    console.warn("[bff/projects] og:image unavailable:", url, message);
  }
  imageCache.set(url, { imageUrl, expiresAt: Date.now() + (imageUrl ? 6 * 60 : 30) * 60_000 });
  return imageUrl;
}

function githubRepo(input: string): string | null {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.host.toLowerCase() !== "github.com" || url.username || url.password) return null;
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  const repo = match?.[2].replace(/\.git$/i, "");
  return match && repo ? `${match[1]}/${repo}`.toLowerCase() : null;
}

async function latestReleases(sourceIds: number[]) {
  return prisma.$queryRaw<{
    sourceId: number; tagName: string | null; url: string; publishedAt: Date | null; fetchedAt: Date;
  }[]>(Prisma.sql`
    SELECT DISTINCT ON ("sourceId") "sourceId", "tagName", "url", "publishedAt", "fetchedAt"
    FROM gh_items
    WHERE type = 'release' AND "sourceId" = ANY(ARRAY[${sourceIds.length ? Prisma.join(sourceIds) : Prisma.empty}]::integer[])
    ORDER BY "sourceId", "publishedAt" DESC NULLS LAST, "fetchedAt" DESC
  `);
}

async function handleProjects(request: NextRequest) {
  try {
    if (!isProjectsShelfEnabled()) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const auth = await resolveBffReaderAuth(request);
    if (auth.mode === "denied") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if (auth.mode === "public" && !consumePublicThrottle(request, "projects", 120)) {
      return NextResponse.json({ error: "rate limit exceeded" }, {
        status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      });
    }

    const { title, tag, limit } = getProjectsShelfConfig();
    const featured = getFeaturedProjects().map((project) => ({ project, repo: githubRepo(project.url) }));
    if (featured.length) {
      const repos = featured.map(({ repo }) => repo).filter((repo): repo is string => repo !== null);
      const sources = repos.length ? await prisma.ghSource.findMany({
        where: {
          active: true, type: "repo", isPrivate: false,
          OR: repos.map((repo) => ({ repo: { equals: repo, mode: "insensitive" as const } })),
        },
        select: { id: true, repo: true, description: true },
      }) : [];
      const releases = sources.length ? await latestReleases(sources.map((source) => source.id)) : [];
      const releasesBySource = new Map(releases.map((release) => [release.sourceId, release]));
      const items = await Promise.all(featured.map(async ({ project, repo }) => {
        const source = repo ? sources.find((source) => source.repo?.toLowerCase() === repo) : undefined;
        const release = source ? releasesBySource.get(source.id) : undefined;
        const imageUrl = project.image ?? await resolveImage(project.url);
        return {
          kind: "featured", name: project.title, url: project.url,
          description: project.description ?? source?.description ?? null,
          imageUrl: imageUrl && isPublicImageUrl(imageUrl) ? imageUrl : null,
          latestTag: release?.tagName ?? null,
          latestUrl: release?.url ?? null,
          publishedAt: release?.publishedAt?.toISOString() ?? null,
        };
      }));
      return NextResponse.json({ title, mode: "featured", items }, {
        headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
      });
    }
    // Studio tags must match the normalized config exactly in lowercase (e.g. "family").
    // Filter in the database before the cap so unrelated sources cannot displace projects.
    const taggedSources = await prisma.ghSource.findMany({
      where: { active: true, type: "repo", repo: { not: null }, isPrivate: false, tags: { has: tag } },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, repo: true, description: true },
    });
    if (taggedSources.length === 200) {
      console.warn("[bff/projects] tagged sources reached 200; results may be truncated to the first 200 by name");
    }
    const sourceIds = taggedSources.map((source) => source.id);
    // DISTINCT ON bounds returned releases to one per source; cast also supports an empty shelf.
    const releases = await latestReleases(sourceIds);
    const releasesBySource = new Map(releases.map((release) => [release.sourceId, release]));
    const projects = taggedSources.map((source) => ({ source, release: releasesBySource.get(source.id) }));
    projects.sort((a, b) => {
      if (a.release && b.release) {
        const difference = (b.release.publishedAt ?? b.release.fetchedAt).getTime()
          - (a.release.publishedAt ?? a.release.fetchedAt).getTime();
        if (difference) return difference;
      } else if (a.release || b.release) {
        return a.release ? -1 : 1;
      }
      return a.source.name.localeCompare(b.source.name, "en");
    });

    return NextResponse.json({
      title,
      items: projects.slice(0, limit).map(({ source, release }) => ({
        name: source.name,
        repo: source.repo,
        repoUrl: `https://github.com/${source.repo!.split("/").map(encodeURIComponent).join("/")}`,
        description: source.description,
        latestTag: release?.tagName ?? null,
        latestUrl: release?.url ?? null,
        publishedAt: release?.publishedAt?.toISOString() ?? null,
      })),
    }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[bff/projects] unavailable:", message);
    return NextResponse.json({ error: "unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function GET(request: NextRequest) {
  return handleProjects(request);
}

export async function HEAD(request: NextRequest) {
  const response = await handleProjects(request);
  return new Response(null, { status: response.status, headers: response.headers });
}
