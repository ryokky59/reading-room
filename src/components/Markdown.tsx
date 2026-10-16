"use client";

import { Marked } from "marked";
import { useMemo } from "react";

// Raw HTML in model output is dropped, and only http(s) links are kept.
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: () => "",
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href)) return text;
      return `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => marked.parse(text, { async: false }), [text]);
  return <div className={`prose-read ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
