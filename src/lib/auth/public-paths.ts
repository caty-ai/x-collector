export const PUBLIC_ARTICLE_PATH_RE = /^\/a\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{12}\/?$/;

export function isPublicArticlePath(pathname: string): boolean {
  if (pathname.includes("%")) return false;
  return PUBLIC_ARTICLE_PATH_RE.test(pathname);
}

export function isPublicArticleRequest(pathname: string, method: string | undefined): boolean {
  const normalizedMethod = method?.toUpperCase();
  return (normalizedMethod === "GET" || normalizedMethod === "HEAD") && isPublicArticlePath(pathname);
}
