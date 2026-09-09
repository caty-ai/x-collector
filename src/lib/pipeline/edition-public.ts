export const PUBLIC_META_FIELDS = [
  "dateBasis",
  "timeZoneForDateParam",
  "requestedDate",
  "requestedSlug",
] as const;

export const PUBLIC_EDITION_FIELDS = [
  "editionDate",
  "title",
  "status",
  "publishedAt",
  "bindingsCount",
  "contentChars",
  "contentMd",
  "items",
] as const;

export type PublicMetaJson = {
  dateBasis: string | null;
  timeZoneForDateParam: string | null;
  requestedDate: string | null;
  requestedSlug: string | null;
};

export const PUBLIC_ITEM_FIELDS = [
  "section",
  "position",
  "title",
  "titleJa",
  "url",
  "trustLabel",
] as const;

export type FullItemJson = {
  pipelineItemId: string;
  section: string;
  position: number;
  title: string | null;
  titleJa: string | null;
  url: string;
  platform: string;
  sourceRef: string | null;
  trustLabel: string | null;
};

export type FullEditionJson = {
  id: string;
  editionDate: string;
  title: string;
  slug: string;
  status: string;
  summary: string | null;
  model: string | null;
  generatedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bindingsCount: number;
  voiceSignalCount: number;
  contentChars: number;
  contentMd?: string | null;
  items?: FullItemJson[];
};

export type PublicItemJson = Pick<
  FullItemJson,
  "section" | "position" | "title" | "titleJa" | "url" | "trustLabel"
>;

export type PublicEditionJson = Pick<
  FullEditionJson,
  "editionDate" | "title" | "status" | "publishedAt" | "bindingsCount" | "contentChars"
> & {
  contentMd?: string | null;
  items?: PublicItemJson[];
};

type DateRange = { start: Date; end: Date };
type EditionOrderBy = Array<
  { editionDate: "desc"; updatedAt?: never } | { updatedAt: "desc"; editionDate?: never }
>;
type EditionWhere = {
  slug?: string;
  status?: "published";
  contentMd?: { not: null };
  editionDate?: { gte: Date; lte: Date };
};

type EditionLookupQuery = {
  where: EditionWhere;
  orderBy?: EditionOrderBy;
};

export type EditionLookup =
  | {
      method: "findUnique";
      primary: { where: { slug: string } };
      fallback: null;
    }
  | {
      method: "findFirst";
      primary: EditionLookupQuery;
      fallback: EditionLookupQuery | null;
    };

export function projectPublicMeta(meta: unknown): PublicMetaJson {
  const source =
    typeof meta === "object" && meta !== null && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : null;

  return {
    dateBasis: typeof source?.dateBasis === "string" ? source.dateBasis : null,
    timeZoneForDateParam:
      typeof source?.timeZoneForDateParam === "string" ? source.timeZoneForDateParam : null,
    requestedDate: typeof source?.requestedDate === "string" ? source.requestedDate : null,
    requestedSlug: typeof source?.requestedSlug === "string" ? source.requestedSlug : null,
  };
}

export function parseEditionStatusParam(
  raw: string | null,
): { ok: true; status: "published" | null } | { ok: false } {
  if (raw === null || raw === "published") {
    return { ok: true, status: raw };
  }
  return { ok: false };
}

export function parseEditionProjectionParam(
  raw: string | null,
): { ok: true; projection: "public" | null } | { ok: false } {
  if (raw === null || raw === "public") {
    return { ok: true, projection: raw };
  }
  return { ok: false };
}

export function buildEditionLookup(input: {
  slug: string | null;
  dateRange: DateRange | null;
  publishedOnly: boolean;
}): EditionLookup {
  if (input.slug) {
    return {
      method: input.publishedOnly ? "findFirst" : "findUnique",
      primary: {
        where: {
          slug: input.slug,
          ...(input.publishedOnly ? { status: "published" as const } : {}),
        },
      },
      fallback: null,
    };
  }

  if (input.dateRange) {
    return {
      method: "findFirst",
      primary: {
        where: {
          editionDate: {
            gte: input.dateRange.start,
            lte: input.dateRange.end,
          },
          ...(input.publishedOnly ? { status: "published" as const } : {}),
        },
        orderBy: [{ updatedAt: "desc" }],
      },
      fallback: null,
    };
  }

  return {
    method: "findFirst",
    primary: {
      where: {
        status: "published",
        contentMd: { not: null },
      },
      orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
    },
    fallback: input.publishedOnly
      ? null
      : {
          where: {
            contentMd: { not: null },
          },
          orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
        },
  };
}

export function projectPublicItem(item: PublicItemJson): PublicItemJson {
  return {
    section: item.section,
    position: item.position,
    title: item.title,
    titleJa: item.titleJa,
    url: item.url,
    trustLabel: item.trustLabel,
  };
}

export function projectPublicEdition(edition: PublicEditionJson): PublicEditionJson {
  const projected: PublicEditionJson = {
    editionDate: edition.editionDate,
    title: edition.title,
    status: edition.status,
    publishedAt: edition.publishedAt,
    bindingsCount: edition.bindingsCount,
    contentChars: edition.contentChars,
  };

  if (Object.prototype.hasOwnProperty.call(edition, "contentMd")) {
    projected.contentMd = edition.contentMd;
  }
  if (Object.prototype.hasOwnProperty.call(edition, "items")) {
    projected.items = edition.items?.map(projectPublicItem);
  }

  return projected;
}

export function publicMarkdownHeaders(edition: { status: string }): Record<string, string> {
  return {
    "content-type": "text/markdown; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-edition-status": edition.status,
  };
}
