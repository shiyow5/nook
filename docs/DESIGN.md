# Design Doc

## アーキテクチャ概要

Nook は collector 群と viewer を `nook/services/` 配下のマイクロサービス package として持ち、実行面だけを adapter で切り替える構成になった。AWS では CDK + Lambda + EventBridge + S3、local では Ubuntu `systemd --user` または macOS `launchd` + filesystem storage を使う。viewer はどちらの runtime でも FastAPI を使うが、storage と job trigger は runtime ごとに差し替える。

## 実行モード

- Cloudflare(詳細は `docs/CLOUDFLARE.md`):
  - collector は `.github/workflows/collect.yml` が毎日 06:17 JST と workflow_dispatch で実行する。`nook/deploy/github/run_collectors.py` がカンマ区切りの collector を順に実行し、失敗があっても残りを実行してから非 0 で終了する。
  - 保存先は `S3StorageBackend` を `NOOK_S3_ENDPOINT_URL` / `NOOK_S3_REGION` で R2 に向けたもの。runner は `TZ=Asia/Tokyo` で動かし、日付を JST に揃える。
  - viewer は `nook/deploy/cloudflare/viewer/` の TypeScript Worker。R2 binding から Markdown と state を読み書きし、画面の `public/app.js` / `public/app.css` は Workers static assets として `/static/*` で配信する(Python 版の `viewer.js` / `viewer.css` とは別のファイル)。API の形は Python 版と同じで、天気 API は持たない。
  - 画面は 2 つに分けている(#56)。`/` はホーム(`home.ts` と `public/home.js`)で、その日のまとめ(タブ数・記事数・Markdown の最終更新時刻)、続きから読む(詳細画面が localStorage の `nook.lastRead` に書く最後の記事)、まず読む 3 本、タブごとのカード(国内・海外・論文の順、記事のないタブは後ろ)を出す。「まず読む」は国内・海外・論文のそれぞれで、記事のある最初のタブ(`VIEWER_SERVICES` の順)の先頭の記事を選ぶ。collector が書き出した順のまま使い、LLM には選ばせない(費用と待ち時間を増やさないため)。ホームの検索欄は、その日の全記事の題名・出典・タブ名をブラウザ内で絞り込む。`/read?tab=&date=&article=` は詳細画面で、`article` があればその記事を開く(スマホでは本文の表示から始める)。ホームを作る前の `/?tab=…` は `/read` へ 302 で送る。ハンバーガーメニューは `menu.ts` と `public/menu.js` を両画面で共有し、メイン、ブックマーク、履歴、ジャンル(`›` で開閉し、開閉は localStorage の `nook.genreOpen` に覚える)、用語辞書、設定を並べる。ブックマーク(#14)、履歴(#13)、用語辞書(#17)は未実装なので、押せない項目として「準備中」を添える。詳細画面でジャンルを押すと、読み直さずにタブを切り替える。
  - 読み込み中の表示(#55): ホームと詳細画面は `shell.ts` の `streamPage` で、`<head>` と「今日の記事を集めています」の表示(アイコンと動く帯)を先に送り、R2 の読み込みと記事の変換が済んでから本体を続けて送る。本体の先頭の `<style>` で表示を消すので JavaScript に頼らない。ReadableStream は highWaterMark 0 にし、外枠を送り出してから(setTimeout 0 で一度ランタイムに戻してから)本体を組み立てる。先に組み立てると記事の変換が CPU を占め、外枠も本体と同時にしか届かない。表示は 300ms 後にフェードインさせ、速いときはちらつかせない。本体の組み立てに失敗したら、200 を返した後なので、本体の代わりに理由と「もう一度読み込む」リンクを送る。日付の移動やリンクで別の画面へ移るときは、`body.is-leaving` で上端に細い帯を出す。学びパネルの用語と問題は、生成を待つ間できあがりと同じ形の灰色の枠(スケルトン、`aria-busy="true"`)を出し、チャットの回答待ちは点の動きで示す。`prefers-reduced-motion` のときは動きを止める。
  - 学習データ(#13)は D1 の `nook-study`(binding `DB`)に置く。R2 はファイル置き場で一覧・絞り込み・集計に向かないため、利用者が書き込むものだけを分けた。テーブルは `migrations/` の SQL で管理し、`favorites`(お気に入り、本文の写しを残す)、`notes`(メモ)、`terms`(用語辞書、語は大文字と小文字を区別しない)、`ai_sessions`(添削やケーススタディの記録)。記事は `(app, day, article_id)` で指す。vitest は `readD1Migrations` と `applyD1Migrations` で同じテーブルを作ってから動く。本番への適用は `wrangler d1 migrations apply nook-study --remote` を手元で実行する(自動デプロイのトークンに D1 の権限はない)。
  - お気に入り(#14): 詳細画面の「☆ 保存」で `PUT /api/favorites/:app`(本文 `{date, article_id}`)、もう一度押すと `DELETE`。Worker は記事を R2 から読み直し、題名・出典・リンク・サムネイルと Markdown の写しを D1 の `favorites` に入れる(本文をクライアントから受け取らない)。PUT / DELETE も POST と同じく同一オリジンだけを受け付ける。詳細画面はその日の保存済み ID を `favorites` として state に入れ、ボタンは押した直後に表示を切り替え、失敗したら戻す。`/bookmarks` は保存した新しい順に最大 200 件を並べ、`/bookmarks/view` は D1 の写しから本文を描画するので、R2 の記事が 90 日で消えた後も読める。メニューの「ブックマーク」はこの画面へのリンクになった。
  - サムネイル(#42): collector は記事ごとに画像を 1 つ選び、Markdown の「View」リンクの次の行に `![thumbnail](URL)` と書く(`nook/services/thumbnail.py`)。選び方は、国内・News・Feeds が記事ページの og:image / twitter:image、なければ RSS の media:thumbnail・media:content・enclosure・説明文の最初の画像。HN はリンク先の og:image(本文を取るときに同じページから読むので、リクエストは増えない)。GitHub は `opengraph.githubassets.com` の紹介画像、Reddit は画像の投稿ならその画像、ほかは投稿のサムネイル。Papers と arXiv は HTML 版の最初の図。Worker はこの行を本文から外し(`extractThumbnail`)、記事一覧の行、本文の上、ホームのカードに出す。画像は元サイトから直接読み込み、R2 には保存しない。`<img>` は http / https だけを許し、`loading="lazy"`・`referrerpolicy="no-referrer"`・固定の大きさにする。読み込めなかった画像は `menu.js` が枠ごと隠す。
  - チャットの材料(#34): collector は要約のために読んだ元記事の本文(Reddit は投稿と上位コメント、GitHub は README、論文はアブストラクトと HTML 版の本文)を、R2 の `_state/_sources/<URL の SHA-256 の先頭 32 桁>.txt` に最大 2 万字残す(`CollectorStorage.write_source_text`)。チャットは記事と質問のリンク(最大 5 件)について、まずこの本文を読み、なければ Worker から取りに行く。Reddit や TechCrunch のように Workers からは 403 になるサイトでも、Actions で読めた本文を使える。記事そのもの(「View」リンクの先)は 6000 字、ほかのリンクは 1000 字まで渡す。どちらでも読めなかったリンクはプロンプトに並べ、本文を読めていないことを回答の冒頭で断らせる。
  - 詳細画面は Design キャンバスの A+B 案(#6)。ヘッダーにハンバーガーメニュー、日付(`type="date"`、今日より先は選べない)、その日の記事の絞り込み。下は閉じられる記事一覧(1 記事 1 行、出典名と題名)と、1 本ずつ表示する本文。右下の丸いボタンで「今日の学び」パネルを開く。パネルは上から、記事に出てきた言葉(用語 3〜5 個と解説)、理解度チェック(4 択 3 問)、入門の解説の順(#40)。AI チャットはその上の別の丸いボタンで開く専用のパネルで、2 つのパネルは同時には開かない(#45)。チャットの回答は Worker が Markdown を HTML にし、記事本文と同じサニタイザを通して `html` として返す。用語と問題は `POST /api/study/:app`(kind = terms / quiz)が Gemini の JSON 出力(responseSchema)で作り、`study.ts` で形を検証してから R2 の `_state/study/<app>/<date>/<article_id>-<kind>.json` に保存する。幅 760px 以下では一覧と本文を `body[data-view]` で切り替え、学びパネルとチャットは下から出すシートにする(#28)。スマホのヘッダーは 2 段(メニュー・ロゴとタブ名・日付・設定 / 絞り込み)で上に固定し、日付は前後の矢印を出さずカレンダーから選ぶ。シートはつまみで上下に動かせるほか、中身をスクロールしきってからさらに引いた分だけ動く。上に引くと全画面、下に引いて元の高さの 4 割を切ると閉じ、開いている間は裏の画面をスクロールさせない。記事一覧と学びパネルの開閉は localStorage に覚え、開いているタブ・日付・記事は URL の `tab` / `date` / `article` に入れる。
  - 設定画面(`/settings`、#7)は収集のオンとオフ、TechNews 系(tech_news / jp_tech_news / arxiv_news)のフィード・キーワード・1 フィードあたりの上限を編集する。保存先は R2 の `_state/_settings/settings.json` で、初期値と違う部分だけを書く。`POST /api/settings` は同一オリジンだけを受け付け、`settings.ts` の `validateSettings` で URL(http / https)、文字数、件数、重複を検証する。
  - collector 側は `nook/services/collector_settings.py` が同じ JSON を読む。`run_collectors` は起動時に TOML から作った初期値を `_state/_settings/defaults.json` に書き、設定画面はそれを表示の元にする。予定実行(`NOOK_COLLECTOR_SETTINGS=apply`)では止めた collector を外し、collector を指定した手動実行(`publish`)ではそのまま動かす。R2 の 90 日の自動削除で消えないよう、収集のたびに settings.json を書き直す。設定が壊れていたら警告を出して TOML の値で収集を続ける。
  - 出典名と元記事の URL は、collector が記事に入れる `[View on <フィード名>](URL)` などのリンクから `render.ts` の `extractSourceLink` が取り出す。
  - chat は Gemini generateContent を `google_search` tool 付きで呼ぶ。retry は GitHub の workflow_dispatch を `collectors=<service>` で呼ぶ。
  - Worker は全リクエストで Cloudflare Access の JWT(`Cf-Access-Jwt-Assertion`)を検証し、`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` が未設定なら拒否する。

- AWS:
  - `nook/deploy/aws/stack.py` が Lambda 群、viewer Function URL、日次 EventBridge を定義する。
  - `nook/deploy/aws/cli.py` は repo root の `.env` と process env を merge し、その env で Secrets Manager secret bootstrap と CDK 実行を行う。
  - collector handler は `nook/deploy/aws/handlers/` の薄い wrapper で、core logic は `nook/services/` に置く。
  - Lambda environment には `BUCKET_NAME`、`LLM_MODEL`、`NOOK_RUNTIME_MODE`、`NOOK_STORAGE_BACKEND`、`NOOK_AWS_SECRET_ID` を渡す。runtime credential は Secrets Manager から読む。
  - Markdown と補助 state は S3 に保存する。
- Local:
  - `nook/deploy/local/cli.py` が service 登録、削除、viewer 起動、collector 単発起動を担当する。
  - Ubuntu は `~/.config/systemd/user/`、macOS は `~/Library/LaunchAgents/` に manifest を生成し、manifest には absolute `uv` path を埋め込む。
  - systemd collector unit は `TimeoutStartSec=15min` を持つ。
  - Markdown は `NOOK_DATA_DIR` 配下、未指定なら `~/.local/share/my-nook/data` に保存する。

## モジュール構成

- `app.py`
  - CDK 用の最小 entrypoint。`nook.deploy.aws.app` を呼ぶ。
- `nook/services/catalog.py`
  - 全サービス名、種別、日次スケジュールを定義する。
- `nook/services/storage.py`
  - `S3StorageBackend` と `FilesystemStorageBackend` を持ち、viewer retry 用に Markdown の更新時刻も返す。
- `nook/services/collector_storage.py`
  - collector から daily markdown / state を service 名付きで扱う thin helper。
- `nook/services/config.py`
  - repo root から `configs/<service>/...` を解決し、TOML を読む helper。
- `nook/services/runtime.py`
  - runtime mode、repo root、viewer listen address、job invoker を解決する。
- `nook/services/runtime_secrets.py`
  - local env と AWS Secrets Manager から runtime credential を解決する。fixed app secret に加えて `*_API_KEY` を runtime secret として扱い、AWS runtime では process env へ注入する。
- `nook/services/llm_client.py`
  - PydanticAI client の thin wrapper。必須 env `LLM_MODEL` を既定モデルとして解決し、transient な network timeout / connection error と retryable HTTP status を retry する。
  - `google-gla` / `google-vertex` では thread / Lambda runtime での event loop conflict を避けるため、呼び出しごとに dedicated `httpx.AsyncClient` と concrete Google model を組み立て、実行後に close する。
  - 既に running event loop がある call site では `Agent.run_sync()` を直接叩かず、worker thread へ退避して同期 API を維持する。
  - text output、structured output、viewer chat 用 prompt を共通化する。viewer chat search は provider が対応している場合のみ built-in `WebSearchTool` を使う。
- `nook/services/llm_response_cache.py`
  - `NOOK_LLM_RESPONSE_CACHE=enabled` のとき、`generate_content` / `generate_structured_content` の応答を「モデル名・種別・入力・指示・生成設定」の SHA-256 をキーに `_state/llm_cache/<hash>.json` へ保存し、同じ入力の 2 回目以降は LLM を呼ばずに返す。LLM が返した結果だけを保存し、例外は保存しない。viewer のチャット(`chat_with_search`)は対象外。
- `nook/services/viewer/app.py`
  - storage / job invoker 注入型の FastAPI app factory を提供し、初期表示用の server-render context も template へ渡す。chat request では `app_name + date + article_id` から対象 article instance を再解決する。
- `nook/services/viewer/content.py`
  - viewer の対象 service 一覧、初期表示用 tab / article list / TOC の組み立て、Markdown 読み出し、article 解決、retry 実行を担当する。Markdown API payload に `articles` と `updated_at` を含め、`previous_updated_at` が一致する stale record は 404 にする。retry payload には `started_at` を含める。
- `nook/services/viewer/chat.py`
  - link 抽出、追加コンテキスト収集、chat prompt 構築を担当する。
- `nook/services/viewer/fetch.py`
  - 外部 URL の本文抽出を担当する。
- `nook/services/viewer/weather.py`
  - viewer の天気表示用データを取得する。
- `nook/services/viewer/static/`
  - viewer の CSS / JavaScript asset を置く。
- `nook/services/<collector>/service.py`
  - collector の core logic を持つ package。Lambda handler は置かず、設定は `configs/` から読む。
  - `paper_summarizer` は論文本文が大きいため、他 collector より長い LLM request timeout を使う。
  - `paper_summarizer` は Hugging Face papers API の `upvotes` を使って新着 paper を降順に並べ、既読 ID を除いた順で処理する。
  - `reddit_explorer` は設定された subreddit 群から集めた post を一度集約し、`upvotes` 降順で markdown 化する。
- `nook/services/jp_tech_news/service.py`
  - `TechNews` の `SERVICE_NAME` だけを `jp_tech_news` に変えた subclass。設定は `configs/jp_tech_news/feed.toml` から読み、viewer の「国内」タブに出る。
- `nook/services/arxiv_news/service.py`
  - `TechNews` の subclass。`configs/arxiv_news/feed.toml` の arXiv RSS(cs.CL / cs.LG / cs.AI)をキーワードで絞り、`arxiv_announce_type` が `new` / `cross` の論文だけを要約する。abs ページのアブストラクトは `<blockquote>` にあり汎用の本文抽出では拾えないため、RSS の `Abstract:` 以降と、HTML 版(`https://arxiv.org/html/<id>`)の本文をこの順につないで LLM に渡す(上限 25,000 字)。HTML 版が無い論文はアブストラクトだけで要約する。本文の抽出は `nook/services/arxiv_html.py` にあり、paper_summarizer と共通。`paper_summarizer` が直近 7 日に保存した `arxiv_ids-<date>.txt` の論文は処理済みとして扱い、Papers タブと重複させない。
- `nook/services/paper_summarizer/summary_schema.py`
  - structured output の `title_ja`(論文タイトルの日本語訳)を見出しの次の段落に「（訳）」として併記する。空か原題と同じなら出さない。
- `nook/services/registry.py`
  - service 名から collector runner / class を解決する。
- `nook/deploy/aws/handlers/`
  - Lambda handler 群。EventBridge / Lambda invoke を受けて core service を呼ぶ唯一の entrypoint。
- `nook/deploy/aws/runtime_config.py`
  - AWS stack config、runtime environment、requirements path、bundle に含める source dir を定義する。
  - `paper_summarizer` は 2048 MB、それ以外の LLM-heavy collector (`product_hunt`, `hacker_news`, `github_trending`, `reddit_explorer`, `tech_feed`, `google_alerts`, `tech_news`) と `viewer` は 512 MB を使う。
- `nook/deploy/aws/secret_bootstrap.py`
  - deploy 前の Secrets Manager upsert を担当する。
- `nook/deploy/aws/requirements/`
  - Lambda runtime dependency manifest 群を置く。
- `nook/deploy/local/manifests.py`
  - systemd unit / timer と launchd plist を生成する。`NOOK_UV_EXECUTABLE` と collector timeout を manifest に反映する。
- `Makefile`
  - AWS 系ターゲットの前に `cdk.out` を掃除し、stale asset が残らないようにする。

## データフロー

### AWS

1. `make cdk-deploy` は repo root の `.env` と process env を merge した credential を Secrets Manager secret へ upsert してから CDK deploy を実行する。
2. EventBridge が collector Lambda を日次で起動する。
3. collector handler が `nook/services/registry.py` 経由で core service を実行する。
4. collector / viewer は runtime で Secrets Manager から credential を取得し、`StorageBackend` 越しに S3 へ Markdown / state を読み書きしながら外部 API / RSS / LLM を使う。
   collector config の TOML は bundle された `configs/` から読む。
5. viewer Lambda は S3 から Markdown を読み、Function URL 経由で UI と chat API を提供する。
6. viewer の retry API は collector Lambda を非同期 invoke する。

### Local

1. `local-register` が viewer 常駐 service と collector scheduled service を user 領域に登録する。
2. collector service は `uv run python -m nook.deploy.local.cli run-job <service>` を実行する。手動発火は `make local-trigger SERVICE=<service>` を使う。
3. local CLI は filesystem backend を選び、collector / viewer は同じ `StorageBackend` abstraction で local filesystem を直接読み書きする。viewer からの retry は manifest が埋め込んだ `NOOK_UV_EXECUTABLE` か repo `.venv/bin/uv` を使って collector command を組み立てる。
   collector config の TOML は repo root の `configs/` から読む。
4. viewer service は filesystem backend から Markdown を読み、retry API では local subprocess で collector を再起動する。

## Viewer 構成

- template は `nook/services/viewer/templates/index.html` で nav / 初期本文 / TOC まで server-side render する。これにより `viewer.js` が走らないブラウザでも最低限の閲覧は成立する。
- active service を開くと、その service の article section を `---` 区切りで分解して縦積み表示する。各 article section には独立した chat log / form を持つ。
- 画面 state は server から JSON でも渡し、`nook/services/viewer/static/viewer.js` が hydrate 後の tab 切り替え、retry polling、article 単位 chat、weather refresh を担当する。
- article 本文と TOC 用 heading は backend で HTML / anchor まで確定させ、browser 側はその server-render 済み payload をそのまま使う。TOC は active service 内の全 article heading をフラットに列挙する。retry polling は Markdown の存在ではなく `updated_at` の変化を見て完了判定し、backend は `previous_updated_at` と一致する stale record を返さない。
- article chat は client が `article_id` と `date` を送り、backend が storage から該当 article markdown を再抽出して prompt を組む。`article_id` は article content fingerprint を種にした per-instance ID で、service/date ごとの state へ `canonical_markdown` とともに保存し、reload / retry 後も既存 article instance の ID を可能な限り維持する。
- backend は app, content, chat, fetch, weather に責務分割し、unit test で個別検証できる構造にしている。

## 設定 / データモデル

- runtime env:
  - `LLM_MODEL`: 必須の provider/model string
  - `NOOK_RUNTIME_MODE`: `aws` または `local`
  - `NOOK_REPO_ROOT`: config path と local runtime path 解決の基準 repo root
  - `NOOK_STORAGE_BACKEND`: `s3` または `filesystem`
  - `NOOK_DATA_DIR`: local storage root
  - `NOOK_LOCAL_HOST`, `NOOK_LOCAL_PORT`: local viewer bind 設定
  - `NOOK_UV_EXECUTABLE`: local viewer が retry 用 collector command を組み立てるときの absolute `uv` path
- `NOOK_AWS_SECRET_ID`: AWS runtime が参照する Secrets Manager secret name / ARN
- local / deploy bootstrap 用 env:
  - `LLM_MODEL` (required)
  - `*_API_KEY` (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` など)
  - `REDDIT_CLIENT_ID`
  - `REDDIT_CLIENT_SECRET`
  - `REDDIT_USER_AGENT`
  - `PRODUCT_HUNT_API_KEY`
  - `PRODUCT_HUNT_DEVELOPER_TOKEN`
- AWS secret JSON keys:
  - `*_API_KEY`
  - `REDDIT_CLIENT_ID`
  - `REDDIT_CLIENT_SECRET`
  - `REDDIT_USER_AGENT`
  - `PRODUCT_HUNT_API_KEY`
  - `PRODUCT_HUNT_DEVELOPER_TOKEN`
- local storage layout:
  - Markdown: `<data_dir>/<service>/<YYYY-MM-DD>.md`
  - 補助 state: `<data_dir>/_state/<service>/<key>`
- collector config layout:
  - `configs/tech_feed/feed.toml`
  - `configs/tech_news/feed.toml`
  - `configs/google_alerts/google_alerts.toml`
  - `configs/github_trending/languages.toml`
  - `configs/reddit_explorer/subreddits.toml`
- viewer markdown payload:
  - `markdown`
  - `articles[]`
  - `articles[].article_id`
  - `articles[].title`
  - `articles[].html`
  - `articles[].headings[]`
  - `articles[].headings[].text`
  - `articles[].headings[].anchor`
  - `articles[].headings[].level`
  - `updated_at`
- viewer chat payload:
  - `article_id`
  - `date`
  - `chat_history`
  - `message`
- viewer retry payload:
  - `message`
  - `started_at`
- paper_summarizer state key:
  - `arxiv_ids-<YYYY-MM-DD>.txt`

## 開発フロー設計

1. `uv sync --dev` でルート環境を構築する。
2. 中規模以上の変更では `specs/TEMPLATE.md` をコピーして技術仕様書を作る。
3. `tests/unit/` に失敗テストを先に追加し、最小実装で通す。
4. `make post-change` で `ruff format` / `ruff check` / `pytest` を実行する。
5. AWS 変更は `make cdk-synth`, `make cdk-diff`, `make cdk-deploy` で検証する。これらのターゲットは実行前に `cdk.out` を削除する。
6. local service 変更は `make local-register`, `make local-unregister`, `make local-viewer`, `make local-trigger SERVICE=<service>` で確認する。
