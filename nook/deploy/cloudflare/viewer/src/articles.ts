// Python 版 nook/services/viewer/content.py の記事分割・ID 付与を移植したもの。
// ID の形式(article-<app>-<sha256 先頭12桁>)と state の JSON 形式は Python 版と同じ。

export const ARTICLE_IDENTITY_STATE_VERSION = 1;

export type ArticleState = {
  articleId: string;
  title: string;
  markdown: string;
};

export type IdentityEntry = {
  article_id: string;
  canonical_markdown: string;
};

const LINE_BREAK = /\r\n|\r|\n/;

export function splitMarkdownSections(markdownText: string): string[] {
  if (!markdownText.trim()) {
    return [];
  }

  const sections: string[] = [];
  let currentLines: string[] = [];
  const flush = () => {
    const section = currentLines.join("\n").trim();
    if (section) {
      sections.push(section);
    }
    currentLines = [];
  };

  for (const line of markdownText.split(LINE_BREAK)) {
    if (line.trim() === "---") {
      flush();
      continue;
    }
    currentLines.push(line);
  }
  flush();
  return sections;
}

export function canonicalizeArticleMarkdown(markdownText: string): string {
  return markdownText
    .trim()
    .split(LINE_BREAK)
    .map((line) => line.trimEnd())
    .join("\n");
}

export function extractArticleTitle(markdownText: string, index: number): string {
  for (const line of markdownText.split(LINE_BREAK)) {
    const stripped = line.trim();
    if (!stripped) {
      continue;
    }
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(stripped);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    return Array.from(stripped).slice(0, 80).join("");
  }
  return `Article ${index + 1}`;
}

export async function assignArticleIds(
  appName: string,
  sections: string[],
  previousEntries: IdentityEntry[],
): Promise<ArticleState[]> {
  const canonicals = sections.map(canonicalizeArticleMarkdown);
  const inheritedIds = inheritIds(previousEntries, canonicals);
  const usedIds = new Set(previousEntries.map((entry) => entry.article_id));

  const states: ArticleState[] = [];
  for (const [index, section] of sections.entries()) {
    const articleId =
      inheritedIds[index] ?? (await allocateArticleId(appName, canonicals[index], usedIds));
    usedIds.add(articleId);
    states.push({ articleId, title: extractArticleTitle(section, index), markdown: section });
  }
  return states;
}

export function loadArticleIdentityState(rawState: string | null): IdentityEntry[] {
  if (rawState === null) {
    return [];
  }
  try {
    return parseIdentityState(rawState);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load viewer article identity state: ${reason}`, { cause: error });
  }
}

export function serializeArticleIdentityState(states: ArticleState[]): string {
  return JSON.stringify({
    version: ARTICLE_IDENTITY_STATE_VERSION,
    articles: states.map((state) => ({
      article_id: state.articleId,
      canonical_markdown: canonicalizeArticleMarkdown(state.markdown),
    })),
  });
}

export function articleIdentityStateKey(day: string): string {
  return `viewer-article-identity-${day}.json`;
}

/** 前回の並びと今回の並びの最長共通部分列で対応を取り、前回の ID を引き継ぐ。 */
function inheritIds(previousEntries: IdentityEntry[], canonicals: string[]): (string | undefined)[] {
  const inherited: (string | undefined)[] = new Array(canonicals.length).fill(undefined);
  for (const [previousIndex, currentIndex] of longestCommonSubsequence(
    previousEntries.map((entry) => entry.canonical_markdown),
    canonicals,
  )) {
    inherited[currentIndex] = previousEntries[previousIndex].article_id;
  }
  return inherited;
}

function longestCommonSubsequence(a: string[], b: string[]): [number, number][] {
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

async function allocateArticleId(
  appName: string,
  canonicalMarkdown: string,
  usedIds: Set<string>,
): Promise<string> {
  const baseId = `article-${appName}-${(await sha256Hex(canonicalMarkdown)).slice(0, 12)}`;
  if (!usedIds.has(baseId)) {
    return baseId;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-i${suffix}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseIdentityState(rawState: string): IdentityEntry[] {
  const payload: unknown = JSON.parse(rawState);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("article identity state must be a JSON object");
  }
  const record = payload as Record<string, unknown>;
  if (record.version !== ARTICLE_IDENTITY_STATE_VERSION) {
    throw new Error("article identity state version is unsupported");
  }
  if (!Array.isArray(record.articles)) {
    throw new Error("article identity state articles must be a list");
  }

  const seenIds = new Set<string>();
  return record.articles.map((entry: unknown) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const articleId = item.article_id;
    const canonicalMarkdown = item.canonical_markdown;
    if (typeof articleId !== "string" || !articleId) {
      throw new Error("article identity state article_id must be a string");
    }
    if (typeof canonicalMarkdown !== "string" || !canonicalMarkdown) {
      throw new Error("article identity state canonical_markdown must be a string");
    }
    if (seenIds.has(articleId)) {
      throw new Error("article identity state article_id must be unique");
    }
    seenIds.add(articleId);
    return { article_id: articleId, canonical_markdown: canonicalMarkdown };
  });
}
