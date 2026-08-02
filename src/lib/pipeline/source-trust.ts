import { PrismaClient } from "@prisma/client";

const TRUST_RANK_MULTIPLIER = {
  high: 1.08,
  medium: 1,
  unknown: 0.95,
  low: 0.8,
} as const;

export type TrustLabel = keyof typeof TRUST_RANK_MULTIPLIER | "blocked";

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

export function normalizeSourceHandle(handle: string | null | undefined): string {
  return (handle || "").trim().replace(/^@/, "").toLowerCase();
}

// Trust resolution is intentionally Twitter-only. General platform identity is intentionally out of scope.
export function normalizeTwitterSourceHandle(platform: string, sourceRef: string | null): string | null {
  if (platform !== "twitter" || !sourceRef) return null;
  const handle = normalizeSourceHandle(sourceRef);
  return handle || null;
}

export function trustMultiplierFor(label: TrustLabel | null): number {
  if (!label || label === "blocked") return 1;
  return TRUST_RANK_MULTIPLIER[label];
}

function normalizeTrustLabel(label: string | null | undefined): TrustLabel {
  if (label === "high" || label === "medium" || label === "low" || label === "blocked") {
    return label;
  }
  return "unknown";
}

export async function loadSourceTrustByHandle(
  prisma: PrismaClient,
  handles: string[],
  logger: Pick<Console, "warn">,
): Promise<Map<string, TrustLabel> | null> {
  const uniqueHandles = [...new Set(handles.map(normalizeSourceHandle).filter(Boolean))];
  if (uniqueHandles.length === 0) return new Map();

  try {
    const sources = await prisma.source.findMany({
      select: {
        handle: true,
        trustLabel: true,
      },
    });

    return new Map(
      sources
        .map((source) => [
          normalizeSourceHandle(source.handle),
          normalizeTrustLabel(source.trustLabel),
        ] as const)
        .filter(([handle]) => Boolean(handle)),
    );
  } catch (error) {
    logger.warn(
      `[source-trust] trust lookup failed; proceeding without source trust multipliers: ${sanitizeErrorMessage(error)}`,
    );
    return null;
  }
}
