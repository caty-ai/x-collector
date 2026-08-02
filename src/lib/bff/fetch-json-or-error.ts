import { z } from "zod";

import { ErrorResponseSchema } from "@/lib/contracts/feed";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function getSchemaIssueSummary(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "unknown schema issue";

  const path = first.path.length > 0 ? first.path.join(".") : "root";
  return `${path}: ${first.message}`;
}

// Accept any zod schema (including transform/catch schemas whose input type
// differs from their output type) and return the parsed OUTPUT type.
export async function fetchJsonOrError<S extends z.ZodTypeAny>(
  input: RequestInfo | URL,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const response = await fetch(input, {
    ...init,
    // Undici's default allows a slow-drip response to hang for minutes;
    // callers can pass their own signal to override.
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    const message = parsedError.success ? parsedError.data.error : `HTTP ${response.status}`;
    throw new HttpError(message, response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid response schema: ${getSchemaIssueSummary(parsed.error)}`);
  }

  return parsed.data;
}
