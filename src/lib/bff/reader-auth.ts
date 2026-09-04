import type { NextRequest } from "next/server";

import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";
import { resolveAllowlistedSession } from "@/lib/bff/session-auth";

export type BffReaderAuth =
  | { mode: "public" }
  | { mode: "session" }
  | { mode: "shared" }
  | { mode: "denied" };

export async function resolveBffReaderAuth(req: NextRequest): Promise<BffReaderAuth> {
  const session = await resolveAllowlistedSession();
  if (session) return { mode: "session" };

  const hasSharedAccess = await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value);
  if (hasSharedAccess) return { mode: "shared" };

  if (isNewspaperPublic()) return { mode: "public" };
  return { mode: "denied" };
}
