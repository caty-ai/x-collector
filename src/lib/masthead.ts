const DEFAULT_MASTHEAD = "AI Daily News";

export function getMasthead(): string {
  return process.env.NEWSPAPER_MASTHEAD?.trim() || DEFAULT_MASTHEAD;
}
