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
- **読者操作。** 紙面の各記事には AI に聞く／X／Facebook／リンクコピーのボタンと、位置に基づく安定したアンカー（`/calendar?date=YYYY-MM-DD#a-YYYY-MM-DD-n`。紙面の再公開時には再割り当て）があります。セルフホストの ask-ai-widget v0.1.3 バナー（© 2026 Sho Jikumaru、`public/calendar/ask-ai-widget.js` に原本のまま同梱、MIT、追跡なし、外部リクエストなし）から、その日の紙面について自分の AI に質問できます。ウィジェットは独自の `<style>` 要素を挿入するため、CSP の `style-src` を追加する際は考慮が必要です。また unmount API がないため、日付を切り替えるたびに少数の不活性な document リスナーが残ります（セッション内の切り替え回数に比例）。紙面単位の「AIに聞く」プロンプトは `/api/bff/newsletter-editions/latest?format=markdown&date=…` を先に読み、Markdown 版が読めない場合だけ `/calendar?date=…` を使うよう案内します。`/llms.txt` も AI 読者向けの案内板として同じ URL を掲載します。

---

<a id="supported-environments"></a>

## 対応環境

✅ は、このリポジトリまたは記録済みの本番環境で確認できたものです。⚠️ は対応が明記され、動作が見込まれるものの、このチェックアウトでは実際に接続していないものです。

| 分類 | 環境 | 状況 |
|---|---|---|
| ランタイム | Node.js 20以上。このチェックアウトはNode.js 26.5.0でビルド | ✅ 確認済み |
| データベース | PostgreSQL。最低サーバーバージョンの指定はなし | ✅ Prisma providerとマイグレーションを確認 |
| ホスティング | Railway | ✅ 本番稼働を確認済み |
| OS（開発・セルフホスト） | Linux（`ubuntu-latest`）と macOS（`macos-latest`・Apple Silicon） | ✅ フルテストスイート（typecheck・Prisma generate・テスト）が両OSのCIで実走 |
| OS（WSL2 補足） | WSL2（Windows 上の Ubuntu） | ⚠️ Linux 経路でカバー。個別の実走はなし。クローンは Linux ファイルシステム側（例: `~/`）に置き、`/mnt/c` は避けてください — drvfs 越しでは `next dev` のファイル監視が不安定で、`npm install` も大幅に遅くなります |
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

- Node.js 20以上
- PostgreSQLデータベース
- 管理画面へのログインに使うGoogle OAuthの認証情報＋ログインを許可するGoogleアカウントのアドレス
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

# ログインを許可するGoogleアカウント（カンマ区切り）。未設定＝誰もログインできません。
ADMIN_EMAIL_ALLOWLIST=you@example.com

# フィード/新聞UIは /api/bff/* プロキシ経由で読み込む。
# 1台構成ならアプリ自身を指定し、キーは自分で発行（長いランダム文字列）
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

`ADMIN_EMAIL_ALLOWLIST` はログインを許可するGoogleアカウントの一覧です。各アカウントはmyaccount.google.comに表示されるプライマリアドレスで指定してください（Gmailのドット・plus variant、`googlemail.com`、Workspace aliasは別アドレスとして扱われます）。ログインはfail-closeで、未設定・空の場合はすべてのGoogleアカウントが`AccessDenied`になり、サーバーは起動時にモジュールごとに1行（最大2行）の警告を出します。

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

<a id="reader-access-modes"></a>

### 読者アクセスの3モード

管理画面（`/`、`/feed`、`/settings`、`/admin`）は常にallowlist済みのGoogleアカウントに限定されます。一方、新聞（`/calendar`）は読者に3通りの方法で開けます。1つ目が既定で、残り2つはopt-inです。

1. **allowlist済みのGoogleアカウント** — `ADMIN_EMAIL_ALLOWLIST`に載っているアカウントはGoogleでサインインすれば、新聞を含むすべての画面を閲覧できます。
2. **共有パスフレーズ** — `NEWSPAPER_SHARED_ID`と`NEWSPAPER_SHARED_PASSWORD`を設定すると、読者は`/np-login`からそのペアでサインインし、読者パス（`/calendar`と条件に一致するGET/HEADの記事パス）を開けるcookieを受け取れます。このcookieは`AUTH_SECRET`（または別名`NEXTAUTH_SECRET`）で署名されるため、secretをローテーションすると共有パスフレーズの読者は全員サインアウトされます。この2つの変数と実際のauth secretがそろわない限り、このモードは有効になりません。
3. **公開新聞** — `NEWSPAPER_PUBLIC=1`（または`true`）を設定すると、誰でもサインインせずに`/calendar`を閲覧できます。既定はoffです。

`NEWSPAPER_PUBLIC=1`が開くものと、閉じたままのもの:

