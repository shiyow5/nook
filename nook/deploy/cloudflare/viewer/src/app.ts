import { buildChatPrompt, chatWithSearch, collectAdditionalContext, UpstreamError } from "./chat";
import {
  articleToState,
  buildInitialRender,
  ensureViewerService,
  loadViewerPage,
  readMarkdownRecord,
  renderArticles,
  resolveArticleStates,
  viewerServiceNames,
} from "./content";
import { type FetchFn, HttpError, logEvent, type NookEnv, requireSecret } from "./env";
import { BOOKMARKS_SHELL, renderBookmarksBody, renderBookmarkViewBody } from "./bookmarksPage";
import { addFavorite, favoriteIdsForDay, getFavorite, listFavorites, removeFavorite } from "./favorites";
import { dispatchCollectorWorkflow } from "./github";
import {
  addTerm,
  deleteTerm,
  draftTerm,
  listTerms,
  parseTermInput,
  parseTermPatch,
  termToState,
  updateTerm,
} from "./glossary";
import { GLOSSARY_SHELL, renderGlossaryBody } from "./glossaryPage";
import {
  listSessionsForArticle,
  loadArticleMarkdown,
  parseSummary,
  reviewSummary,
  saveSession,
  sessionToState,
} from "./practice";
import { buildHomeData, HOME_SHELL, renderHomeBody } from "./home";
import { INDEX_SHELL, renderIndexBody } from "./page";
import { loadingMessage, renderShellHead, streamPage } from "./shell";
import { renderArticle, renderMarkdownHtml } from "./render";
import { loadSettingsState, saveSettings } from "./settings";
import { generateExplanation, generateStudy, STUDY_KINDS, type StudyKind, studyCacheKey } from "./study";
import { renderSettingsHtml } from "./settingsPage";

/** 設定は数十件のフィードでも数十 KB なので、それより大きい本文は受け付けない。 */
const MAX_SETTINGS_BODY_BYTES = 256 * 1024;

export type AppDeps = {
  fetch: FetchFn;
  verifyAccess: (request: Request, env: NookEnv) => Promise<boolean>;
  now: () => Date;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export async function handleRequest(request: Request, env: NookEnv, deps: AppDeps): Promise<Response> {
  try {
    if (!(await deps.verifyAccess(request, env))) {
      return new Response("Forbidden", { status: 403 });
    }
    return await route(request, env, deps);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ detail: error.detail }, { status: error.status });
    }
    logEvent("error", {
      event: "request_failed",
      method: request.method,
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.stack : String(error),
    });
    if (error instanceof UpstreamError) {
      return Response.json({ detail: error.message }, { status: 502 });
    }
    return Response.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}

