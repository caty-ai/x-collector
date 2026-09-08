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

export function projectPublicItem(item: FullItemJson): PublicItemJson {
  return {
    [PUBLIC_ITEM_FIELDS[0]]: item.section,
    [PUBLIC_ITEM_FIELDS[1]]: item.position,
    [PUBLIC_ITEM_FIELDS[2]]: item.title,
    [PUBLIC_ITEM_FIELDS[3]]: item.titleJa,
    [PUBLIC_ITEM_FIELDS[4]]: item.url,
    [PUBLIC_ITEM_FIELDS[5]]: item.trustLabel,
  };
}

export function projectPublicEdition(edition: FullEditionJson): PublicEditionJson {
  const projected: PublicEditionJson = {
    [PUBLIC_EDITION_FIELDS[0]]: edition.editionDate,
    [PUBLIC_EDITION_FIELDS[1]]: edition.title,
    [PUBLIC_EDITION_FIELDS[2]]: edition.status,
    [PUBLIC_EDITION_FIELDS[3]]: edition.publishedAt,
    [PUBLIC_EDITION_FIELDS[4]]: edition.bindingsCount,
    [PUBLIC_EDITION_FIELDS[5]]: edition.contentChars,
  };

  if (Object.prototype.hasOwnProperty.call(edition, "contentMd")) {
    projected[PUBLIC_EDITION_FIELDS[6]] = edition.contentMd;
  }
  if (Object.prototype.hasOwnProperty.call(edition, "items")) {
    projected[PUBLIC_EDITION_FIELDS[7]] = edition.items?.map(projectPublicItem);
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
