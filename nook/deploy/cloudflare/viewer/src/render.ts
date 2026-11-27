import { marked } from "marked";

import type { ArticleState } from "./articles";
import { logEvent } from "./env";

export type Heading = { text: string; anchor: string; level: number };

export type RenderedArticle = {
  articleId: string;
  title: string;
  html: string;
  headings: Heading[];
  /** 記事一覧に出す情報源の名前(例: Zenn Trending)。見つからなければ null。 */
  source: string | null;
  /** 元記事の URL。見つからなければ null。 */
  link: string | null;
  /** collector が選んだサムネイル画像(#42)。なければ null。 */
  image: string | null;
};

// collector は各記事に「[View on <フィード名>](URL)」か「[View Link](URL)」などを入れている
const VIEW_LINK_PATTERN = /\[View(?: on ([^\]]+)|[^\]]*)\]\((https?:\/\/[^)\s]+)\)/;

// collector は「View」リンクの次の行に「![thumbnail](URL)」を 1 つ書く(nook/services/thumbnail.py)
const THUMBNAIL_PATTERN = /^!\[thumbnail\]\((https?:\/\/[^)\s]+)\)[ \t]*$/m;

const DANGEROUS_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);
const ALLOWED_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title"]),
  th: new Set(["colspan", "rowspan"]),
  td: new Set(["colspan", "rowspan"]),
};
const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto"]);
const HEADING_SELECTOR = "h1, h2, h3";

export async function renderArticle(state: ArticleState, renderIndex: number): Promise<RenderedArticle> {
  try {
    const { image, markdown } = extractThumbnail(state.markdown);
    const rawHtml = marked.parse(markdown, { async: false, gfm: true });
    const sanitizedHtml = await transform(rawHtml, sanitizeRewriter());
    const headingTexts = await collectHeadingTexts(sanitizedHtml);
    const headings = buildHeadings(headingTexts, `${state.articleId}-${renderIndex}`);
    const html = await transform(sanitizedHtml, headingIdRewriter(headings));
    return { articleId: state.articleId, title: state.title, html, headings, image, ...extractSourceLink(state.markdown) };
  } catch (error) {
    logEvent("error", {
      event: "article_render_failed",
      article_id: state.articleId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return {
      articleId: state.articleId,
      title: state.title,
      html: `<pre>${escapeHtml(state.markdown)}</pre>`,
      headings: [],
      image: extractThumbnail(state.markdown).image,
      ...extractSourceLink(state.markdown),
    };
  }
}

/** チャットの回答などの Markdown を、記事本文と同じ許可リストで HTML にする。 */
export async function renderMarkdownHtml(markdown: string): Promise<string> {
  const rawHtml = marked.parse(markdown, { async: false, gfm: true, breaks: true });
  return transform(rawHtml, sanitizeRewriter());
}

/** サムネイルの行を取り出し、本文からは外す(画面では本文の上と一覧に出すため)。 */
export function extractThumbnail(markdown: string): { image: string | null; markdown: string } {
  const match = THUMBNAIL_PATTERN.exec(markdown);
  if (!match) {
    return { image: null, markdown };
  }
  return { image: match[1], markdown: markdown.replace(match[0], "") };
}

/** 元サイトの画像を直接読み込む <img>。リファラーは送らず、遅延読み込みにする。 */
export function thumbnailHtml(url: string | null, className: string): string {
  if (!url || !/^https?:\/\//.test(url)) {
    return "";
  }
  return `<img class="thumb ${className}" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

export function extractSourceLink(markdown: string): { source: string | null; link: string | null } {
  const match = VIEW_LINK_PATTERN.exec(markdown);
  if (!match) {
    return { source: null, link: null };
  }
  const [, feedName, link] = match;
  if (feedName?.trim()) {
    return { source: feedName.trim(), link };
  }
  try {
    return { source: new URL(link).hostname.replace(/^www\./, ""), link };
  } catch {
    return { source: null, link };
  }
}

export function slugify(text: string, index: number): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_぀-ヿ㐀-鿿\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `section-${index}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const codePoint =
        entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

async function transform(html: string, rewriter: HTMLRewriter): Promise<string> {
  return rewriter.transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })).text();
}

function sanitizeRewriter(): HTMLRewriter {
  return new HTMLRewriter().on("*", {
    element(element) {
      const tagName = element.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tagName)) {
        element.remove();
        return;
      }
      const allowed = ALLOWED_ATTRIBUTES[tagName] ?? new Set<string>();
      for (const [name, value] of [...element.attributes]) {
        const lowerName = name.toLowerCase();
        const trimmed = value.trim();
        const keep =
          !lowerName.startsWith("on") &&
          allowed.has(lowerName) &&
          !((lowerName === "href" || lowerName === "src") && !isSafeUrl(trimmed));
        if (!keep) {
          element.removeAttribute(name);
        } else if (trimmed !== value) {
          element.setAttribute(name, trimmed);
        }
      }
      if (tagName === "a" && element.hasAttribute("href")) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    },
  });
}

/**
 * HTMLRewriter は属性値を文字参照のまま返すため、ここで復号してから判定する。
 * 復号できない文字参照(&colon; や &Tab; など)が残る URL は、ブラウザ側の解釈と
 * ずれる恐れがあるので落とす。scheme は許可リストで判定し、相対 URL は通す。
 */
function isSafeUrl(value: string): boolean {
  const decoded = decodeEntities(value);
  if (/&[a-z0-9#]+;/i.test(decoded)) {
    return false;
  }
  const normalized = decoded.replace(/[\u0000- \u007f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1];
  return scheme === undefined || SAFE_URL_SCHEMES.has(scheme.toLowerCase());
}

async function collectHeadingTexts(html: string): Promise<{ text: string; level: number }[]> {
  const headings: { parts: string[]; level: number }[] = [];
  let pendingNode = "";
  await transform(
    html,
    new HTMLRewriter().on(HEADING_SELECTOR, {
      element(element) {
        headings.push({ parts: [], level: Number(element.tagName.slice(1)) });
        pendingNode = "";
      },
      text(chunk) {
        pendingNode += chunk.text;
        if (chunk.lastInTextNode) {
          const nodeText = decodeEntities(pendingNode).trim();
          if (nodeText) {
            headings[headings.length - 1].parts.push(nodeText);
          }
          pendingNode = "";
        }
      },
    }),
  );
  return headings.map((heading) => ({ text: heading.parts.join(" "), level: heading.level }));
}

function buildHeadings(headingTexts: { text: string; level: number }[], anchorPrefix: string): Heading[] {
  const counters = new Map<string, number>();
  return headingTexts.map((heading, index) => {
    const base = slugify(heading.text, index);
    const count = (counters.get(base) ?? 0) + 1;
    counters.set(base, count);
    const suffix = count === 1 ? "" : `-${count}`;
    return { text: heading.text, anchor: `heading-${anchorPrefix}-${base}${suffix}`, level: heading.level };
  });
}

function headingIdRewriter(headings: Heading[]): HTMLRewriter {
  let index = 0;
  return new HTMLRewriter().on(HEADING_SELECTOR, {
    element(element) {
      const heading = headings[index];
      index += 1;
      element.setAttribute("id", heading.anchor);
      element.setAttribute("class", `md-heading md-h${heading.level}`);
    },
  });
}
