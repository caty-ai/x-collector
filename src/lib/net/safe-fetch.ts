import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

export type SafeAddress = {
  address: string;
  family: number;
};

type ResponseHeaders = Record<string, string | string[] | undefined>;

type SafeFetchResponse = {
  status: number;
  headers: ResponseHeaders;
  body: string;
};

type SafeRequestTarget = {
  hostname: string;
  addresses: SafeAddress[];
};

export type SafeFetchDependencies = {
  lookupAll?: (hostname: string, signal: AbortSignal) => Promise<SafeAddress[]>;
  request?: (options: {
    url: URL;
    target: SafeRequestTarget;
    method: string;
    headers: Record<string, string>;
    signal: AbortSignal;
    maxBodyBytes?: number;
  }) => Promise<SafeFetchResponse>;
};

type ValidateSafeHttpUrlOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  dependencies?: SafeFetchDependencies;
};

type SafeFetchTextOptions = {
  method?: "GET";
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRedirects?: number;
  maxBodyBytes?: number;
  dependencies?: SafeFetchDependencies;
};

export type SafeFetchTextResult = {
  url: string;
  status: number;
  headers: ResponseHeaders;
  body: string;
};

const DEFAULT_MAX_REDIRECTS = 3;

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname).toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "internal" ||
    normalized.endsWith(".internal")
  );
}

function isBlockedIp(address: string): boolean {
  let parsed: ReturnType<typeof ipaddr.parse>;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return true;
  }

  let effective = parsed;
  if (
    parsed.range() === "ipv4Mapped" &&
    "isIPv4MappedAddress" in parsed &&
    parsed.isIPv4MappedAddress() &&
    "toIPv4Address" in parsed
  ) {
    effective = parsed.toIPv4Address();
  }

  return effective.range() !== "unicast";
}

function ensureHttpUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new Error("URL must use http or https");
  }
  return url;
}

async function defaultLookupAll(hostname: string, signal: AbortSignal): Promise<SafeAddress[]> {
  if (signal.aborted) {
    throw new Error("Aborted");
  }

  let removeAbortListener = () => {};
  const abortPromise = new Promise<SafeAddress[]>((_, reject) => {
    const abort = () => reject(new Error("Aborted"));
    removeAbortListener = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
  });

  try {
    return await Promise.race([lookup(hostname, { all: true, verbatim: true }), abortPromise]);
  } finally {
    removeAbortListener();
  }
}

