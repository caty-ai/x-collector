const DEFAULT_MASTHEAD = "AI Daily News";
const DEFAULT_TAGLINE = "AIの最新ニュースを、毎日ひとつの紙面に。";
const DEFAULT_SOURCE_REPO_URL = "https://github.com/caty-ai/x-collector";

export type PoweredBy = { label: string; url: string };
export type SourceRepoLink = { label: string; url: string };

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

export function getSourceRepoLink(): SourceRepoLink | null {
  const raw = process.env.NEWSPAPER_SOURCE_REPO_URL?.trim() ?? "";
  if (raw.toLowerCase() === "off") return null;
  if (raw === "") return { label: "GitHub", url: DEFAULT_SOURCE_REPO_URL };

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { label: "GitHub", url: DEFAULT_SOURCE_REPO_URL };
    }
    return { label: "GitHub", url: url.toString() };
  } catch {
    return { label: "GitHub", url: DEFAULT_SOURCE_REPO_URL };
  }
}

export function getXFollowHandle(): string | null {
  const handle = process.env.NEWSPAPER_X_FOLLOW_HANDLE?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}
