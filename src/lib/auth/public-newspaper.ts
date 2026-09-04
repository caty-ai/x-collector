export function isNewspaperPublic(
  env: Record<string, string | undefined> = process.env,
): boolean {
  // Read through the injected object: edge bundlers may inline direct process.env.X member reads.
  const value = env.NEWSPAPER_PUBLIC?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function isReaderPath(pathname: string): boolean {
  return pathname === "/calendar" || pathname.startsWith("/calendar/");
}

export type ReaderAccessInput = {
  pathname: string;
  hasToken: boolean;
  tokenAllowlisted: boolean;
  hasSharedCookie: boolean;
  isPublic: boolean;
};

export type ReaderAccessDecision = "next" | "redirect_np_login";

export function decideReaderAccess(input: ReaderAccessInput): ReaderAccessDecision {
  if (input.isPublic) return "next";
  if (input.hasToken && input.tokenAllowlisted) return "next";
  if (input.hasSharedCookie) return "next";
  return "redirect_np_login";
}
