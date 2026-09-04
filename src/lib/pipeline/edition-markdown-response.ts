export function editionMarkdownHeaders(edition: {
  id: string;
  slug: string;
  status: string;
}): Record<string, string> {
  return {
    "content-type": "text/markdown; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-edition-id": edition.id,
    "x-edition-slug": edition.slug,
    "x-edition-status": edition.status,
  };
}
