const INLINE_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(raw: string): string {
  return raw.replace(
    /&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi,
    (entity, numeric: string | undefined, named: string | undefined) => {
      if (numeric) {
        const hexadecimal = numeric[0].toLowerCase() === "x";
        const codePoint = Number.parseInt(numeric.slice(hexadecimal ? 1 : 0), hexadecimal ? 16 : 10);
        if (
          Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          (codePoint < 0xd800 || codePoint > 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return entity;
      }

      return named ? INLINE_ENTITY_MAP[named.toLowerCase()] ?? entity : entity;
    },
  );
}

const HTML_TAG_PATTERN = new RegExp(
  "<\\/?(?:a|abbr|article|aside|audio|b|big|blockquote|body|br|button|canvas|caption|center|cite|code|col|colgroup|dd|del|details|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|font|footer|form|h1|h2|h3|h4|h5|h6|head|header|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|marquee|meta|nav|noscript|object|ol|option|p|param|picture|pre|q|rb|rp|rt|ruby|s|script|section|select|small|source|span|strike|strong|style|sub|summary|sup|svg|path|g|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|tt|u|ul|var|video|wbr)(?=[\\s/>])[^<>]*>",
  "gi",
);

function removeLeadingFrontmatter(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  const lines = withoutBom.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim() !== "");

  if (firstContentLine >= 0 && lines[firstContentLine].trim() === "---") {
    const closingLine = lines.findIndex(
      (line, index) => index > firstContentLine && line.trim() === "---",
    );
    if (closingLine >= 0) return lines.slice(closingLine + 1).join("\n");
  }

  return withoutBom.replace(/^\s*---[ \t]+[\w-]+:[^\n]*?---[ \t]*/, "");
}

function removeFencedCodeBlocks(raw: string): string {
  const keptLines: string[] = [];
  const pendingLines: string[] = [];
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trimStart();
    if (fenceCharacter) {
      const closingRun = trimmed.match(/^(`+|~+)/)?.[0] || "";
      if (
        closingRun[0] === fenceCharacter &&
        closingRun.length >= fenceLength &&
        trimmed.slice(closingRun.length).trim() === ""
      ) {
        fenceCharacter = null;
        fenceLength = 0;
        pendingLines.length = 0;
      } else {
        pendingLines.push(line);
      }
      continue;
    }

    const openingRun = trimmed.match(/^(`{3,}|~{3,})/)?.[0];
    if (openingRun) {
      fenceCharacter = openingRun[0] as "`" | "~";
      fenceLength = openingRun.length;
      continue;
    }
    keptLines.push(line);
  }

  return (fenceCharacter ? keptLines.concat(pendingLines) : keptLines).join("\n");
}

function removeHtmlComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

function removeElementWithContent(raw: string, tagName: "script" | "style"): string {
  const closed = new RegExp(`<${tagName}(?=[\\s>])[^>]*>[\\s\\S]*?<\\/${tagName}\\s*>`, "gi");
  const unclosed = new RegExp(`<${tagName}(?=[\\s>])[^>]*>[\\s\\S]*$`, "gi");
  return raw.replace(closed, " ").replace(unclosed, " ");
}

function unwrapEmphasis(raw: string): string {
  return raw
    .replace(/(^|[\s\p{P}])\*\*([^*\n]+)\*\*(?=$|[\s\p{P}])/gu, "$1$2")
    .replace(/(^|[\s\p{P}])__([^_\n]+)__(?=$|[\s\p{P}])/gu, "$1$2")
    .replace(/(^|[\s\p{P}])\*([^*\n]+)\*(?=$|[\s\p{P}])/gu, "$1$2")
    .replace(/(^|[\s\p{P}])_([^_\n]+)_(?=$|[\s\p{P}])/gu, "$1$2");
}

function sanitizeMarkdownLine(line: string): string | null {
  let sanitized = line.replace(/^\s*#{1,6}(?:\s+|$)/, "");
  sanitized = sanitized.replace(/^\s*(?:>\s*)+/, "");
  if (/^\s*\|/.test(sanitized)) return null;
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(sanitized)) return null;
  sanitized = sanitized.replace(/^\s*(?:[-*+]|\d{1,2}[.)])(?:\s+|$)/, "");
  sanitized = sanitized.replace(/^\s*\[(?: |x|X)\]\s+/, "");
  return sanitized;
}

function stripGenericHtmlTokens(raw: string): string {
  return raw.replace(
    /<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*)?>/g,
    (token, _tagName: string, offset: number) => {
      const tagName = _tagName;
      const previousNonWhitespace = raw.slice(0, offset).match(/\S(?=\s*$)/)?.[0] || "";
      const hasAttributes = /\s/.test(token.slice(1, -1));
      const isShortIdentifier = /^[A-Za-z][A-Za-z0-9]{0,2}$/.test(tagName);

      if (
        token.includes("@") ||
        (!token.startsWith("</") &&
          !hasAttributes &&
          !/[:-]/.test(tagName) &&
          (/[\p{L}\p{N}]/u.test(previousNonWhitespace) || isShortIdentifier))
      ) {
        return token;
      }
      return " ";
    },
  );
}

export function sanitizeBodyFallback(raw: string | null | undefined): string {
  if (!raw) return "";

  try {
    let sanitized = raw.replace(/\r\n?/g, "\n");
    sanitized = removeLeadingFrontmatter(sanitized);
    sanitized = removeFencedCodeBlocks(sanitized).replace(/`+/g, "");
    sanitized = removeHtmlComments(sanitized);
    sanitized = removeElementWithContent(sanitized, "script");
    sanitized = removeElementWithContent(sanitized, "style");
    sanitized = sanitized.replace(/<(https?:\/\/[^<>\s]+)>/gi, "$1");
    sanitized = sanitized.replace(HTML_TAG_PATTERN, " ");
    sanitized = stripGenericHtmlTokens(sanitized);
    sanitized = sanitized.replace(/!\[[^[\]\n]*\]\([^()\n]*\)/g, "");
    sanitized = sanitized.replace(/\[([^[\]\n]+)\]\([^()\n]*\)/g, "$1");
    sanitized = unwrapEmphasis(sanitized);

    sanitized = sanitized
      .split("\n")
      .map(sanitizeMarkdownLine)
      .filter((line): line is string => line !== null)
      .join(" ")
      .replace(/(^|\s)-{3,}(?=\s|$)/g, " ")
      .replace(/(^|\s)#{1,6}(?=\s)/g, " ")
      .replace(/(^|\s):?-{2,}:?(?=\s|$)/g, " ")
      .replace(/(^|\s)<(https?:\/\/[^\s<>]*)$/gi, "$1$2")
      .replace(/(^|\s)<[A-Za-z][^<>]*(?=…|$)/g, "$1");

    sanitized = decodeHtmlEntities(sanitized)
      .replace(/\s+/g, " ")
      .replace(/\s+([.,!?。！？])/g, "$1")
      .trim();

    return sanitized.replace(/^(?:\s*#{1,6}(?=\s))+\s*/, "").trim();
  } catch {
    return String(raw).replace(/\s+/g, " ").trim();
  }
}
