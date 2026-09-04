export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function describeLoginError(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "AccessDenied") {
    return "This Google account is not on the allowlist. Ask the administrator to add your address, or sign in with a different account.";
  }
  return "Sign-in failed. Please try again.";
}