- **開くもの** — `/calendar`とその静的アセット、newsletter BFF、og-image BFFを匿名の読者に開きます
- **記事ランディングページ** — `/a/<YYYY-MM-DD>/<12-hex>`は、`NEWSPAPER_PUBLIC=1`（または`true`）かつパスが完全一致するGET/HEADリクエストの場合にのみ匿名で開きます（末尾のスラッシュは任意）。スイッチ未設定時はallowlist済みのログインまたは有効な共有cookieが必要です。匿名リクエストにはIPごとに60秒あたり240件のスロットルを適用し、超過時は`Retry-After: 60`付きの429を返します。これは乱用への抑止のみです。
- **閉じたまま** — `/`、`/feed`、`/settings`、`/admin`、`/api/admin/*`、`/api/bff/feed`は引き続きallowlist済みのGoogleアカウントが必要です
- **`/np-login` はそのまま** — 公開スイッチのon/offに関係なく共有ログインに使えます
- **公開済みの号のみ** — 匿名向けnewsletter BFFは公開済みの号だけを返し、下書きや空の日付には404を返します。上流へ転送するのは検証済みの`date`・`format`・`includeContent`・`includeItems`パラメータのみです
- **og-imageガード** — og-imageのリクエストは号を特定できる情報（`?date=`、`?date=`付きの同一オリジンReferer、または最新号に該当するURL）を必要とします。このガードはサインイン済みの読者にも適用されます
- **スロットル** — 匿名リクエストはIPごとにレート制限されます（newsletter BFFは60秒あたり240件、og-image BFFは60秒あたり120件、記事ページは60秒あたり240件）。これは認可の仕組みではなく、乱用への抑止です
- **リクエスト時に読み込み** — スイッチの切り替えは再起動後に反映されます（envをビルドに焼き込むホストでは再デプロイが必要）

- **記事の公開条件** — 匿名・session・共有 cookie を含む全 caller に対し、存在しない号と非 published の号は Markdown 解析前に 404 とする。未知の ID は `/calendar?date=<date>&from=a` へ HTTP 307 で遷移し、警告は process ごと最大10回/分に制限する。概要・安全な引用元リンク・紙面への CTA は JavaScript なしで表示でき、AI メニューはその HTML に追加される機能である。
- **取得の入場制御** — loader 専用の process 内 semaphore は同時取得4件・待機32件である。待機枠超過または3秒の待機予算超過は HTTP 500（load-shed）となる。App Router の page から 503 は返せないためである。取得 timeout は10秒であり、ページ遅延を抑える意図的な設定である（newsletter BFF は30秒のままである）。同日 miss は single-flight で共有する。FIFO cache は解析済み16件を60秒、status 4096件を保持する。不存在・非公開は60秒、上流エラーは10秒であり、busy は cache しない。
- **記事 ID の凍結規則** — 解析済み source 欄の最初の HTTP(S) URL（Markdown link または裸 URL）のみを抽出し、本文は使用しない。userinfo は拒否し、scheme/host は小文字化、既定 port と fragment は除去する。query key の `utm_*`・`fbclid`・`gclid`・`mc_cid`・`mc_eid`・`igshid`・`ref_src` は大文字小文字を区別せず除去する。それ以外（`s` を含む）は維持し、key/value の code-unit 順に並べて URLSearchParams で再直列化する。path の percent octet は RFC 3986 unreserved 文字だけ復号し、残る percent triplet は大文字化する。root `/` 以外の末尾 slash は除去する。正規化 URL の SHA-256 先頭12桁の小文字 hex を ID とし、文書順の最初の出現を採用する。末尾 root-label dot・mobile host・redirect は統合せず、`)` で URL 抽出は終わる。source なしでは記事ページ・共有ボタンを持たず、copy は紙面 URL を使用する。旧 `#a-<date>-<n>` anchor は受信側で引き続き処理する。
- **組版の保証範囲** — 全角 `引用元：` を半角 `引用元:` と同じ規則で引用元マーカーとして受理する。半角の引用元に基づく記事 ID は不変である。LLM 組版の号は ID 安定性の保証対象外である。`STEP5_COMPOSE_MODE` の既定は `script` であり、LLM 組版を維持する場合は `llm` を明示する。
- **共有 origin** — 記事 canonical と `og:url` は `/a/<date>/<id>` の path のみであり、utm query を含めない。カードには `NEWSPAPER_SITE_URL`（fallback は `NEXTAUTH_URL`）を設定する。`Host` は信頼しない。origin が null のときは metadataBase・canonical・OG URL・全画像を省略し、noindex/nofollow と process ごと1回の警告を設定する。記事メタデータに絶対 URL は出さない。origin がある場合、OG 取得は待機込み1.5秒を予算とし、失敗時は `/og-default.png` を使う。
- **Discovery** — `NEWSPAPER_PUBLIC` が on で site origin（`NEWSPAPER_SITE_URL`、fallback は `NEXTAUTH_URL`）が解決できるときだけ、`robots.txt` は `/a/`・`/calendar`・`/sitemap.xml`・`/og-default.png` を許可して `sitemap.xml` を案内する。それ以外は robots がすべて拒否し sitemap は空となる。sitemap は同じ server-only loader（順次取得・cache 利用）経由で直近 7 JST 日分の記事 URL を列挙する。1 リクエスト 5 秒予算を日付間で確認し、時間切れ時は取得済み分の部分 sitemap を返す。`Host` は信頼しない。

すべてのゲートのfail-close挙動を含む正式なルールは運用ガイドにあります。[公開モード](operations.md#公開モード-newspaper_public)、[Auth / API keyのfail-closeルール](operations.md#auth--api-key-fail-closed-rules)。

---

## 設定

| やりたいこと | 見る場所 |
|---|---|
| すべての環境変数を確認する | [環境変数リファレンス](operations.md#環境変数全リファレンス) |
| 新聞を匿名読者に開く（`NEWSPAPER_PUBLIC=1`、既定はoff）、またはそのサブタイトルを変える（`NEWSPAPER_TAGLINE`、既定は日本語のタグライン） | 上記[読者アクセスの3モード](#reader-access-modes)、[公開モード](operations.md#公開モード-newspaper_public) |
| 決定論的なscript modeで既存の号を再組版する | `npm run recompose:script -- --date-jst=YYYY-MM-DD --dry-run [--out content.md]`、確認後は`--dry-run`を外して反映 — [V2パイプライン補助CLI](operations.md#v2-パイプライン補助-cli) |
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
