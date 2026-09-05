import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";

export const MARKDOWN_CLASS_NAME =
  "max-w-none space-y-4 font-wired-serif text-base leading-7 text-ink [&_a]:font-sans [&_blockquote]:border-l [&_blockquote]:border-ink [&_blockquote]:pl-4 [&_blockquote]:text-ink/70 [&_code]:border [&_code]:border-hairline [&_code]:bg-paper [&_code]:px-1 [&_code]:py-0.5 [&_h1]:font-wired-serif [&_h1]:text-wired-display-md [&_h1]:font-normal [&_h1]:text-ink [&_h2]:mt-8 [&_h2]:font-wired-serif [&_h2]:text-wired-display-sm [&_h2]:font-normal [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:font-sans [&_h3]:text-wired-meta [&_h3]:font-bold [&_h3]:uppercase [&_h3]:text-ink [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p:first-of-type]:text-lg [&_p:first-of-type]:leading-8 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-paper [&_pre]:p-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link underline underline-offset-2 hover:opacity-80"
    />
  ),
};

export function renderMarkdown(markdown: string, extraComponents?: Components) {
  return (
    <ReactMarkdown
      skipHtml
      className={MARKDOWN_CLASS_NAME}
      components={{ ...MARKDOWN_COMPONENTS, ...extraComponents }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
