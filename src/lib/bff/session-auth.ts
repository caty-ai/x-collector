import { getServerSession } from "next-auth";
import type { Session } from "next-auth";

import {
  isAdminEmailAllowed,
  isAllowlistConfigured,
  maskEmailForLog,
} from "@/lib/auth/admin";
import { authOptions } from "@/lib/auth/options";

export async function resolveAllowlistedSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const email = session.user?.email;
  if (isAdminEmailAllowed(email)) return session;

  const reason = isAllowlistConfigured() ? "allowlist_miss" : "allowlist_unconfigured";
  console.warn(`[bff-auth] deny email=${maskEmailForLog(email)} reason=${reason}`);
  return null;
}
