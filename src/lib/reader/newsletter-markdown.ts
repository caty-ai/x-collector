export type Article = { title: string; body: string; source: string };
export type Section = { title: string; intro: string; articles: Article[] };

export type ParsedNewsletter = {
  title: string;
  preamble: string;
  sections: Section[];
};

/** Accepts both 引用元: and 引用元： as source markers. */
export function extractArticleBodyAndSource(lines: string[]): Pick<Article, "body" | "source"> {
  const sourceMarker = /^\s*引用元[:：]\s*(.+)\s*$/;
  let sourceLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (sourceMarker.test(lines[index])) {
      sourceLineIndex = index;
      break;
    }
  }

  if (sourceLineIndex === -1) {
    return { body: lines.join("\n").trim(), source: "" };
  }

  const source = lines[sourceLineIndex].replace(sourceMarker, "$1").trim();
  const body = lines
    .filter((_, index) => index !== sourceLineIndex)
    .join("\n")
    .trim();

  return { body, source };
}

export function parseNewsletterMarkdown(markdown: string): ParsedNewsletter {
  const sections: Section[] = [];
  const preambleLines: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let title = "";
  let currentSection: { title: string; introLines: string[]; articles: Article[] } | null = null;
  let currentArticle: { title: string; bodyLines: string[] } | null = null;

  const flushArticle = () => {
    if (!currentSection || !currentArticle) return;

    const { body, source } = extractArticleBodyAndSource(currentArticle.bodyLines);
    currentSection.articles.push({
      title: currentArticle.title,
      body,
      source,
    });
    currentArticle = null;
  };

  const flushSection = () => {
    if (!currentSection) return;

    flushArticle();
    sections.push({
      title: currentSection.title,
      intro: currentSection.introLines.join("\n").trim(),
      articles: currentSection.articles,
    });
    currentSection = null;
  };

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      title = title || h1Match[1].trim();
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushSection();
      currentSection = {
        title: h2Match[1].trim(),
        introLines: [],
        articles: [],
      };
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && currentSection) {
      flushArticle();
      currentArticle = {
        title: h3Match[1].trim(),
        bodyLines: [],
      };
      continue;
    }

    if (currentArticle) {
      currentArticle.bodyLines.push(line);
      continue;
    }

    if (currentSection) {
      currentSection.introLines.push(line);
      continue;
    }

    preambleLines.push(line);
  }

  flushSection();

  return { title, preamble: preambleLines.join("\n").trim(), sections };
}

