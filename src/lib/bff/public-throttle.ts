import type { NextRequest } from "next/server";

type RequestWindow = { timestamps: number[] };

const requestsByScopeAndIp = new Map<string, RequestWindow>();

function clientIp(req: NextRequest): string {
  const firstHop = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstHop || "unknown";
}

export function consumePublicThrottle(
  req: NextRequest,
  scope: string,
  limit: number,
  windowMs = 60_000,
  nowMs = Date.now(),
): boolean {
  for (const [key, entry] of requestsByScopeAndIp) {
    entry.timestamps = entry.timestamps.filter((timestamp) => nowMs - timestamp < windowMs);
    if (entry.timestamps.length === 0) requestsByScopeAndIp.delete(key);
  }

  const key = `${scope}:${clientIp(req)}`;
  const entry = requestsByScopeAndIp.get(key) ?? { timestamps: [] };
  if (entry.timestamps.length >= limit) return false;

  entry.timestamps.push(nowMs);
  requestsByScopeAndIp.set(key, entry);
  return true;
}

export function __resetPublicThrottleForTests(): void {
  requestsByScopeAndIp.clear();
}
