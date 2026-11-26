# nook(Cloudflare 版)

技術ニュース、国内の技術記事、論文、OSS の動向を毎朝集めて日本語で要約し、ブラウザで読めるようにする個人用アプリです。記事ごとに AI へ質問もできます。今後は、読んだ内容を自分の知識として定着させる学習支援の機能を足していく予定です([#23](https://github.com/shiyow5/nook/issues/23))。

[discus0434/nook](https://github.com/discus0434/nook) をもとに、AWS を使わず GitHub Actions と Cloudflare の無料枠で動く構成に作り替えています。本家の更新は `upstream` リモートから取り込めます。

![nook の画面](assets/screenshots/cloudflare-viewer.png)

## できること

毎朝 6 時(日本時間)に GitHub Actions が収集を実行し、記事を Gemini で日本語に要約して Cloudflare R2 に保存します。画面は Cloudflare Workers が R2 から読み出して表示し、Cloudflare Access で本人だけが開けるようにしています。

画面では日付とタブを切り替えて記事を読み、記事ごとの欄から AI に質問できます。AI は Google 検索で事実を確かめながら答えます。「Retry Now」を押すと、そのタブの収集を GitHub Actions で 1 件だけやり直します。

一度要約した記事やリポジトリは、要約を R2 に保存して使い回します。何日もランキングに残る記事を毎日要約し直さないので、LLM の費用を抑えられます。保存したデータは 90 日たつと自動で消えます。

## タブと情報源

| タブ | collector | 情報源 |
|---|---|---|
| News | `tech_news` | 海外の AI・テック系メディア、OpenAI / AWS のブログ、日経ビジネス・Business Insider Japan・日経クロステック・ITmedia AI+ |
| 国内 | `jp_tech_news` | Zenn(トレンド、LLM、機械学習)、Qiita(人気記事、LLM、機械学習)、note(生成AI、LLM)、はてなブックマーク IT、DevelopersIO |
| Feeds | `tech_feed` | Hugging Face、Google Research、DeepMind のブログ |
| HN | `hacker_news` | Hacker News の上位 30 件 |
| ProductHunt | `product_hunt` | Product Hunt の当日の上位製品(API の鍵を登録すると有効、[#8](https://github.com/shiyow5/nook/issues/8)) |
| GitHub | `github_trending` | GitHub Trending(Python) |
| Papers | `paper_summarizer` | Hugging Face Daily Papers(本文を読んで要約し、論文タイトルの日本語訳も付ける) |
| Reddit | `reddit_explorer` | r/LocalLLaMA |

RSS 系のタブは `configs/<collector>/feed.toml` で情報源を増減でき、`keywords` を書くとタイトルや本文に一致した記事だけを残します。日本語を含む URL はパーセントエンコードして書いてください。

## 構成

```text
GitHub Actions(.github/workflows/collect.yml、毎日 06:00 JST と手動実行)
  └─ Python の collector(nook/services/*)
       ├─ Gemini API で要約(同じ入力は R2 のキャッシュを使う)
       └─ Markdown と状態を R2 に保存(S3 互換 API)

Cloudflare Worker「nook-viewer」(nook/deploy/cloudflare/viewer、TypeScript)
  ├─ Cloudflare Access の JWT を毎回検証
  ├─ R2 から記事を読んで画面を返す
  ├─ /chat/{tab}  : Gemini API に Google 検索付きで質問する
  └─ /retry/{tab} : GitHub Actions の collector を 1 件だけ起動する
```

collector は本家と同じ Python のコードです。保存先を環境変数で R2 に向けているので、本家の AWS 版やローカル版(`make local-register`)もそのまま動きます。

## 導入

GitHub リポジトリ、R2、Worker、Access の作り方は [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) にまとめています。必要なものは Cloudflare アカウント(R2 の有効化に支払い方法の登録が必要、無料枠内なら請求なし)、Gemini API キー、Reddit API の認証情報です。

GitHub に登録する値は次のとおりです。

| 種類 | 名前 |
|---|---|
| Secrets | `GOOGLE_API_KEY`、`REDDIT_CLIENT_ID`、`REDDIT_CLIENT_SECRET`、`REDDIT_USER_AGENT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ENDPOINT_URL`、`PRODUCT_HUNT_API_KEY`、`PRODUCT_HUNT_DEVELOPER_TOKEN` |
| Variables | `LLM_MODEL`(例: `google-gla:gemini-flash-lite-latest`)、`R2_BUCKET`、`NOOK_ENABLED_COLLECTORS`(毎朝動かす collector をカンマ区切りで) |

## 開発

```bash
uv sync --dev
make post-change        # ruff format、ruff check、pytest

cd nook/deploy/cloudflare/viewer
npm ci
npm test                # Workers のランタイム上で vitest を実行
npm run typecheck
npm run deploy          # viewer を Cloudflare にデプロイ
```

収集を手動で動かすときは `gh workflow run collect.yml -f collectors=jp_tech_news` のように collector 名を指定します。

設計の詳細は [docs/DESIGN.md](docs/DESIGN.md) にあります。リポジトリ内で AI エージェントに作業させるときの決まりは [AGENTS.md](AGENTS.md) です。

## 進め方と今後

このリポジトリは Issue 駆動で進めています。不具合、要望、実装予定はすべて [Issues](https://github.com/shiyow5/nook/issues) に登録し、Issue ごとにブランチと Pull Request を作って閉じていきます。

いま予定している主な作業は、arXiv(cs.CL / cs.LG / cs.AI)のキーワード収集、画面の刷新(日付のカレンダー選択、目次、デザイン)、画面からキーワードや収集対象を変える設定画面、Gemini の費用削減の検討([#1](https://github.com/shiyow5/nook/issues/1))です。その先に、お気に入り、用語辞書、AI による要約の添削やケーススタディといった学習支援の機能を [#23](https://github.com/shiyow5/nook/issues/23) で計画しています。

## ライセンスとクレジット

このプロジェクトは [discus0434/nook](https://github.com/discus0434/nook) の派生物で、元のプロジェクトと同じ GNU Affero General Public License v3.0 で公開しています。詳細は [LICENSE](LICENSE) を参照してください。不具合や要望は [Issues](https://github.com/shiyow5/nook/issues) へお寄せください。
