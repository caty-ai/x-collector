import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";
import { editionMarkdownHeaders } from "@/lib/pipeline/edition-markdown-response";

const prisma = new PrismaClient();
let warnedMissingNewsletterApiKey = false;

const editionCountInclude = {
  _count: {
    select: { bindings: true, voiceSignals: true },
  },
};

const bindingItemInclude = {
  pipelineItem: {
    select: {
      id: true,
      title: true,
      url: true,
      canonicalUrl: true,
      platform: true,
      sourceRef: true,
    },
  },
  classification: {
    select: {
      titleJa: true,
    },
  },
};

const bindingItemOrderBy = [{ section: "asc" as const }, { position: "asc" as const }];

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function parseDateParam(raw: string): { start: Date; end: Date; basis: "jst-date" } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = new Date(`${raw}T00:00:00.000+09:00`);
  const end = new Date(start.getTime() + 24 * 3600_000 - 1);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end, basis: "jst-date" };
}

function normalizeTwitterSourceHandle(platform: string, sourceRef: string | null): string | null {
  if (platform !== "twitter" || !sourceRef) return null;
  const handle = normalizeSourceHandle(sourceRef);
  return handle || null;
}

function normalizeSourceHandle(handle: string | null | undefined): string {
  return (handle || "").trim().replace(/^@/, "").toLowerCase();
}

function normalizeTrustLabel(label: string | null | undefined): string {
  if (label === "high" || label === "medium" || label === "unknown" || label === "low" || label === "blocked") {
    return label;
  }
  return "unknown";
}

function exposeTrustLabel(label: string | null | undefined): string | null {
  if (!label || label === "blocked") return null;
  return label;
}

export async function GET(req: NextRequest) {
  const apiKey =
    process.env.NEWSLETTER_API_KEY?.trim() ||
    process.env.DIGEST_API_KEY?.trim() ||
    process.env.FEED_API_KEY?.trim();
  let denied: Response | null = null;
  if (!apiKey) {
    if (isProductionRuntime()) {
      denied = NextResponse.json({ error: "api key not configured" }, { status: 401 });
    } else {
      if (!warnedMissingNewsletterApiKey) {
        warnedMissingNewsletterApiKey = true;
        console.warn(
          "[newsletter-latest-api] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
        );
      }
    }
  } else {
    const auth = req.headers.get("authorization");
    if (!auth || !timingSafeBearerCheck(auth, apiKey)) {
      denied = NextResponse.json(
        { error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>" },
        { status: 401 },
      );
    }
  }
  if (denied) {
    return denied;
  }

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  const slug = sp.get("slug");
  const includeContent = (sp.get("includeContent") || "1") !== "0";
  const includeItems = (sp.get("includeItems") || "0") !== "0";
  const format = sp.get("format");

  let edition;
  let dateBasis: "jst-date" | "slug" | "latest" = "latest";

  if (slug) {
    dateBasis = "slug";
    edition = await prisma.newsletterEdition.findUnique({
      where: { slug },
      include: editionCountInclude,
    });
  } else if (date) {
    const range = parseDateParam(date);
    if (!range) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }
    dateBasis = range.basis;

    // Intentional: an explicitly requested day never falls back across days; when format=markdown is requested,
    // empty contentMd reaches the existing markdown check below and returns 404.
    edition = await prisma.newsletterEdition.findFirst({
      where: {
        editionDate: {
          gte: range.start,
          lte: range.end,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      include: editionCountInclude,
    });
  } else {
    edition = await prisma.newsletterEdition.findFirst({
      where: {
        status: "published",
        contentMd: { not: null },
      },
      orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
      include: editionCountInclude,
    });

    if (!edition) {
      edition = await prisma.newsletterEdition.findFirst({
        where: {
          contentMd: { not: null },
        },
        orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
        include: editionCountInclude,
      });
    }
  }

  if (!edition) {
    return NextResponse.json({ error: "Edition not found" }, { status: 404 });
  }

  if (format === "markdown") {
    if (!edition.contentMd) {
      return NextResponse.json({ error: "Edition exists but contentMd is empty" }, { status: 404 });
    }

    return new NextResponse(edition.contentMd, {
      status: 200,
      headers: editionMarkdownHeaders(edition),
    });
  }

  const normalizedContent = edition.contentMd && edition.contentMd.length > 0 ? edition.contentMd : null;
  const bindings = includeItems
    ? await prisma.newsletterBinding.findMany({
        where: { editionId: edition.id },
        orderBy: bindingItemOrderBy,
        include: bindingItemInclude,
      })
    : [];
  let sourceTrustByHandle = new Map<string, string>();
  const sourceHandles = [
    ...new Set(
      bindings
        .map((binding) =>
          normalizeTwitterSourceHandle(
            binding.pipelineItem.platform,
            binding.pipelineItem.sourceRef,
          ),
        )
        .filter((handle): handle is string => Boolean(handle)),
    ),
  ];

  if (sourceHandles.length > 0) {
    try {
      const sources = await prisma.source.findMany({
        select: { handle: true, trustLabel: true },
      });

      sourceTrustByHandle = new Map(
        sources
          .map((source) => [
            normalizeSourceHandle(source.handle),
            normalizeTrustLabel(source.trustLabel),
          ] as const)
          .filter(([handle]) => Boolean(handle)),
      );
    } catch (error) {
      console.warn(
        `[newsletter-latest] source trust lookup failed; omitting trust labels: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return NextResponse.json({
    meta: {
      dateBasis,
      timeZoneForDateParam: "Asia/Tokyo",
      requestedDate: date || null,
      requestedSlug: slug || null,
    },
    edition: {
      id: edition.id,
      editionDate: edition.editionDate.toISOString().slice(0, 10),
      title: edition.title,
      slug: edition.slug,
      status: edition.status,
      summary: edition.summary,
      model: edition.model,
      generatedAt: edition.generatedAt?.toISOString() || null,
      publishedAt: edition.publishedAt?.toISOString() || null,
      createdAt: edition.createdAt.toISOString(),
      updatedAt: edition.updatedAt.toISOString(),
      bindingsCount: edition._count.bindings,
      voiceSignalCount: edition._count.voiceSignals,
      contentChars: normalizedContent?.length || 0,
      contentMd: includeContent ? normalizedContent : undefined,
      ...(includeItems
        ? {
            items: bindings.map((binding) => {
              const item = binding.pipelineItem;
              const trackedHandle = normalizeTwitterSourceHandle(item.platform, item.sourceRef);

              return {
                pipelineItemId: binding.pipelineItemId,
                section: binding.section,
                position: binding.position,
                title: item.title,
                titleJa: binding.classification?.titleJa || null,
                url: item.url || item.canonicalUrl || "",
                platform: item.platform,
                sourceRef: item.sourceRef,
                trustLabel: exposeTrustLabel(
                  trackedHandle ? sourceTrustByHandle.get(trackedHandle) : null,
                ),
              };
            }),
          }
        : {}),
    },
  });
}
