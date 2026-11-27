// 画面の外枠と、読み込み中の表示(#55)。
// <head> と「記事を集めています」の表示を先に送り、R2 の読み込みと記事の変換が済んだら本体を続けて送る。
// 本体の先頭で読み込み中の表示を消すので、JavaScript がなくても切り替わる。
import { logEvent } from "./env";
import { ICON_URL } from "./icons";
import { escapeHtml } from "./render";

export type ShellOptions = {
  version: string;
  scripts: string[];
  extraStyles?: string[];
  bodyAttributes: string;
  loadingMessage: string;
};

export function renderShellHead(options: ShellOptions): string {
  const version = encodeURIComponent(options.version);
  const styles = (options.extraStyles ?? []).map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}">\n`).join("");
  const scripts = options.scripts
    .map((name) => `  <script defer src="/static/${name}?v=${version}"></script>\n`)
    .join("");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nook</title>
  <link rel="icon" type="image/svg+xml" href="${ICON_URL}/svg?seed=nook">
  <link rel="apple-touch-icon" href="${ICON_URL}/png?seed=nook&amp;size=180">
${styles}  <link rel="stylesheet" href="/static/app.css?v=${version}">
${scripts}</head>
<body ${options.bodyAttributes}>
  <div id="boot-splash" class="boot-splash" role="status" aria-live="polite" aria-busy="true">
    <img src="${ICON_URL}/svg?seed=nook" alt="" width="56" height="56">
    <p>${escapeHtml(options.loadingMessage)}</p>
    <span class="boot-bar" aria-hidden="true"></span>
  </div>
`;
}

/** 本体の先頭に置き、読み込み中の表示を消す。 */
export const SPLASH_DONE = '  <style>#boot-splash{display:none}</style>\n';

export function renderLoadFailure(reloadHref: string): string {
  return `${SPLASH_DONE}  <main class="load-failure" role="alert">
    <h1>記事を読み込めませんでした</h1>
    <p>保存先(R2)からの読み込みか、記事の変換に失敗しました。少し待ってからもう一度読み込んでください。</p>
    <a class="primary-button" href="${escapeHtml(reloadHref)}">もう一度読み込む</a>
  </main>
</body>
</html>
`;
}

/**
 * 外枠を先に返し、本体はでき次第続けて送る。本体の組み立てに失敗したときは、
 * すでに 200 を返しているので、理由と再読み込みのボタンを本体の代わりに送る。
 */
export function streamPage(head: string, renderBody: () => Promise<string>, reloadHref: string): Response {
  const encoder = new TextEncoder();
  let sentHead = false;
  // highWaterMark 0 にして、読み手が外枠を受け取ってから本体の組み立てを始める。
  // 先に始めると、記事の変換が CPU を占めて外枠の送信まで遅れる
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (!sentHead) {
          sentHead = true;
          controller.enqueue(encoder.encode(head));
          return;
        }
        // 外枠を送り出す番をランタイムに回してから、本体の組み立てを始める
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.enqueue(encoder.encode(await buildBody(renderBody, reloadHref)));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(stream, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function buildBody(renderBody: () => Promise<string>, reloadHref: string): Promise<string> {
  try {
    return `${SPLASH_DONE}${await renderBody()}`;
  } catch (error) {
    logEvent("error", {
      event: "page_render_failed",
      path: reloadHref,
      error: error instanceof Error ? error.stack : String(error),
    });
    return renderLoadFailure(reloadHref);
  }
}

/** 今日なら「今日の記事を集めています」、ほかの日は「11月20日の記事を集めています」。 */
export function loadingMessage(day: string, today: string): string {
  if (day === today) {
    return "今日の記事を集めています";
  }
  const [, month, date] = day.split("-").map(Number);
  return `${month}月${date}日の記事を集めています`;
}