async function route(request: Request, env: NookEnv, deps: AppDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path.startsWith("/static/")) {
    return env.ASSETS.fetch(new Request(new URL(path.slice("/static".length), url), request));
  }
  if (method === "GET" && path === "/") {
    // ホームを作る前(#56)の「/?tab=…」のブックマークは、詳細画面へ送る
    if (url.searchParams.has("tab")) {
      return Response.redirect(new URL(`/read${url.search}`, url).toString(), 302);
    }
    return renderHome(env, resolveDay(url.searchParams.get("date"), deps.now()), todayInJapan(deps.now()), url);
  }
  if (method === "GET" && path === "/read") {
    return renderIndex(
      env,
      resolveDay(url.searchParams.get("date"), deps.now()),
      url.searchParams.get("tab"),
      todayInJapan(deps.now()),
      url,
    );
  }

  if (method === "GET" && path === "/settings") {
    return renderSettings(env);
  }
  if (method === "GET" && path === "/glossary") {
    return renderGlossary(env, todayInJapan(deps.now()), url);
  }
  if (method === "GET" && path === "/bookmarks") {
    return renderBookmarks(env, todayInJapan(deps.now()), url);
  }
  if (method === "GET" && path === "/bookmarks/view") {
    return renderBookmarkView(env, url, deps);
  }

  const markdownMatch = /^\/api\/markdown\/([^/]+)$/.exec(path);
  if (method === "GET" && markdownMatch) {
    return readMarkdown(env, decodePathParam(markdownMatch[1]), url, deps);
  }
  if (method !== "GET" && method !== "HEAD") {
    ensureSameOrigin(request, url);
  }
  if (method === "POST" && path === "/api/terms") {
    return Response.json({ term: termToState(await addTerm(env.DB, parseTermInput(await readJson(request)), deps.now())) });
  }
  if (method === "POST" && path === "/api/terms/draft") {
    return draftGlossaryTerm(env, request, deps);
  }
  const termMatch = /^\/api\/terms\/(\d+)$/.exec(path);
  if (method === "PATCH" && termMatch) {
    const patch = parseTermPatch(await readJson(request));
    return Response.json({ term: termToState(await updateTerm(env.DB, Number(termMatch[1]), patch, deps.now())) });
  }
  if (method === "DELETE" && termMatch) {
    await deleteTerm(env.DB, Number(termMatch[1]));
    return Response.json({ deleted: true });
  }
  const practiceMatch = /^\/api\/practice\/([^/]+)$/.exec(path);
  if (practiceMatch && (method === "GET" || method === "POST")) {
    return practice(env, method, decodePathParam(practiceMatch[1]), request, url, deps);
  }
  const favoriteMatch = /^\/api\/favorites\/([^/]+)$/.exec(path);
  if ((method === "PUT" || method === "DELETE") && favoriteMatch) {
    return updateFavorite(env, method, decodePathParam(favoriteMatch[1]), request, deps);
  }
  const chatMatch = /^\/chat\/([^/]+)$/.exec(path);
  if (method === "POST" && chatMatch) {
    return chat(env, decodePathParam(chatMatch[1]), request, deps);
  }
  const studyMatch = /^\/api\/study\/([^/]+)$/.exec(path);
  if (method === "POST" && studyMatch) {
    return study(env, decodePathParam(studyMatch[1]), request, deps);
  }
  if (method === "POST" && path === "/api/settings") {
    return updateSettings(env, request, deps);
  }
  const retryMatch = /^\/retry\/([^/]+)$/.exec(path);
  if (method === "POST" && retryMatch) {
    return retry(env, decodePathParam(retryMatch[1]), deps);
  }
  throw new HttpError(404, "Not Found");
}

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(404, "Not Found");
  }
}

/**
 * Access のクッキーは他サイトからの POST にも付くため、chat(LLM 費用)と retry(workflow 実行)は
 * 同じオリジンからの呼び出しだけを受け付ける。ブラウザは POST に Origin を付ける。
 */
function ensureSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== url.origin) || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new HttpError(403, "Cross-site request rejected");
  }
}

function renderIndex(env: NookEnv, day: string, requestedApp: string | null, today: string, url: URL): Response {
  const head = renderShellHead({ ...INDEX_SHELL, version: assetVersion(env), loadingMessage: loadingMessage(day, today) });
  return streamPage(
    head,
    async () => {
      const [page, favorites] = await Promise.all([
        loadViewerPage(env.NOOK_BUCKET, viewerServiceNames(env), day),
        favoriteIdsForDay(env.DB, day),
      ]);
      return renderIndexBody(page, buildInitialRender(page, requestedApp), today, favorites);
    },
    `${url.pathname}${url.search}`,
  );
}

function renderHome(env: NookEnv, day: string, today: string, url: URL): Response {
  const head = renderShellHead({ ...HOME_SHELL, version: assetVersion(env), loadingMessage: loadingMessage(day, today) });
  return streamPage(
    head,
    async () => renderHomeBody(buildHomeData(await loadViewerPage(env.NOOK_BUCKET, viewerServiceNames(env), day), today)),
    `${url.pathname}${url.search}`,
  );
}

