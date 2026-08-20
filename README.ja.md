# X Collector

<div align="center">

[🇺🇸 English](README.md) ｜ **🇯🇵 日本語** ｜ [🇨🇳 简体中文](README.zh.md) ｜ [🇹🇭 ไทย](README.th.md)

![X Collectorのヒーロー画像。集めた投稿の流れが1部の新聞に織り込まれ、それを女性が読んでいる。"One information base, read by people and agents alike."](assets/hero.jpg)

<h4>散らばるAI・テックの最新情報を、毎日1つの新聞と検索できるフィードにまとめる、<br>自分のパソコンやサーバーで動かす無料のオープンソースソフトウェアです。</h4>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql)
[![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)
[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

[できること](#what) ｜ [必要なもの](#requirements) ｜ [使いはじめる](#start) ｜ [安心の理由](#safety) ｜ [もっと詳しく](#more)

役立つ情報はSNS・専門サイト・プロジェクトの公開ページに散らばっていて、<br>
毎日いくつもの場所を見回っても、大事な流れを見落としてしまいます。<br>
X Collector は、自分で選んだ情報源から更新を集めて整理し、話題どうしをつなぎ、<br>
人にもAIエージェントにも同じ「整理済みの情報」を届けます。

**情報の見回りを、ゼロにします。**

🔧 [エンジニア向けドキュメント](docs/engineering.ja.md) ｜ 📘 [詳細仕様](docs/reference.ja.md)

</div>

---

## こんな経験はありませんか？

1つでも心当たりがあれば、X Collector の出番です。

- X・Reddit・GitHub・たくさんのサイトを追っているのに、大きな発表を見逃した
- 毎日の情報チェックに1時間かかり、その多くが同じ話の繰り返しだった
- フォローしているアカウントのうち、どれがまだ有益なのか分からなくなった
- 「今週何があった？」とAIアシスタントに聞いても、自分が信頼する情報源からは答えてくれない

原因はシンプルで、**情報が「1つの整理された場所」に届いていない**ことです。X Collector は、この集めて整理する仕事をまるごと引き受けます。

---

<a id="what"></a>

## できること

やることは4つ。順番もこのままです。

```mermaid
flowchart LR
    A["① 集める<br/>8種類の情報源から"] --> B["② 整理する<br/>分類してつなぐ"]
    B --> C["③ 新聞にする<br/>毎日1つの紙面に"]
    C --> D["④ 届ける<br/>人とAIエージェントへ"]
```

- 📥 **集める**

  X（Twitter）、Instagram、Facebook、Reddit、Qiita、GitHub、そしてRSS・YouTubeフィードから更新を集めます。どの情報源を使うかは、すべてあなたが決めます。

- 🗂️ **整理する**

  すべての記事をカテゴリに分類し、重複や続報をつなぎ、それぞれの情報源が最近どれくらい信頼できるかを点数にします。

- 📰 **新聞にする**

  選ばれた記事を13セクションの紙面に組み上げます。毎日、自動でです。

- 🤖 **人とAIに同じ情報を届ける**

  人はWebで新聞と検索フィードを読み、AIエージェントはAPIとMCPサーバー（AIツールがつながるための標準的な窓口）からまったく同じデータを読みます。

- ✅ **最後は必ず人が決める**

  有望な新しい情報源を見つけて提案はしますが、あなたが承認しない限り、収集対象には加わりません。

---

<a id="requirements"></a>

## 必要なもの

必要なのは3つです。詳しい対応環境表は[エンジニア向けドキュメント](docs/engineering.ja.md#supported-environments)にあります。

- **動かす場所** — 自分のパソコンかサーバー。Node.js 20以上が動けばOK
- **PostgreSQLデータベース** — 集めた記事の保存先です
- **APIキーは「使う機能の分だけ」** — 下の表のとおりです

| やりたいこと | 必要なもの |
|---|---|
| Web画面にログインする | Google OAuthの認証情報（無料） |
| X・Instagram・Facebook・Redditから集める | [ScrapeCreators](https://scrapecreators.com/)のキー |
| AIで分類し、新聞を作る | [OpenRouter](https://openrouter.ai/)のキー |
| YouTubeの文字起こしを記事に足す | [TranscriptAPI](https://transcriptapi.com/)のキー（任意） |
| Qiita・GitHub・RSSから集める | キー不要 |

お金について: ログインに使うGoogle OAuthは必須ですが無料です（ログインの仕組みであって、課金されるAPIではありません）。ScrapeCreatorsとOpenRouterは使った分だけ支払う有料サービスです（最新の料金は各サイトで確認してください）。有料キーがなくてもアプリは起動し、ログインでき、キー不要の情報源からは収集できます。AIを使う処理（分類と毎日の新聞づくり）は、OpenRouterのキーを足すまで動きません。キーは後から1つずつ足せます。

---

<a id="start"></a>

## 使いはじめる

### AIに入れてもらう

AIコーディングエージェント（Claude Code、Codex CLIなど）を使っているなら、リポジトリを渡すのが最短です。

```text
https://github.com/caty-ai/x-collector をこのマシンにセットアップして。
.env.example を見ながら、必要な設定を順番に聞いてください。
```

エージェントがダウンロードとインストールを進め、データベースの場所やログイン用キーなど、あなたにしか決められない値だけを聞いてきます。答えられない質問があれば、そのままエージェントに伝えてください。PostgreSQLデータベースの用意やGoogle OAuthの設定も、エージェントと一緒に進められます。

### 自分で入れる

手順1 — ダウンロードとインストール:

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

手順2 — `.env` をテキストエディタで開き、必要な値を設定します。最初の5つはデータベースとログイン用、最後の2つはフィード・新聞画面を動かすための設定です。

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000

# 1台で動かす場合はアプリ自身を指定し、
# キーは自分で決めた長いランダム文字列でOK
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

手順3 — 起動します。

```bash
npm run migrate
npm run dev
```

`http://localhost:3000` を開いてログインし、`/settings` から情報源を登録します。まずサンプルの情報源で試したいときは、`npm run seed` を1回実行してください。収集用のキーが用意できたら、ターミナルをもう1つ開いて `npm run collect` を実行すると収集が始まります。

<details>
<summary>うまくいかないときは</summary>

<br>

**`command not found: npm` と出る**

Node.jsがまだ入っていません。[nodejs.org](https://nodejs.org/)からバージョン20以上を入れて、ターミナルを開き直してから再実行してください。

**データベースに接続できない**

PostgreSQLが起動しているか、`DATABASE_URL` に書いたユーザー名・パスワード・データベース名が実在するかを確認してください。`x_collector` という名前のデータベースを先に作り忘れているケースが一番多いです。

**Googleログインでエラーが出る**

Google OAuthの認証情報は、[Google Cloud Console](https://console.cloud.google.com/)の「APIとサービス → 認証情報 → 認証情報を作成 → OAuthクライアントID」から無料で作成できます。`NEXTAUTH_URL` がブラウザで開いたアドレスと一致しているか、Google Cloud側に登録したリダイレクトURIが `http://localhost:3000/api/auth/callback/google` になっているかを確認してください。

</details>

---

<a id="safety"></a>

## 安心して使える理由

X Collector は「自動化が勝手に暴走しない」ことを設計の柱にしています。

- **新しい情報源は必ずあなたが承認** — 見つけた候補は点数付きで提案されるだけで、昇格できるのは人だけです
- **手動で登録した情報源は自動停止されない** — 自動停止の対象はシステムが自動発見した情報源だけ。それも2週連続の判定を通った場合に限ります
- **情報源の品質を毎日採点** — 信頼度スコアが紙面の順位に反映され、信頼度の低い・未検証の情報源の記事は黙って信頼扱いせず警告バッジで明示されます
- **エージェントの窓口は読み取り専用** — MCPサーバーは検索と閲覧だけで、何も変更できません
- **データはあなたのもの** — 自分のサーバーと自分のデータベースで動き、ライセンスはMITです

## プロジェクトの状態

[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)

- **CI**: 上のバッジはリアルタイムの状態を示します — pull request のたびに、そして main への push のたびに Vitest と TypeScript のチェックを実行します
- **検証済み環境**: main への push 用 CI は Ubuntu と macOS で Node.js 20 を固定し、pull request のゲートはランナー既定の Node.js（現在は 22 以上）を使います
- **成熟度**: コアパイプラインは日々の本番運用で使用されており、積極的にメンテナンスされています
- **既知の制約**: 外部プラットフォームと通信するコレクターにはご自身の API 認証情報が必要で、CI では実行されません

ご自身でチェックを実行する場合: `make test` / `make lint`（`npm test` と TypeScript のチェックをまとめて実行します — [CONTRIBUTING](CONTRIBUTING.md) を参照）。

---

<a id="more"></a>

## もっと詳しく

コミュニティソースのカタログと貢献ガイド: [docs/community-sources.md](docs/community-sources.md) — 掲載されるのは提案だけで、自動購読されることはありません。

目的別の入口です。

| 知りたいこと | 見る場所 |
|---|---|
| 仕組み・アーキテクチャ・セットアップ全体・運用（エンジニア向け） | [docs/engineering.ja.md](docs/engineering.ja.md) |
| 正確な仕様（環境変数・API・MCPツール） | [docs/reference.ja.md](docs/reference.ja.md) |
| 細かい設定・スケジュール・運用の全リファレンス | [docs/operations.md](docs/operations.md) |
| 開発に参加したい | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 不具合・脆弱性を見つけた | [SECURITY.md](SECURITY.md) |

<!-- family:generated:family-footer:start -->

---

このリポジトリは **Caty AI ファミリー** の一員です — AI エージェントの家族を運用するためのオープンなツール群。公開準備中のモジュールを含む全体の地図は [Family OS](https://github.com/caty-ai/family-os) にあります。

| 軸 | モジュール | 何をするもの | 状態 |
| --- | --- | --- | --- |
| 地図 | [Family OS](https://github.com/caty-ai/family-os) | AIファミリー全体の地図 — モジュール・状態・つながり | 公開・MIT |
| 掟 | [Family Dev Handbook](https://github.com/caty-ai/family-dev-handbook) | 開発の交通ルール — Issue・PR・worktree・受け渡し・並行開発 | 公開・MIT |
| 縦軸・基盤 | [Caty Agent Harness](https://github.com/caty-ai/caty-agent-harness) | AIエージェントのタスク基盤 — 試行・リトライ・チェックポイント・完了判定 | 公開・MIT |
| 縦軸 | [context-kit](https://github.com/caty-ai/context-kit) | エージェント1体分のコンテキスト衛生キット — 大出力の退避・委譲ブリーフ検査・安全フック・記憶検索 | 公開・MIT |
| 縦軸 | [Persona Engine](https://github.com/caty-ai/persona-engine) | エージェントに人格を与える — 人格レイヤーと感情のグラデーション | 公開・MIT |
| 縦軸 | [Persona Growth Loop](https://github.com/caty-ai/persona-growth-loop) | 人格そのものを育てる — 最小・冪等な提案づくり | 公開・MIT |
| 縦軸 | **X Collector** | Xやウェブの素材を1日1回のダイジェストに — 人にもエージェントにも | 公開・MIT |
| 縦軸 | [Self Growth Loop](https://github.com/caty-ai/self-growth-loop) | エージェントが自分の能力を育てるループ — 提案・ガバナンス・採用記録 | 公開・MIT |
| 横軸・基盤 | [Family Memory Architecture](https://github.com/caty-ai/family-memory-architecture) | 記憶バス — 家族が知っていることを共有する層 | 公開・MIT |
| 横軸 | [Sitter](https://github.com/caty-ai/sitter) | 委譲したエージェント実行の見張り番 — 監視・証拠の記録・再起動 | 公開・MIT |

<!-- family:generated:family-footer:end -->

---

## 謝辞

X Collector は次のサービスの上に成り立っています: [ScrapeCreators](https://scrapecreators.com/)（SNS収集API）、[OpenRouter](https://openrouter.ai/)（AI分類と紙面生成）、[Qiita API v2](https://qiita.com/api/v2/docs)、[GitHub REST API](https://docs.github.com/en/rest)、[Railway](https://railway.com/)（ホスティング）、[TranscriptAPI](https://transcriptapi.com/)（YouTube文字起こし）。

---

## ライセンス

[MIT](LICENSE) © 2026 Caty

誰でも自由に使って、改造して、自分のサービスに組み込んでほしいのでMITにしています。著作権表示さえ残していただければ、商用利用も再配布も歓迎です。

---

<div align="center">

**毎日1つの新聞** ｜ **8種類の情報源** ｜ **人とAIに同じ情報を**

</div>
