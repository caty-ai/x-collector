import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const FeedDateBasisSchema = z.enum(["jst-date", "explicit-range", "rolling-24h"]);

export const FeedItemSchema = z.object({
  id: z.string(),
  platform: z.string(),
  title: z.string(),
  text: z.string(),
  // docs/api-contract-ui-v1.md
  // Resilient: malformed upstream URLs must never crash the whole feed.
  // An invalid URL is coerced to "" (item kept, rendered without a link).
  url: z.string().url().or(z.literal("")).catch(""),
  author: z.string().nullable(),
  sourceName: z.string().nullable(),
  tags: z.array(z.string()),
  publishedAt: IsoDateTimeSchema,
  metrics: z.record(z.number()).nullable(),
});

export const FeedMetaSchema = z.object({
  from: IsoDateTimeSchema,
  to: IsoDateTimeSchema,
  dateBasis: FeedDateBasisSchema,
  timeZoneForDateParam: z.literal("Asia/Tokyo"),
  platforms: z.array(z.string()),
  keyword: z.string().nullable(),
  source: z.string().nullable(),
  totalItems: z.number().int().nonnegative(),
  counts: z.record(z.number().int().nonnegative()),
});

// Resilient items parser: a single malformed item must never reject the whole
// response. Each entry is validated independently; failures are dropped (and
// logged) instead of throwing, so one bad row can't blank the entire screen.
export const FeedItemsSchema = z.array(z.unknown()).transform((raw) => {
  const items: z.infer<typeof FeedItemSchema>[] = [];
  const dropped: number[] = [];
  raw.forEach((entry, index) => {
    const parsed = FeedItemSchema.safeParse(entry);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      dropped.push(index);
    }
  });
  if (dropped.length > 0 && typeof console !== "undefined") {
    console.warn(
      `[feed] dropped ${dropped.length} malformed item(s) at index(es) ${dropped.join(", ")}`,
    );
  }
  return items;
});

export const FeedResponseSchema = z.object({
  meta: FeedMetaSchema,
  items: FeedItemsSchema,
});

export type FeedResponse = z.infer<typeof FeedResponseSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;
