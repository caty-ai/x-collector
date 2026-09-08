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
  pipelineItemId: z.string().optional(),
  section: z.string(),
  position: z.number().int(),
  title: z.string().nullable(),
  titleJa: z.string().nullable(),
  url: z.string(),
  platform: z.string().optional(),
  sourceRef: z.string().nullable().optional(),
  trustLabel: z.string().nullable(),
});

export const NewsletterEditionSchema = z.object({
  id: z.string().optional(),
  editionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string(),
  slug: z.string().optional(),
  status: z.string(),
  summary: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generatedAt: IsoDateTimeSchema.nullable().optional(),
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema.optional(),
  bindingsCount: z.number().int().nonnegative(),
  voiceSignalCount: z.number().int().nonnegative().optional(),
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
