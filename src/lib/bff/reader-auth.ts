import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";

import { authOptions } from "@/lib/auth/options";
import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";

export type BffReaderAuth =
  | { mode: "public" }
  | { mode: "session" }
  | { mode: "shared" }
  | { mode: "denied" };

export async function resolveBffReaderAuth(req: NextRequest): Promise<BffReaderAuth> {
  const session = await getServerSession(authOptions);
  if (session) return { mode: "session" };

  const hasSharedAccess = await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value);
  if (hasSharedAccess) return { mode: "shared" };

  if (isNewspaperPublic()) return { mode: "public" };
  return { mode: "denied" };
}
