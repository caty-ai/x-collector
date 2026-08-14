# X Collector — エンジニア向けドキュメント

[← 玄関ページへ戻る](../README.ja.md) ｜ 📘 [詳細仕様](reference.ja.md)

X Collector は、自分で選んだ情報源からAI・テクノロジーの最新情報を収集し、分類パイプラインで精査したうえで、日刊のMarkdown紙面・検索できるフィード・認証付きFeed API・read-onlyのMCPサーバーとして配信する、セルフホスト型のNext.js + PostgreSQLサービスです。

---

## 特徴

- **7系統のプラットフォームから収集（情報源の種類は計8つ）。** X（Twitter）、Instagram、Facebook、Reddit、Qiita、GitHub、そしてRSS・YouTubeを含むAlertsフィード。
- **大量の情報を読みやすいフィードへ整理。** 各項目を正規化し、11種類のPrimaryカテゴリと15種類のSubカテゴリで分類。重複や続報を結び、市場の声も集約します。
- **日刊ニュースを自動で製本。** スケジュール実行される製本ジョブが、選ばれた記事を13セクションのMarkdown紙面に仕上げます。
- **人とAIが同じ情報を利用。** 人はニュース紙面とWeb画面から、連携システムは認証付きFeed APIとread-onlyのStreamable HTTP MCPサーバーから利用できます。
- **情報の薄い素材にも文脈を補強。** リンク先本文やYouTube文字起こしを分類前に追加し、判断材料を増やせます。
- **新しい情報源を探す手間を軽減。** 収集済みのX投稿から候補を抽出し、プロフィールを取得してLLMが評価します。収集対象への昇格には必ず人の承認が必要です。
- **情報源の品質を見える化。** ルールベースの信頼度スコアを日次で算出し、紙面の順位に反映。信頼度の低い・未検証の情報源の記事は紙面でバッジ表示し、ブロック判定の情報源は選定から除外します。
- **質が落ちた自動発見ソースを安全に停止。** 自動停止の対象は自動発見された情報源だけで、2週連続の判定を通った場合に限ります。手動登録した情報源が自動停止されることはありません。
- **情報源を一つの画面で管理。** 設定画面から各プラットフォームの登録情報、候補レビュー、ライフサイクルで停止した情報源の復活を扱えます。

---

<a id="supported-environments"></a>

## 対応環境

✅ は、このリポジトリまたは記録済みの本番環境で確認できたものです。⚠️ は対応が明記され、動作が見込まれるものの、このチェックアウトでは実際に接続していないものです。

| 分類 | 環境 | 状況 |
|---|---|---|
| ランタイム | Node.js 18.17.0以上。このチェックアウトはNode.js 26.5.0でビルド | ✅ 確認済み |
| データベース | PostgreSQL。最低サーバーバージョンの指定はなし | ✅ Prisma providerとマイグレーションを確認 |
| ホスティング | Railway | ✅ 本番稼働を確認済み |
| OS（開発・セルフホスト） | Linux（`ubuntu-latest`）と macOS（`macos-latest`・Apple Silicon） | ✅ フルテストスイート（typecheck・Prisma generate・テスト）が両OSのCIで実走 |
| MCPクライアント | Claude CLI、Claude.ai、Claude Desktop | ⚠️ ドキュメント記載あり。この環境では未接続 |

---

## アーキテクチャ

**設計原則：** 一度収集した情報を共通基盤で精査し、人とAIエージェントのどちらも使える形で配信します。

| モジュール | 役割 |
|---|---|
| `src/app/` | Next.jsの画面、管理UI、APIエンドポイント |
| `src/collector/` | プラットフォーム別コレクターと本番ジョブの入口 |
| `src/lib/pipeline/` | 正規化、分類、クロスリンク、信頼度を加味した選定、製本 |
| `src/summary/` | デイリーサマリー生成 |
| `prisma/` | PostgreSQLスキーマとマイグレーション |

処理の全体像は[パイプラインV2設計](v2-design.md)を参照してください。デプロイ時刻、安全設計、データ保持、運用コマンドは[運用ガイド](operations.md)にまとめています。

> **メモ:** `docs/prompts/` はドキュメントではなく、実行時に読み込まれるプロンプトの正本です。分類パイプラインが実行時に `<cwd>/docs/prompts/step1-3/` を読むため、このディレクトリは移動・削除しないでください。

---

<a id="quickstart"></a>

## クイックスタート

### 前提条件

- Node.js 18.17.0以上
- PostgreSQLデータベース
- 管理画面へのログインに使うGoogle OAuthの認証情報
- 収集・分類を始める際はScrapeCreatorsとOpenRouterのAPIキー
- YouTube文字起こしの補強を使う場合のみTranscriptAPIのキー（任意）

現在のスキーマでは、埋め込みデータをPostgreSQLのJSONBとして保存します。pgvector拡張は不要です。

