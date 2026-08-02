import { z } from "zod";

import { IsoDateTimeSchema } from "@/lib/contracts/feed";

export const NewsletterDateBasisSchema = z.enum(["jst-date", "slug", "latest"]);

export const NewsletterEditionMetaSchema = z.object({
  dateBasis: NewsletterDateBasisSchema,
  timeZoneForDateParam: z.literal("Asia/Tokyo"),
  requestedDate: z.string().nullable(),
  requestedSlug: z.string().nullable(),
});

export const NewsletterEditionItemSchema = z.object({
  pipelineItemId: z.string(),
  section: z.string(),
  position: z.number().int(),
  title: z.string().nullable(),
  titleJa: z.string().nullable(),
  url: z.string(),
  platform: z.string(),
  sourceRef: z.string().nullable(),
  trustLabel: z.string().nullable(),
});

export const NewsletterEditionSchema = z.object({
  id: z.string(),
  editionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string(),
  slug: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  model: z.string().nullable(),
  generatedAt: IsoDateTimeSchema.nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  bindingsCount: z.number().int().nonnegative(),
  voiceSignalCount: z.number().int().nonnegative(),
  contentChars: z.number().int().nonnegative(),
  contentMd: z.string().nullable().optional(),
  items: z.array(NewsletterEditionItemSchema).optional(),
});

export const NewsletterLatestResponseSchema = z.object({
  meta: NewsletterEditionMetaSchema,
  edition: NewsletterEditionSchema,
});

export type NewsletterLatestResponse = z.infer<typeof NewsletterLatestResponseSchema>;
export type NewsletterEdition = z.infer<typeof NewsletterEditionSchema>;
export type NewsletterEditionItem = z.infer<typeof NewsletterEditionItemSchema>;
