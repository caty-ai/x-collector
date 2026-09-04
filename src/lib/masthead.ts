const DEFAULT_MASTHEAD = "AI Daily News";
const DEFAULT_TAGLINE = "AIの最新ニュースを、毎日ひとつの紙面に。";

export type PoweredBy = { label: string; url: string };

export function getMasthead(): string {
  return process.env.NEWSPAPER_MASTHEAD?.trim() || DEFAULT_MASTHEAD;
}

export function getTagline(): string {
  return process.env.NEWSPAPER_TAGLINE?.trim() || DEFAULT_TAGLINE;
}

export function getPoweredBy(): PoweredBy | null {
  const label = process.env.NEWSPAPER_POWERED_BY_LABEL?.trim();
  const rawUrl = process.env.NEWSPAPER_POWERED_BY_URL?.trim();
  if (!label || !rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { label, url: url.toString() };
  } catch {
    return null;
  }
}
