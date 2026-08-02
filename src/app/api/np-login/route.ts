import { NextRequest, NextResponse } from "next/server";

import {
  createSharedCookieValue,
  SHARED_COOKIE_MAX_AGE_SECONDS,
  SHARED_COOKIE_NAME,
  verifySharedCredentials,
} from "@/lib/auth/shared-newspaper";

const failedAttemptWindowMs = 15 * 60 * 1000;
const maxFailedAttempts = 5;
const tooManyAttemptsMessage = "試行回数が多すぎます。しばらく待ってから再度お試しください。";

type FailedAttemptEntry = {
  count: number;
  firstAttemptMs: number;
};

// Railway runs this as a single container, so an in-memory per-IP throttle is sufficient here.
const failedAttemptsByIp = new Map<string, FailedAttemptEntry>();

function redirectTo(pathname: string): NextResponse {
  // Relative Location (RFC 7231): behind Railway's proxy req.url is the internal
  // origin (localhost:8080), so an absolute redirect would leave the public site.
  return new NextResponse(null, { status: 303, headers: { Location: pathname } });
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  return firstHop || "unknown";
}

function pruneStaleFailedAttempts(nowMs: number): void {
  for (const [ip, entry] of failedAttemptsByIp) {
    if (nowMs - entry.firstAttemptMs > failedAttemptWindowMs) {
      failedAttemptsByIp.delete(ip);
    }
  }
}

function isRateLimited(ip: string, nowMs: number): boolean {
  const entry = failedAttemptsByIp.get(ip);
  if (!entry) return false;
  if (nowMs - entry.firstAttemptMs > failedAttemptWindowMs) {
    failedAttemptsByIp.delete(ip);
    return false;
  }
  return entry.count >= maxFailedAttempts;
}

function recordFailedAttempt(ip: string, nowMs: number): void {
  const entry = failedAttemptsByIp.get(ip);
  if (!entry || nowMs - entry.firstAttemptMs > failedAttemptWindowMs) {
    failedAttemptsByIp.set(ip, { count: 1, firstAttemptMs: nowMs });
    return;
  }

  entry.count += 1;
}

function clearFailedAttempts(ip: string): void {
  failedAttemptsByIp.delete(ip);
}

function tooManyAttemptsResponse(): NextResponse {
  return new NextResponse(tooManyAttemptsMessage, {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function handleFailedLogin(ip: string, nowMs: number): Promise<NextResponse> {
  recordFailedAttempt(ip, nowMs);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return redirectTo("/np-login?error=1");
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const nowMs = Date.now();
  pruneStaleFailedAttempts(nowMs);
  if (isRateLimited(ip, nowMs)) return tooManyAttemptsResponse();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return handleFailedLogin(ip, nowMs);
  }

  const id = formData.get("id");
  const password = formData.get("password");

  const valid =
    typeof id === "string" &&
    typeof password === "string" &&
    (await verifySharedCredentials(id, password));

  if (!valid) {
    return handleFailedLogin(ip, nowMs);
  }

  const cookieValue = await createSharedCookieValue();
  if (!cookieValue) return redirectTo("/np-login?error=1");

  clearFailedAttempts(ip);

  const response = redirectTo("/calendar");
  response.cookies.set(SHARED_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SHARED_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
