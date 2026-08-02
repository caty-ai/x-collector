import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { isAdminEmailAllowed, maskEmailForLog } from "@/lib/auth/admin";
import { authOptions } from "@/lib/auth/options";

export async function requireStudioSession() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminEmailAllowed(session.user?.email)) {
    console.warn(
      `[auth-studio] deny email=${maskEmailForLog(session.user?.email)} reason=allowlist_miss_or_unconfigured`,
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
