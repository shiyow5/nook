# Cloudflare 版の構成と導入手順

AWS を使わずに、GitHub Actions と Cloudflare の無料枠で nook を動かす構成です。

## 構成

```text
GitHub Actions(毎日 06:17 JST の cron / 手動実行)
  └─ Python の collector を実行
       └─ Markdown と state を R2(S3 互換 API)へ保存

Cloudflare Worker「nook-viewer」(*.workers.dev、Cloudflare Access で保護)
  ├─ R2 を読んで画面を返す(app.js / app.css は nook/deploy/cloudflare/viewer/public/)
  ├─ /chat/{app}  : Gemini API を Google 検索付きで呼ぶ
  └─ /retry/{app} : GitHub Actions の workflow_dispatch で collector を 1 件だけ再実行
```

- collector は Python のまま動かします。保存先だけ環境変数で R2 に向けます。
- viewer は `nook/deploy/cloudflare/viewer/` の TypeScript です。API の形は Python 版と同じです。
- Cloudflare 版の viewer は天気を表示しません。
- R2 のキーの形式は S3 版と同じです(`<service>/<YYYY-MM-DD>.md`、`_state/<service>/<key>`)。日付は日本時間で決めます。

## 必要なもの

- Cloudflare アカウント(Workers Free で足ります。R2 の有効化には支払い方法の登録が必要ですが、無料枠内なら請求は発生しません)
- Zero Trust(Cloudflare Access)の組織。無料プランで使えます
- GitHub アカウントと `gh` CLI
- Node.js 22 以上と `uv`
- Gemini API キー、Reddit API の認証情報、Product Hunt の API Key と Developer Token

## 1. R2 のバケットと API トークンを作る

1. Cloudflare ダッシュボードの「R2 Object Storage」で R2 を有効にします。
2. バケットを作ります。

   ```bash
   cd nook/deploy/cloudflare/viewer
   npm ci
   npx wrangler r2 bucket create nook-data
   ```

3. R2 の S3 互換 API の鍵を用意します。方法は 2 通りあります。
   - ダッシュボードの「R2 > Manage API tokens」で、`nook-data` だけに「Object Read & Write」を許可したトークンを作り、表示された Access Key ID と Secret Access Key を使う。
   - 「Workers R2 Storage: Edit」を持つ Cloudflare API トークンから作る。Access Key ID はトークンの ID(`GET /user/tokens/verify` の `result.id`)、Secret Access Key はトークン文字列の SHA-256(16 進)になる。この構成の初回導入ではこちらを使った。

   エンドポイントは `https://<アカウントID>.r2.cloudflarestorage.com` です。

## 2. GitHub に Secrets と Variables を登録する

collector を動かすリポジトリで、次を登録します。

```bash
gh secret set GOOGLE_API_KEY
gh secret set REDDIT_CLIENT_ID
gh secret set REDDIT_CLIENT_SECRET
gh secret set REDDIT_USER_AGENT
gh secret set PRODUCT_HUNT_API_KEY
gh secret set PRODUCT_HUNT_DEVELOPER_TOKEN
gh secret set R2_ACCESS_KEY_ID
gh secret set R2_SECRET_ACCESS_KEY
gh secret set R2_ENDPOINT_URL

gh variable set R2_BUCKET --body nook-data
gh variable set LLM_MODEL --body google-gla:gemini-flash-lite-latest
gh variable set NOOK_ENABLED_COLLECTORS \
  --body hacker_news,paper_summarizer,arxiv_news,reddit_explorer,tech_feed,github_trending,tech_news,jp_tech_news
```

`NOOK_ENABLED_COLLECTORS` は毎日の cron で実行する collector です。ここに入れた collector のうち、画面の設定画面で止めたものは予定実行で動きません。

- `product_hunt` は認証情報を登録してから追加します。
- `google_alerts` は `configs/google_alerts/google_alerts.toml` に自分の RSS URL を書いてから追加します。

## 3. viewer をデプロイする

1. `wrangler.jsonc` の `GITHUB_REPOSITORY` を `<GitHub ユーザー名>/<リポジトリ名>` に書き換えます。
2. secrets を登録します。`GITHUB_TOKEN` は、対象リポジトリだけに「Actions: Read and write」を許可した fine-grained personal access token です。

3. 学習データ(お気に入り・メモ・用語辞書)用の D1 を作り、表示された `database_id` を `wrangler.jsonc` の `d1_databases` に書きます。テーブルは `migrations/` の SQL で作ります。

   ```bash
   npx wrangler d1 create nook-study
   npx wrangler d1 migrations apply nook-study --remote
   ```

   ```bash
   npx wrangler secret put GOOGLE_API_KEY
   npx wrangler secret put GITHUB_TOKEN
   npm run deploy
   ```

