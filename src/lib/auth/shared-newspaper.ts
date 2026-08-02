import { timingSafeEqual } from "@/lib/auth/bearer";

export const SHARED_COOKIE_NAME = "np_shared";
export const SHARED_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const credentialHmacKey = "np-shared-credentials-v1";
const cookieMessage = "np-shared-v1";
const sharedCookieFutureSkewSeconds = 60;
const devInsecureAuthSecret = "dev-insecure-auth-secret";

type SharedAuthConfig = {
  id: string;
  password: string;
  secret: string;
};

function getSharedAuthConfig(): SharedAuthConfig | null {
  const id = process.env.NEWSPAPER_SHARED_ID;
  const password = process.env.NEWSPAPER_SHARED_PASSWORD;
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";

  if (!id || !password || !secret || secret === devInsecureAuthSecret) return null;

  return { id, password, secret };
}

function encodeUtf8Buffer(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToAsciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

async function signHmac(key: string, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encodeUtf8Buffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encodeUtf8Buffer(value));
  return new Uint8Array(signature);
}

async function hmacEqual(key: string, candidate: string, expected: string): Promise<boolean> {
  const [candidateDigest, expectedDigest] = await Promise.all([
    signHmac(key, candidate),
    signHmac(key, expected),
  ]);
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export async function verifySharedCredentials(id: string, pw: string): Promise<boolean> {
  const config = getSharedAuthConfig();
  if (!config) return false;

  const [idMatches, passwordMatches] = await Promise.all([
    hmacEqual(credentialHmacKey, id, config.id),
    hmacEqual(credentialHmacKey, pw, config.password),
  ]);

  return idMatches && passwordMatches;
}

export async function createSharedCookieValue(nowMs = Date.now()): Promise<string | null> {
  const config = getSharedAuthConfig();
  if (!config) return null;

  const iatSeconds = Math.floor(nowMs / 1000);
  const signature = await signHmac(`${config.secret}:${config.password}`, `${cookieMessage}:${iatSeconds}`);
  return `${iatSeconds}.${base64UrlEncode(signature)}`;
}

export async function verifySharedCookie(value: string | undefined | null, nowMs = Date.now()): Promise<boolean> {
  if (!value) return false;

  const config = getSharedAuthConfig();
  if (!config) return false;

  const cookieParts = value.split(".");
  if (cookieParts.length !== 2) return false;

  const [iatValue, signature] = cookieParts;
  if (!iatValue || !signature || !/^\d+$/.test(iatValue)) return false;

  const iatSeconds = Number(iatValue);
  if (!Number.isSafeInteger(iatSeconds)) return false;

  const nowSeconds = Math.floor(nowMs / 1000);
  if (nowSeconds - iatSeconds > SHARED_COOKIE_MAX_AGE_SECONDS) return false;
  if (iatSeconds > nowSeconds + sharedCookieFutureSkewSeconds) return false;

  const expectedSignature = base64UrlEncode(
    await signHmac(`${config.secret}:${config.password}`, `${cookieMessage}:${iatSeconds}`),
  );

  return timingSafeEqual(stringToAsciiBytes(signature), stringToAsciiBytes(expectedSignature));
}