function renderGlossary(env: NookEnv, today: string, url: URL): Response {
  const head = renderShellHead({ ...GLOSSARY_SHELL, version: assetVersion(env), loadingMessage: "用語辞書を読み込んでいます" });
  return streamPage(
    head,
    async () => renderGlossaryBody({ terms: await listTerms(env.DB), appNames: viewerServiceNames(env), today }),
    `${url.pathname}${url.search}`,
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

async function draftGlossaryTerm(env: NookEnv, request: Request, deps: AppDeps): Promise<Response> {
  const { word } = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  if (typeof word !== "string" || !word.trim() || word.length > 80) {
    throw new HttpError(400, "下書きする用語を 80 字以内で指定してください");
  }
  const draft = await draftTerm({
    word: word.trim(),
    bucket: env.NOOK_BUCKET,
    apiKey: requireSecret(env.GOOGLE_API_KEY, "GOOGLE_API_KEY"),
    llmModel: env.LLM_MODEL,
    fetchFn: deps.fetch,
  });
  return Response.json(draft);
}

function articleRef(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{1,120}$/.test(value)) {
    throw new HttpError(400, "article_id を指定してください");
  }
  return value;
}

/** 演習(#19 添削)。GET はその記事のこれまでのやり取り、POST は新しい添削。 */
async function practice(
  env: NookEnv,
  method: string,
  appName: string,
  request: Request,
  url: URL,
  deps: AppDeps,
): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  if (method === "GET") {
    const day = resolveDay(url.searchParams.get("date"), deps.now());
    const articleId = articleRef(url.searchParams.get("article_id"));
    const sessions = await listSessionsForArticle(env.DB, appName, day, articleId);
    return Response.json({ sessions: sessions.map(sessionToState) }, { headers: { "cache-control": "no-store" } });
  }
  const payload = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const articleId = articleRef(payload.article_id);
  const day = resolveDay(typeof payload.date === "string" ? payload.date : null, deps.now());
  if (payload.kind !== "review") {
    throw new HttpError(400, "kind は review にしてください");
  }
  const summary = parseSummary(payload.summary);
  const markdown = await loadArticleMarkdown(env.NOOK_BUCKET, appName, day, articleId);
  const output = await reviewSummary({
    markdown,
    summary,
    apiKey: requireSecret(env.GOOGLE_API_KEY, "GOOGLE_API_KEY"),
    llmModel: env.LLM_MODEL,
    fetchFn: deps.fetch,
  });
  const session = await saveSession(env.DB, {
    kind: "review",
    app: appName,
    day,
    articleId,
    input: { summary },
    output,
    createdAt: deps.now().toISOString(),
  });
  return Response.json({ session: sessionToState(session) });
}

function renderBookmarks(env: NookEnv, today: string, url: URL): Response {
  const head = renderShellHead({ ...BOOKMARKS_SHELL, version: assetVersion(env), loadingMessage: "ブックマークを読み込んでいます" });
  return streamPage(
    head,
    async () =>
      renderBookmarksBody({ favorites: await listFavorites(env.DB), appNames: viewerServiceNames(env), today }),
    `${url.pathname}${url.search}`,
  );
}

async function renderBookmarkView(env: NookEnv, url: URL, deps: AppDeps): Promise<Response> {
  const appName = url.searchParams.get("tab") ?? "";
  const day = resolveDay(url.searchParams.get("date"), deps.now());
  const favorite = await getFavorite(env.DB, appName, day, url.searchParams.get("article") ?? "");
  if (favorite === null) {
    throw new HttpError(404, "Bookmark not found");
  }
  const rendered = await renderArticle({ articleId: favorite.articleId, title: favorite.title, markdown: favorite.markdown }, 0);
  const head = renderShellHead({ ...BOOKMARKS_SHELL, version: assetVersion(env), loadingMessage: "記事を読み込んでいます" });
  return streamPage(
    head,
    async () =>
      renderBookmarkViewBody({
        favorite,
        html: rendered.html,
        appNames: viewerServiceNames(env),
        today: todayInJapan(deps.now()),
      }),
    `${url.pathname}${url.search}`,
  );
}

