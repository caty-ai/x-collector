import { NextResponse, type NextRequest } from "next/server";

import { timingSafeBearerCheck } from "@/lib/auth/bearer";

export type BearerGateSpec = {
  /** Warn-once key and log prefix, e.g. "feed-api". */
  logTag: string;
  /** Resolves the configured Bearer value (already trimmed) or undefined. */
  resolveConfiguredBearer: () => string | undefined;
  /** Env names shown in the non-production warning. */
  missingEnvHint: string;
  /** JSON body of the 401 for a missing / wrong Bearer. */
  unauthorizedBody: Record<string, unknown>;
  /** Extra headers on that 401. */
  unauthorizedHeaders?: Record<string, string>;
  /** Require the Authorization header to match /^Bearer\s+(.+)$/i. */
  requireBearerScheme?: boolean;
};

const warnedMissingBearerTags = new Set<string>();

export function resetBearerGateWarningsForTests(): void {
  warnedMissingBearerTags.clear();
}

export function denyUnlessBearer(
  req: NextRequest | Request,
  spec: BearerGateSpec,
): Response | null {
  const configuredBearer = spec.resolveConfiguredBearer();
  if (!configuredBearer) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "api key not configured" }, { status: 401 });
    }
    if (!warnedMissingBearerTags.has(spec.logTag)) {
      warnedMissingBearerTags.add(spec.logTag);
      console.warn(
        `[${spec.logTag}] API auth disabled outside production; missing env: ${spec.missingEnvHint}`,
      );
    }
    return null;
  }

  const authorization = req.headers.get("authorization");
  const schemeOk = spec.requireBearerScheme ? /^Bearer\s+(.+)$/i.test(authorization ?? "") : true;
  if (!schemeOk || !authorization || !timingSafeBearerCheck(authorization, configuredBearer)) {
    return NextResponse.json(spec.unauthorizedBody, {
      status: 401,
      ...(spec.unauthorizedHeaders ? { headers: spec.unauthorizedHeaders } : {}),
    });
  }
  return null;
}
