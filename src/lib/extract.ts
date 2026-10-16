import "server-only";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type Extracted = {
  title: string | null;
  html: string | null;
  text: string | null;
  excerpt: string | null;
};

const EMPTY: Extracted = { title: null, html: null, text: null, excerpt: null };

function decode(buf: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buf);
  let charset = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (!charset) {
    // Look for <meta charset> in the first few KB, read as latin1 so bytes survive.
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export async function extractArticle(url: string): Promise<Extracted> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return EMPTY;
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return EMPTY;

  const html = decode(await res.arrayBuffer(), res.headers.get("content-type"));
  const { document } = parseHTML(html);
  // Readability resolves relative links against the document's base URL.
  if (!document.querySelector("base")) {
    const base = document.createElement("base");
    base.setAttribute("href", res.url || url);
    document.head?.appendChild(base);
  }
  // linkedom's Document is close enough to the DOM Readability expects.
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed?.content) return { ...EMPTY, title: document.title || null };

  const clean = sanitizeHtml(parsed.content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption"]),
    allowedAttributes: { a: ["href"], img: ["src", "alt"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
  const text = (parsed.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();

  return {
    title: parsed.title || document.title || null,
    html: clean,
    text: text || null,
    excerpt: parsed.excerpt?.slice(0, 300) || text.slice(0, 200) || null,
  };
}

const BLOCKS = new Set(["P", "LI", "BLOCKQUOTE", "FIGCAPTION", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "DT", "DD"]);

function inline(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const inner = [...el.childNodes].map(inline).join("");
  const href = el.tagName === "A" ? el.getAttribute("href") : null;
  return href && /^https?:/.test(href) && inner.trim() ? `[${inner.trim()}](${href})` : inner;
}

/** Turns sanitized article HTML into simple Markdown (headings, paragraphs, lists, links). */
export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      const tag = child.tagName;
      if (BLOCKS.has(tag) && ![...child.children].some((c) => BLOCKS.has(c.tagName))) {
        const text = tag === "PRE" ? (child.textContent ?? "") : inline(child).trim();
        if (!text.trim()) continue;
        if (/^H[1-6]$/.test(tag)) out.push(`## ${text}`);
        else if (tag === "LI") out.push(`- ${text}`);
        else if (tag === "BLOCKQUOTE") out.push(`> ${text}`);
        else if (tag === "PRE") out.push("```\n" + text.trimEnd() + "\n```");
        else out.push(text);
      } else {
        walk(child);
      }
    }
  };
  walk(document.body);
  return out.join("\n\n");
}
