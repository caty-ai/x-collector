import { z } from "zod";

export const FamilyFeedItemSchema = z.object({
  id: z.string(),
  platform: z.string(),
  author: z.string().nullable(),
  sourceRef: z.string().nullable(),
  url: z.string().url().or(z.literal("")).catch(""),
  title: z.string(),
  titleJa: z.string().nullable(),
  summaryJa: z.string().nullable(),
  tags: z.array(z.string()),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  classifiedAt: z.string().datetime({ offset: true }),
  topicClusterKey: z.string().nullable(),
  clusterKey: z.string().nullable().optional(),
  distinctSources: z.number().int().nonnegative().nullable(),
  clusterSize: z.number().int().nonnegative().nullable(),
  mentionedBy: z.number().int().nonnegative().nullable(),
});

export const FamilyFeedItemsSchema = z.array(z.unknown()).transform((raw) => {
  const items: z.infer<typeof FamilyFeedItemSchema>[] = [];
  const dropped: number[] = [];
  raw.forEach((entry, index) => {
    const parsed = FamilyFeedItemSchema.safeParse(entry);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      dropped.push(index);
    }
  });
  if (dropped.length > 0 && typeof console !== "undefined") {
    console.warn(
      `[family-feed] dropped ${dropped.length} malformed item(s) at index(es) ${dropped.join(", ")}`,
    );
  }
  return items;
});

export const FamilyFeedMetaSchema = z.object({
  window: z.object({ from: z.string(), to: z.string(), basis: z.string() }),
  totalItems: z.number().int().nonnegative(),
  counts: z.record(z.number().int().nonnegative()),
  nextSince: z.string().datetime({ offset: true }).nullable().optional(),
  truncated: z.boolean().optional(),
  filters: z
    .object({
      tags: z.array(z.string()).nullable().optional(),
      keywords: z.array(z.string()).nullable().optional(),
      since: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const FamilyFeedResponseSchema = z.object({
  meta: FamilyFeedMetaSchema,
  items: FamilyFeedItemsSchema,
});

export type FamilyFeedItem = z.infer<typeof FamilyFeedItemSchema>;
export type FamilyFeedResponse = z.infer<typeof FamilyFeedResponseSchema>;