この時点では `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` が空なので、Worker はすべてのリクエストを 403 で拒否します。手順 4 で設定します。

## 4. Cloudflare Access で保護する

1. ダッシュボードの「Workers & Pages > nook-viewer > Settings > Domains & Routes」で、`workers.dev` の行にある「Enable Cloudflare Access」を選びます。「Access: Apps and Policies: Edit」を持つ API トークンがあれば、`POST /accounts/<アカウントID>/access/apps` で `type: self_hosted`、`domain: nook-viewer.<サブドメイン>.workers.dev` のアプリを作っても同じです。
2. 作られた Access アプリケーションのポリシーで、許可するメールアドレスを自分だけにします。
3. Access アプリケーションの画面で、Application Audience(AUD)タグとチーム名(`<チーム名>.cloudflareaccess.com`)を確認します。
4. `wrangler.jsonc` の `ACCESS_TEAM_DOMAIN` にチーム名、`ACCESS_AUD` に AUD を書き、もう一度 `npm run deploy` します。

Worker は Access が付ける `Cf-Access-Jwt-Assertion` の署名・発行元・AUD を確かめます。Access を外したり設定を間違えたりした場合も、Worker 側で 403 になります。

## 5. 動作を確かめる

```bash
gh workflow run collect.yml -f collectors=jp_tech_news
gh run watch
```

終わったら viewer の URL を開き、「国内」タブに記事が出ることを確かめます。

## 6. 自動デプロイを有効にする

`.github/workflows/deploy-viewer.yml` は、viewer に関わる変更が main に入ったときに CI(ruff、pytest、tsc、vitest)を通してから `wrangler deploy` を実行します。Actions の画面か `gh workflow run deploy-viewer.yml` で手動でも動かせます。使う前に次の 2 つを登録します。

1. Cloudflare のダッシュボードで「プロファイル > API トークン > カスタムトークンを作成する」を選び、権限を「アカウント / Workers スクリプト / 編集」と「アカウント / アカウント設定 / 読み取り」にし、アカウントリソースを自分のアカウントに絞ってトークンを作ります。
2. GitHub に登録します。

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN       # 1 で作ったトークンを貼り付ける
   gh variable set CLOUDFLARE_ACCOUNT_ID    # wrangler whoami で出るアカウント ID
   ```

`GOOGLE_API_KEY` と `GITHUB_TOKEN` は Cloudflare 側の secret なので、自動デプロイでは上書きしません。D1 のテーブルを変える(`migrations/` に SQL を足す)ときは、デプロイの前に手元で `npx wrangler d1 migrations apply nook-study --remote` を実行します。自動デプロイのトークンには D1 の権限を付けていません。トークンが未登録のままだと、デプロイのジョブは「CLOUDFLARE_API_TOKEN が必要」というエラーで止まります。

## ローカルでの確認

```bash
# collector のテスト
make post-change

# viewer のテスト(Workers のランタイム上で動く)
cd nook/deploy/cloudflare/viewer
npm test
npm run typecheck
```

`wrangler dev` で viewer を動かすときは、`.dev.vars` に `ACCESS_DISABLED=true` を書きます。この設定が効くのは localhost へのアクセスだけです。

## 費用と上限

- GitHub Actions: 公開リポジトリなら実行時間は無料で、上限もありません。
- R2: 保存 10 GB/月、書き込み 100 万回/月、読み取り 1000 万回/月まで無料です。
- D1: 保存 5 GB、読み取り 1 日 500 万行、書き込み 1 日 10 万行まで無料です。学習データは 1 人分の書き込みだけなので、この範囲に収まります。
- Workers Free: 1 日 10 万リクエストまで。チャット 1 回あたりの外部リクエストは、記事のリンク最大 5 件と Gemini 1 件です。
- GitHub は、公開リポジトリに 60 日間コミットが無いと cron の workflow を止めます。止まったら Actions 画面で再び有効にしてください。
- collector は `NOOK_LLM_RESPONSE_CACHE=enabled` で動き、同じ記事やリポジトリの要約を R2 から再利用する。Retry で同じ日を再実行しても、内容が変わっていない記事は LLM を呼ばない。
- 主な費用は Gemini API です。国内タブだけで 1 日 60 件前後の記事を要約します(2026-11-26 に計測)。