async function resolveSafeRequestTarget(
  url: URL,
  signal: AbortSignal,
  dependencies?: SafeFetchDependencies,
): Promise<SafeRequestTarget> {
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new Error("URL must use http or https");
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Blocked IP: ${hostname}`);
    }

    return {
      hostname,
      addresses: [{ address: hostname, family: literalFamily }],
    };
  }

  const lookupAll = dependencies?.lookupAll ?? defaultLookupAll;
  const addresses = await lookupAll(hostname, signal);

  if (addresses.length === 0) {
    throw new Error(`No DNS records for hostname: ${hostname}`);
  }

  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error(`Blocked DNS answer for hostname: ${hostname}`);
  }

  return { hostname, addresses };
}

function firstHeader(headers: ResponseHeaders, name: string): string | null {
  const direct = headers[name];
  if (Array.isArray(direct)) return direct[0] ?? null;
  if (typeof direct === "string") return direct;

  const foundKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (!foundKey) return null;

  const value = headers[foundKey];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function readResponseBody(
  response: import("node:http").IncomingMessage,
  signal: AbortSignal,
  maxBodyBytes?: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let consumed = 0;
  let body = "";
  const abort = () => response.destroy(new Error("Aborted"));

  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const value of response) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (maxBodyBytes != null) {
        const remaining = maxBodyBytes - consumed;
        if (remaining <= 0) {
          response.destroy();
          break;
        }

        const chunk = buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer;
        consumed += chunk.byteLength;
        body += decoder.decode(chunk, { stream: true });

        if (buffer.byteLength > chunk.byteLength || consumed >= maxBodyBytes) {
          response.destroy();
          break;
        }

        continue;
      }

      body += decoder.decode(buffer, { stream: true });
    }

    return body + decoder.decode();
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function defaultPinnedRequest(options: {
  url: URL;
  target: SafeRequestTarget;
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  maxBodyBytes?: number;
}): Promise<SafeFetchResponse> {
  const pinnedAddress = options.target.addresses[0];
  if (!pinnedAddress) {
    throw new Error("No validated address");
  }

  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
        return;
      }

      callback(null, pinnedAddress.address, pinnedAddress.family);
    };

    const request = (options.url.protocol === "https:" ? requestHttps : requestHttp)(
      {
        protocol: options.url.protocol,
        hostname: options.target.hostname,
        port: options.url.port || undefined,
        path: `${options.url.pathname}${options.url.search}`,
        method: options.method,
        headers: options.headers,
        lookup: pinnedLookup,
      },
      async (response) => {
        try {
          const body = await readResponseBody(response, options.signal, options.maxBodyBytes);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        } catch (error) {
          reject(error);
        }
      },
    );

    const abort = () => request.destroy(new Error("Aborted"));
    options.signal.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.on("close", () => {
      options.signal.removeEventListener("abort", abort);
    });
    request.end();
  });
}

function createScopedSignal(timeoutMs?: number, signal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timers: NodeJS.Timeout[] = [];
  const removers: Array<() => void> = [];

  if (timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    const timer = setTimeout(() => controller.abort(new Error("Timed out")), timeoutMs);
    timers.push(timer);
  }

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const forward = () => controller.abort(signal.reason);
      signal.addEventListener("abort", forward, { once: true });
      removers.push(() => signal.removeEventListener("abort", forward));
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const timer of timers) clearTimeout(timer);
      for (const remove of removers) remove();
    },
  };
}

export function isSafePublicHttpUrl(input: string | URL): boolean {
  try {
    const url = ensureHttpUrl(input);
    const hostname = normalizeHostname(url.hostname);

    if (isBlockedHostname(hostname)) {
      return false;
    }

    const literalFamily = isIP(hostname);
    return !literalFamily || !isBlockedIp(hostname);
  } catch {
    return false;
  }
}

export async function validateSafeHttpUrl(
  input: string | URL,
  options: ValidateSafeHttpUrlOptions = {},
): Promise<URL> {
  const url = ensureHttpUrl(input);
  const scoped = createScopedSignal(options.timeoutMs, options.signal);

  try {
    await resolveSafeRequestTarget(url, scoped.signal, options.dependencies);
    return url;
  } finally {
    scoped.cleanup();
  }
}

export async function safeFetchText(
  input: string | URL,
  options: SafeFetchTextOptions = {},
): Promise<SafeFetchTextResult> {
  const initialUrl = ensureHttpUrl(input);
  const method = options.method ?? "GET";
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const request = options.dependencies?.request ?? defaultPinnedRequest;
  const scoped = createScopedSignal(options.timeoutMs, options.signal);

  try {
    let currentUrl = initialUrl;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const target = await resolveSafeRequestTarget(currentUrl, scoped.signal, options.dependencies);
      const response = await request({
        url: currentUrl,
        target,
        method,
        headers: options.headers ?? {},
        signal: scoped.signal,
        maxBodyBytes: options.maxBodyBytes,
      });

      if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= maxRedirects) {
          throw new Error(`Too many redirects for URL: ${currentUrl.toString()}`);
        }

        const location = firstHeader(response.headers, "location");
        if (!location) {
          throw new Error(`Redirect missing location header for URL: ${currentUrl.toString()}`);
        }

        currentUrl = new URL(location, currentUrl);
        continue;
      }

      return {
        url: currentUrl.toString(),
        status: response.status,
        headers: response.headers,
        body: response.body,
      };
    }

    throw new Error(`Too many redirects for URL: ${initialUrl.toString()}`);
  } finally {
    scoped.cleanup();
  }
}