async function updateFavorite(
  env: NookEnv,
  method: "PUT" | "DELETE",
  appName: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  let payload: Record<string, unknown>;
  try {
    payload = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  const { article_id: articleId, date } = payload;
  if (typeof articleId !== "string" || !articleId || typeof date !== "string") {
    throw new HttpError(400, "article_id と date を指定してください");
  }
  const day = resolveDay(date, deps.now());
  if (method === "DELETE") {
    await removeFavorite(env.DB, appName, day, articleId);
    return Response.json({ saved: false });
  }
  await addFavorite({ db: env.DB, bucket: env.NOOK_BUCKET, app: appName, day, articleId, now: deps.now() });
  return Response.json({ saved: true });
}

async function renderSettings(env: NookEnv): Promise<Response> {
  const state = await loadSettingsState(env.NOOK_BUCKET);
  const html = renderSettingsHtml(state, viewerServiceNames(env), assetVersion(env));
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function updateSettings(env: NookEnv, request: Request, deps: AppDeps): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_SETTINGS_BODY_BYTES) {
    throw new HttpError(413, "設定が大きすぎます");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_SETTINGS_BODY_BYTES) {
    throw new HttpError(413, "設定が大きすぎます");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  const saved = await saveSettings(env.NOOK_BUCKET, payload, deps.now());
  logEvent("info", { event: "settings_saved", updated_at: saved.updated_at });
  return Response.json({ settings: saved }, { headers: { "cache-control": "no-store" } });
}

async function readMarkdown(env: NookEnv, appName: string, url: URL, deps: AppDeps): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  const day = resolveDay(url.searchParams.get("date"), deps.now());
  const previousUpdatedAt = parseTimestamp(url.searchParams.get("previous_updated_at"));
  const record = await readMarkdownRecord(env.NOOK_BUCKET, appName, day);
  if (record === null || (previousUpdatedAt !== null && record.updatedAt === previousUpdatedAt)) {
    throw new HttpError(404, "Markdown content not found");
  }
  const articles = await renderArticles(await resolveArticleStates(env.NOOK_BUCKET, appName, day, record.content));
  return Response.json(
    { markdown: record.content, articles: articles.map(articleToState), updated_at: record.updatedAt },
    { headers: { "cache-control": "no-store" } },
  );
}

async function study(env: NookEnv, appName: string, request: Request, deps: AppDeps): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  let payload: Record<string, unknown>;
  try {
    payload = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  const { article_id: articleId, date, kind } = payload;
  if (typeof articleId !== "string" || typeof kind !== "string" || !STUDY_KINDS.has(kind)) {
    throw new HttpError(400, "article_id と kind(terms / quiz / intro / deep)を指定してください");
  }
  const studyKind = kind as StudyKind;
  const day = resolveDay(typeof date === "string" ? date : null, deps.now());
  const cacheKey = studyCacheKey(appName, day, articleId, studyKind);
  const cached = await env.NOOK_BUCKET.get(cacheKey);
  if (cached !== null) {
    return Response.json(JSON.parse(await cached.text()));
  }
  const record = await readMarkdownRecord(env.NOOK_BUCKET, appName, day);
  if (record === null) {
    throw new HttpError(404, "Markdown content not found");
  }
  const states = await resolveArticleStates(env.NOOK_BUCKET, appName, day, record.content);
  const article = states.find((state) => state.articleId === articleId);
  if (!article) {
    throw new HttpError(404, "Article not found");
  }
  const llm = {
    markdown: article.markdown,
    apiKey: requireSecret(env.GOOGLE_API_KEY, "GOOGLE_API_KEY"),
    llmModel: env.LLM_MODEL,
    fetchFn: deps.fetch,
  };
  let body: Record<string, unknown>;
  if (studyKind === "intro" || studyKind === "deep") {
    // 解説(#18)は Markdown で受け取り、チャットと同じサニタイザで HTML にしてから保存する
    const markdown = await generateExplanation({ kind: studyKind, ...llm });
    body = { kind: studyKind, markdown, html: await renderMarkdownHtml(markdown) };
  } else {
    const items = await generateStudy({ kind: studyKind, ...llm });
    body = studyKind === "terms" ? { kind: studyKind, terms: items } : { kind: studyKind, questions: items };
  }
  // 同じ記事で何度開いても LLM を呼ばないよう保存する(R2 の 90 日の自動削除で消える)
  await env.NOOK_BUCKET.put(cacheKey, JSON.stringify(body), { httpMetadata: { contentType: "application/json" } });
  return Response.json(body);
}

