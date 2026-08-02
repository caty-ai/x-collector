import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const fallbackGoogleClientId = "missing-google-client-id";
const fallbackGoogleClientSecret = "missing-google-client-secret";
const fallbackAuthSecret = "dev-insecure-auth-secret";

function isProductionRuntime(): boolean {
  // `next build` evaluates route modules with NODE_ENV=production; the fail-fast
  // must fire at server start, not at build time (builds may run without secrets).
  return process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

function throwMissingEnv(group: string): never {
  throw new Error(`[auth-options] Missing required env in production: ${group}`);
}

const missingFallbackGroups: string[] = [];

function assertProductionValue(
  value: string,
  group: string,
  invalidValues: string[],
): string {
  if (isProductionRuntime() && invalidValues.includes(value)) {
    throwMissingEnv(group);
  }

  return value;
}

function resolveAuthSecret(): string {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (value) {
    return assertProductionValue(value, "AUTH_SECRET | NEXTAUTH_SECRET", [fallbackAuthSecret]);
  }
  if (isProductionRuntime()) {
    throwMissingEnv("AUTH_SECRET | NEXTAUTH_SECRET");
  }

  missingFallbackGroups.push("AUTH_SECRET | NEXTAUTH_SECRET");
  return fallbackAuthSecret;
}

function resolveGoogleClientId(): string {
  const value = process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID;
  if (value) {
    return assertProductionValue(value, "AUTH_GOOGLE_ID | GOOGLE_CLIENT_ID", [fallbackGoogleClientId]);
  }
  if (isProductionRuntime()) {
    throwMissingEnv("AUTH_GOOGLE_ID | GOOGLE_CLIENT_ID");
  }

  missingFallbackGroups.push("AUTH_GOOGLE_ID | GOOGLE_CLIENT_ID");
  return fallbackGoogleClientId;
}

function resolveGoogleClientSecret(): string {
  const value = process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (value) {
    return assertProductionValue(value, "AUTH_GOOGLE_SECRET | GOOGLE_CLIENT_SECRET", [
      fallbackGoogleClientSecret,
    ]);
  }
  if (isProductionRuntime()) {
    throwMissingEnv("AUTH_GOOGLE_SECRET | GOOGLE_CLIENT_SECRET");
  }

  missingFallbackGroups.push("AUTH_GOOGLE_SECRET | GOOGLE_CLIENT_SECRET");
  return fallbackGoogleClientSecret;
}

export const authSecret = resolveAuthSecret();

const googleClientId = resolveGoogleClientId();
const googleClientSecret = resolveGoogleClientSecret();

if (!isProductionRuntime() && missingFallbackGroups.length > 0) {
  console.warn(
    `[auth-options] development fallbacks active; missing env: ${missingFallbackGroups.join(", ")}`,
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
};
