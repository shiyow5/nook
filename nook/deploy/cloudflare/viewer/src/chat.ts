// Python 版 nook/services/viewer/{chat,fetch}.py と llm_client の chat_with_search を移植したもの。
import { type FetchFn, logEvent } from "./env";
import { decodeEntities } from "./render";

/** 1 回の質問で本文を取りに行くリンク数の上限(Workers の subrequest 数を抑える)。 */
const MAX_CONTEXT_LINKS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTEXT_CHARS = 1000;
/** 巨大なページでメモリや CPU を使い切らないよう、読む本文の上限を決めておく。 */
const MAX_FETCH_BYTES = 1_000_000;
const GOOGLE_PROVIDER_PREFIX = "google-gla:";

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export function buildChatPrompt(args: {
  markdown: string;
  additionalContext: string;
  chatHistory: string;
  message: string;
}): string {
  const contextBlock = args.additionalContext
    ? `\n\n[記事またはユーザーからの質問に含まれるリンクの内容](うまく取得できていない可能性があります)\n\n${args.additionalContext}`
    : "";
  return `
以下の記事に関連して、検索エンジンを用いて事実を確認しながら、ユーザーからの質問に対してできるだけ詳細に答えてください。
なお、回答はMarkdown形式で記述してください。

[記事]

${args.markdown}

${contextBlock}

[チャット履歴]

'''
${args.chatHistory}
'''

[ユーザーからの新しい質問]

'''
${args.message}
'''

それでは、回答をお願いします。
`;
}

export function extractLinks(text: string): string[] {
  const markdownLinks = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    .filter(([, label]) => {
      const normalized = label.trim().toLowerCase();
      return !normalized.startsWith("image") && !normalized.startsWith("video");
    })
    .map(([, , url]) => url);
  const plainUrls = [...text.matchAll(/(?<![([])(https?:\/\/[^\s)]+)/g)].map(([url]) => url);
  return [...markdownLinks, ...plainUrls];
}

export async function collectAdditionalContext(args: {
  markdown: string;
  message: string;
  fetchFn: FetchFn;
}): Promise<string> {
  const links = [...new Set([...extractLinks(args.markdown), ...extractLinks(args.message)])].slice(
    0,
    MAX_CONTEXT_LINKS,
  );
  const contents = await Promise.all(links.map((url) => fetchUrlContent(url, args.fetchFn)));
  return links
    .map((url, index) => (contents[index] ? `- Content from ${url}:\n\n'''${contents[index]}'''` : null))
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

export async function fetchUrlContent(url: string, fetchFn: FetchFn): Promise<string | null> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    if (!response.ok) {
      return null;
    }
    const text = extractMainText(await readLimitedText(response, MAX_FETCH_BYTES));
    if (!text) {
      return null;
    }
    return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}...` : text;
  } catch (error) {
    logEvent("warn", { event: "context_fetch_failed", url, error: String(error) });
    return null;
  }
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value.subarray(0, maxBytes - total));
    total += value.byteLength;
  }
  await reader.cancel();
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** LLM に渡す補助テキストを作るだけなので、HTML は正規表現で大まかに処理する。 */
export function extractMainText(html: string): string {
  const withoutNoise = html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // arXiv の論文ページは <main> の先頭がパンくずと著者欄なので、アブストラクトを先に探す
  const main =
    /<blockquote\b[^>]*class="abstract\b[^"]*"[^>]*>([\s\S]*?)<\/blockquote\s*>/i.exec(withoutNoise)?.[1] ??
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(withoutNoise)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(withoutNoise)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(withoutNoise)?.[1] ??
    "";
  return decodeEntities(main.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveGeminiModel(llmModel: string): string {
  if (llmModel.startsWith(GOOGLE_PROVIDER_PREFIX)) {
    return llmModel.slice(GOOGLE_PROVIDER_PREFIX.length);
  }
  if (llmModel.includes(":")) {
    throw new Error(`The Cloudflare viewer only supports ${GOOGLE_PROVIDER_PREFIX} models: ${llmModel}`);
  }
  return llmModel;
}

export async function chatWithSearch(args: {
  apiKey: string;
  llmModel: string;
  prompt: string;
  fetchFn: FetchFn;
}): Promise<string> {
  const model = resolveGeminiModel(args.llmModel);
  const response = await args.fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );
  if (!response.ok) {
    throw new UpstreamError(`Gemini API returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!text) {
    throw new UpstreamError("Gemini API returned no text");
  }
  return text;
}