### インストール

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

### 最小構成

アプリを起動する前に`.env`を開き、次の値を設定します。

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000

# フィード/新聞UIは /api/bff/* プロキシ経由で読み込む。
# 1台構成ならアプリ自身を指定し、キーは自分で発行（長いランダム文字列）
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

`RAILWAY_API_BASE_URL` と `FEED_API_KEY` が未設定の場合、ログインには成功しますが、フィード・エクスプローラー・新聞の各画面はBFFプロキシ経由で読み込むためエラーになります。

収集と分類も行う場合は、次の値を追加します。

```dotenv
SCRAPECREATORS_API_KEY=your_scrapecreators_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

LLMによる分類と紙面生成はOpenRouter経由で動作し、既定モデルはいずれも`google/gemini-3.1-flash-lite-preview`です（`CLASSIFY_MODEL`・`STEP4_CROSSLINK_LLM_MODEL`・`STEP5_COMPOSE_MODEL`で変更可）。任意のキーとして、`TRANSCRIPTAPI_API_KEY`を設定するとYouTube文字起こしの補強が有効になり、`GITHUB_TOKEN`を設定するとGitHub APIのレート制限が緩和されます（未設定でも収集自体は可能）。QiitaとRSSの収集にキーは不要です。

どのキーが無いと何が動かないかの早見表です。

- **ScrapeCreatorsキーなし** — Qiita・GitHub・RSSの収集は動きます。X・Instagram・Facebook・Redditの収集は失敗またはスキップされます
- **OpenRouterキーなし** — 収集と閲覧は動きますが、LLMを使う処理（分類・クロスリンク・紙面生成）はすべて使えません
- **本番サイクルジョブ** — `collect:prod:cycle` は起動時に `SCRAPECREATORS_API_KEY` と `OPENROUTER_API_KEY` の両方を検査し、欠けていれば即終了します

### 実行

```bash
npm run migrate
npm run dev
```

`http://localhost:3000`を開いてログインし、`/settings`から自分の収集元リストを登録します。`npm run seed`を1回実行すると、中立なサンプル情報源（Xハンドル数件とFacebook・Reddit・Qiita・GitHubのサンプル）を投入して最短で動作確認できます。APIキーと情報源の準備ができたら、別のターミナルから手動収集を実行できます。

```bash
npm run collect
```

---

## 設定

| やりたいこと | 見る場所 |
|---|---|
| すべての環境変数を確認する | [環境変数リファレンス](operations.md#環境変数全リファレンス) |
| パイプラインの各処理を個別に実行する | [V2パイプライン補助CLI](operations.md#v2-パイプライン補助-cli) |
| 本番の実行スケジュールを設定する | [本番cronガイド](operations.md#cron本番運用) |
| 自分の収集元を追加する | [ソース追加方法](operations.md#ソース追加方法) |
| 情報源の発見・信頼度・停止ルールを理解する | [運用ガイド](operations.md) |
| 既知の運用課題を確認する | [既知のfollow-up](operations.md#既知の-follow-up未着手) |

---

<a id="development-status"></a>

## 開発状況とロードマップ

- [x] **収集：** 7系統のプラットフォーム、PostgreSQLへの統合保存、Feed API
- [x] **精査：** 正規化、LLM分類、クロスリンク、市場の声の集約、現行タクソノミー
- [x] **製本：** 情報源リンク付きの13セクションMarkdown紙面
- [x] **エージェント連携：** 検索Feedとread-only MCPツール（`search_feed`、`get_daily_news`）
- [x] **情報源の品質管理：** 候補評価、信頼度スコア、承認UI、安全柵付きの停止ライフサイクル
- [x] **公開の基盤：** 多言語の公開ドキュメント、コミュニティファイル、MITライセンス
- [ ] **今後の候補：** 意味的トピッククラスタリングの改善、紙面公開フローの整理、データ保持方針の文書化

直近の変更は[変更履歴](changelog.md)、現在の運用課題は[既知のfollow-up](operations.md#既知の-follow-up未着手)で確認できます。

---

## コントリビュート

Issue起点の開発フロー、ブランチ運用、Pull Requestの書き方は[CONTRIBUTING.md](../CONTRIBUTING.md)を参照してください。

---

## 謝辞

X Collectorは、以下のサービスの上に成り立っています。

- [ScrapeCreators](https://scrapecreators.com/) — X、Instagram、Facebook、Redditの収集API
- [OpenRouter](https://openrouter.ai/) — LLM分類と紙面構成
- [Qiita API v2](https://qiita.com/api/v2/docs) — Qiita記事の収集
- [GitHub REST API](https://docs.github.com/en/rest) — リポジトリ・検索データ
- [Railway](https://railway.com/) — ホスティングとスケジュールジョブ
- [TranscriptAPI](https://transcriptapi.com/) — YouTube文字起こしの補強