async function chat(env: NookEnv, appName: string, request: Request, deps: AppDeps): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  const body = await parseChatBody(request);
  const day = resolveDay(body.date, deps.now());
  const record = await readMarkdownRecord(env.NOOK_BUCKET, appName, day);
  if (record === null) {
    throw new HttpError(404, "Markdown content not found");
  }
  const states = await resolveArticleStates(env.NOOK_BUCKET, appName, day, record.content);
  const article = states.find((state) => state.articleId === body.articleId);
  if (!article) {
    throw new HttpError(404, "Article not found");
  }

  const { context: additionalContext, failedLinks } = await collectAdditionalContext({
    markdown: article.markdown,
    message: body.message,
    fetchFn: deps.fetch,
    bucket: env.NOOK_BUCKET,
  });
  const response = await chatWithSearch({
    apiKey: requireSecret(env.GOOGLE_API_KEY, "GOOGLE_API_KEY"),
    llmModel: env.LLM_MODEL,
    prompt: buildChatPrompt({
      markdown: article.markdown,
      additionalContext,
      chatHistory: body.chatHistory,
      message: body.message,
      failedLinks,
    }),
    fetchFn: deps.fetch,
  });
  return Response.json({ response, html: await renderMarkdownHtml(response) });
}

async function retry(env: NookEnv, appName: string, deps: AppDeps): Promise<Response> {
  ensureViewerService(viewerServiceNames(env), appName);
  const startedAt = deps.now().toISOString();
  await dispatchCollectorWorkflow({ env, collector: appName, fetchFn: deps.fetch });
  logEvent("info", { event: "collector_retry_dispatched", collector: appName, started_at: startedAt });
  return Response.json(
    { message: `Job trigger for ${appName} accepted. Processing started.`, started_at: startedAt },
    { status: 202 },
  );
}

type ChatBody = { articleId: string; date: string | null; chatHistory: string; message: string };

async function parseChatBody(request: Request): Promise<ChatBody> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  const record = (payload ?? {}) as Record<string, unknown>;
  const { article_id: articleId, date, chat_history: chatHistory = "なし", message = "" } = record;
  if (typeof articleId !== "string" || typeof message !== "string" || typeof chatHistory !== "string") {
    throw new HttpError(400, "article_id, message and chat_history must be strings");
  }
  if (date !== undefined && date !== null && typeof date !== "string") {
    throw new HttpError(400, "date must be a string");
  }
  return { articleId, date: (date as string | null | undefined) ?? null, chatHistory, message };
}

/** 日付が無ければ日本時間の今日を使う(collector も TZ=Asia/Tokyo で動かしている)。 */
export function todayInJapan(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function resolveDay(value: string | null, now: Date): string {
  if (value === null) {
    return todayInJapan(now);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!parsed || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "date must be YYYY-MM-DD");
  }
  return value;
}

function parseTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "previous_updated_at must be an ISO 8601 timestamp");
  }
  return parsed.toISOString();
}

function assetVersion(env: NookEnv): string {
  return env.CF_VERSION_METADATA?.id?.slice(0, 12) ?? "dev";
}
