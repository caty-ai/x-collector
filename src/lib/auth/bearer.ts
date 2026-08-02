const textEncoder = new TextEncoder();

/** Constant-time byte comparison. */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}

/** Extracts the Bearer token from an Authorization header and compares it in constant time. */
export function timingSafeBearerCheck(authHeader: string | null, expected: string): boolean {
  if (authHeader === null) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  return timingSafeEqual(textEncoder.encode(token), textEncoder.encode(expected));
}
