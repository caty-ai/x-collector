import { NextResponse, type NextRequest } from "next/server";

import { timingSafeBearerCheck } from "@/lib/auth/bearer";

const warnedMissingBearerTags = new Set<string>();

export function resetNewsletterBearerWarningsForTests(): void {
  warnedMissingBearerTags.clear();
}

export function resolveNewsletterApiKeyFromEnv(): string | undefined {
  return (
    process.env.NEWSLETTER_API_KEY?.trim() ||
    process.env.DIGEST_API_KEY?.trim() ||
    process.env.FEED_API_KEY?.trim() ||
    undefined
  );
}

export function denyUnlessNewsletterBearer(
  req: NextRequest | Request,
  options: { logTag: string },
): Response | null {
  const configuredBearer = resolveNewsletterApiKeyFromEnv();

  if (!configuredBearer) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "api key not configured" }, { status: 401 });
    }

    if (!warnedMissingBearerTags.has(options.logTag)) {
      warnedMissingBearerTags.add(options.logTag);
      console.warn(
        `[${options.logTag}] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY`,
      );
    }
    return null;
  }

  const authorization = req.headers.get("authorization");
  if (!authorization || !timingSafeBearerCheck(authorization, configuredBearer)) {
    return NextResponse.json(
      { error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>" },
      { status: 401 },
    );
  }

  return null;
}
