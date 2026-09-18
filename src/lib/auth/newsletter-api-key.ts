import { type NextRequest } from "next/server";

import { denyUnlessBearer, resetBearerGateWarningsForTests } from "@/lib/auth/bearer-gate";

export function resetNewsletterBearerWarningsForTests(): void {
  resetBearerGateWarningsForTests();
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
  return denyUnlessBearer(req, {
    logTag: options.logTag,
    resolveConfiguredBearer: resolveNewsletterApiKeyFromEnv,
    missingEnvHint: "NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
    unauthorizedBody: { error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>" },
  });
}
