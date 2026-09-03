# 運用ガイド（Operations Guide）

README から移設した、運用・チューニング系の詳細リファレンスです。初回セットアップは [エンジニア向けドキュメントのクイックスタート](engineering.ja.md#quickstart) を参照してください。

`prisma/migrations/20260301000000_init_base` は、migrations ディレクトリより前に `prisma db push` で作られていた初期テーブルを移行履歴に取り込むためのベースラインです。新規環境では通常の最初の migration として適用され、長期運用中の既存データベースでは既存オブジェクトを変更せず no-op として記録されます。`prisma/migrations/20260802000000_align_crosslink_index_names` は、fresh migration 時に PostgreSQL の63バイト識別子上限で切り詰められた crosslink index 名を Prisma の canonical 名に合わせる rename であり、production の db-pushed DB は既に canonical 名を持つため `IF EXISTS` で保護されています。

## 目次

- [V2 パイプライン補助 CLI](#v2-パイプライン補助-cli)
- [Step4 LLM manual-run](#step4-llm-manual-run)
- [Production ジョブ（cron 用）](#production-ジョブcron-用)
- [cron（本番運用）](#cron本番運用)
- [環境変数（全リファレンス）](#環境変数全リファレンス)
- [ソース追加方法](#ソース追加方法)
- [自律ソース発見・信頼度](#自律ソース発見信頼度)
- [Daily Digest（自動デイリーニュース）](#daily-digest自動デイリーニュース)
- [運用状況](#運用状況)
- [媒体別の役割マッピング](#媒体別の役割マッピング)
- [既知の follow-up（未着手）](#既知の-follow-up未着手)

## V2 パイプライン補助 CLI

- `npm run normalize:pipeline`
- `npm run classify:pipeline`
- `npm run classify:pipeline:llm`
- `npm run enrich:pipeline:transcripts`（Alerts 内の YouTube URL を TranscriptAPI で補強）
  - 保存先: `pipeline_items.raw.enrichment.youtubeTranscript`
  - `youtubeTranscript.descriptionText / descriptionUrls[]` も保持（動画概要欄のリンク抽出）
- `npm run enrich:pipeline:links`（title/body/raw 内 URL を抽出し、本文を `raw.enrichment.linkContents[]` へ補強）
  - YouTube URL 本体は自動スキップ（Transcript lane 担当）
  - `youtubeTranscript.descriptionUrls[]` にある外部 URL は Link enrichment 対象
- `npm run crosslink:pipeline`（既存ルールベース Step4）
- `npm run crosslink:pipeline:llm` / `npm run step4:crosslink:llm`（LLM Step4 manual-run）
- `npm run voicesignal:pipeline`
- `npm run publish:pipeline`
- `npm run retention:pipeline`（raw source rows + newsletter未採用の古い `PipelineItem` を整理。既定 dry-run）
- `npm run collect:prod:cycle`（収集 + Step0→1-3→4→6 の統合ジョブ）
- `npm run publish:prod:daily`（Step5 単独ジョブ）

## Step4 LLM manual-run

```bash
# まずはドライラン（JST日付を明示）
npm run step4:crosslink:llm -- --dry-run --date-jst=2026-03-09 --batch-size=45

# 実行（pendingOnly 既定ON: 同一inputHash済みは自動skip）
npm run step4:crosslink:llm -- --date-jst=2026-03-09 --batch-size=45

# 再評価したいとき（completedも再実行）
npm run step4:crosslink:llm -- --date-jst=2026-03-09 --include-completed
```

- JST の1日窓（00:00-23:59）で抽出。`publishedAt` 優先、欠損時は `ingestedAt`（必要時のみ `createdAt`）をフォールバック。
- ノイズ除外後、URL/タイトル類似でルール事前圧縮してから LLM へ送るため、トークン消費を抑えつつ重複検知を安定化。
- LLM 出力は `pipeline_crosslink_llm_decisions`（専用テーブル）に保存。
- プロンプト雛形: [prompts/step4-crosslink-llm-template.md](prompts/step4-crosslink-llm-template.md) / [prompts/step5-publish-template.md](prompts/step5-publish-template.md)

## Production ジョブ（cron 用）

```bash
# 0:00 / 12:00 JST: 収集 + Step0→1-3→4→6
npm run collect:prod

# 6:00 JST: Step5（binding + contentMd最終組版）
npm run publish:prod
```

- `collect:prod` は `run-prod-collect-cycle` を実行し、Step4 対象日は JST 日付で自動解決。
  - 検証時は `npm run collect:prod -- --dry-run --skip-collect --date-jst=YYYY-MM-DD` を利用可能。
- `publish:prod` は同じ JST 日付キーで Step5（binding 生成）+ contentMd 最終 LLM 組版まで実行。
  - compose では「候補が十分あるセクションは最低 N 件（既定3件）」をプロンプトで要求し、密度不足時は1回だけ再生成して薄い出力を緩和。
  - `--dry-run` で当日 edition 未作成の場合、compose は自動スキップされる（`composeSkippedReason` を出力）。
  - `RETENTION_MODE=dry-run|apply` を与えた場合のみ、Step5 後段で retention を追加実行する。未設定時は完全 skip。
- 旧コマンド（収集のみ）が必要な場合は `npm run collect:prod:legacy` を使用。

### `dist/` の運用ポリシー

Railway は `node dist/...` を実行するため、デプロイ時に `npm run build` で `dist/` を生成する（このリポジトリでは `dist/` はコミットしない・`.gitignore` 済み）。ローカルで `*:prod` を実行する前は `npm run build` を実行すること。

### Retention runbook

```bash
# 1. 初回は dry-run。Step5 サービスの env に設定すると毎朝の製本後に counts が出る
railway variables --service x-collector-step5-cron --set RETENTION_MODE=dry-run

# 2. 数日分の counts を確認後、apply に切り替える
railway variables --service x-collector-step5-cron --set RETENTION_MODE=apply
```

1. `RETENTION_MODE=dry-run` のまま数日間運用し、各テーブルの `wouldDelete` と最終 summary の件数が想定どおりか確認する。
2. `NewsletterBinding` / `NewsletterEdition` の件数が変わらないことと、必要なら DB snapshot / backup が取得済みであることを確認する。
3. 問題がなければ `RETENTION_MODE=apply` に変更する。以後も summary の `bindingsBefore` / `bindingsAfter` を監視する。

単独 CLI（`npm run retention:pipeline` / prod は `node dist/collector/pipeline-retention.js`）は **env に関係なく常に dry-run**。実削除は `-- --apply` を明示した時だけ（cron 用に `RETENTION_MODE=apply` が設定済みの環境で、手動の件数確認が誤って実削除にならないための安全仕様）。すべての削除は ID を最大 1000 件ずつ選択して処理する。raw 7テーブルは `fetchedAt`、未製本 `PipelineItem` は `createdAt`、運用ログは各 timestamp を基準にする。

製本済み素材は構造的に削除対象にならない。`PipelineItem` の select と delete の両方で `createdAt < cutoff AND newsletterBindings: none` を再評価するため、`NewsletterBinding` が1件でもある item は一致しない。さらに apply 前後で `NewsletterBinding` と `NewsletterEdition` の総数を比較し、差分があれば loud failure で停止する。`RETENTION_PIPELINE_DAYS` は信頼度スコアの28日窓を守るため、28未満を指定しても warning を出して28へ clamp する。**`editionId` が付いた VoiceSignal（紙面の「市場の声」素材）は削除対象外** — 親 `PipelineItem` が prune されても FK は SetNull で外れるだけで、シグナル本体（topic/sentiment/summary）は残る。

既知のポリシー留意（意図的な仕様）: ①製本済みアイテムの**処理来歴**（`PipelineRun` の LLM 生出力・crosslink decision ログ）は運用ログ扱いで `RETENTION_OPS_DAYS` により消える（紙面本文・分類結果・binding は残る） ②prune された未製本 item と製本済み item を結ぶ `PipelineLink` エッジは item 側の cascade で消える（製本済み item 本体は無傷）。この保持境界を変更する場合は、紙面本文・分類結果・binding が保持されることを先に確認する。

## cron（本番運用）

運用上の基準時刻は **JST**。Railway cron は UTC 固定なので、画面には下表の **UTC cron** をそのまま入力する（タイムゾーン設定は行わない）。

| 用途 | JST 目標時刻 | Railway に入力する UTC cron | コマンド | 現在の状態 / 備考 |
|---|---|---|---|---|
| 収集 + 精査 | 0:00 / 12:00 JST | `0 3,15 * * *` | `npm run collect:prod` | 登録済み。1回の実行で Step0→Step1-3→Step4→Step6→ソース信頼度再計算まで実行（長時間実行の衝突を避けるため暫定で1日2回） |
| 最終製本 | 6:00 JST | `0 21 * * *` | `npm run publish:prod` | 登録済み。Step5 binding + contentMd 組版（1日1回） |
| ソース発見 | 3:00 JST | `0 18 * * *` | `npm run discover:prod` | **未登録 — 実装済み。デプロイ先で cron 登録が必要**。候補抽出→プロフィール取得→LLM評価→ライフサイクル（分類 cron と時間帯をずらして LLM レート衝突を回避） |

- 収集順序（既存維持）: Twitter → Alerts/RSS/YouTube → Facebook → Reddit → Qiita → GitHub → Instagram → OpenRouter models
- Step0 normalize は常に 500 件ずつのバッチで走り、既定では `fetchedAt >= now - NORMALIZE_LOOKBACK_DAYS`（既定 14 日）だけを再走査する。クラッシュ期間（2026-07-29〜）の取りこぼしは 14 日窓に収まるため通常 cron で自動回復する。それより古い取りこぼしを疑う場合のみ、`NORMALIZE_LOOKBACK_DAYS=0 node dist/collector/pipeline-normalize.js` を 1 回実行して全件補完する（prod ホストでは `npm run normalize:pipeline` は不可 — `ts-node` は devDependency のため。バッチ走査なので全件でもクラッシュしない）。
- Step4 は既定でローリング窓（`now - STEP4_LOOKBACK_HOURS`、既定 48h）で対象抽出。`--date-jst` 明示時のみ旧来の当日カレンダー窓。
- Step4 LLM バッチサイズ既定は 45（`STEP4_CROSSLINK_BATCH_SIZE`）、max_tokens はバッチサイズから動的導出。出力截断時は `llm_batch_error` / `length_truncation` として可視化される。

### 本番 env の事前確認（Railway）

前提ツール（既定の Ubuntu / WSL2 イメージには入っていない）:

- `rg`（ripgrep）— Ubuntu/WSL2: `sudo apt-get install ripgrep` / macOS: `brew install ripgrep`
- `railway` CLI — `npm i -g @railway/cli`（[公式の他の導入手段](https://docs.railway.com/guides/cli)も可）

> **WSL2 で運用する場合**: リポジトリは Linux ファイルシステム側（例: `~/`）に置き、`/mnt/c` 配下は避けてください（ファイル監視が不安定・npm が大幅に低速）。また `gh` はディストロ内でインストール・認証してください — Windows 側の `gh.exe` が PATH に載っていると、認証情報が Windows プロファイルに書かれ、Windows 側の Git・パス解釈で動くため、`contribute-source` などが渡す Linux パス（`/tmp/...`）を扱えず正しく動きません。

```bash
# 例: cron service 側の必須キー確認
railway variables --service x-collector-cron | rg '^(DATABASE_URL|SCRAPECREATORS_API_KEY|OPENROUTER_API_KEY)='

# Step5実行側（同一サービス or 別サービス）
railway variables --service x-collector-cron | rg '^DATABASE_URL='
```

> `railway` CLI で認証エラーが出る場合は、`railway login` 後に再実行。

## 環境変数（全リファレンス）

### 紙面題字と Step1-3 実行時プロンプト

`NEWSPAPER_MASTHEAD` は `src/lib/masthead.ts` の `getMasthead()` で解決され、未設定時は `AI Daily News` になります。Step1-3 のローダーは `docs/prompts/step1-3/` にある4ファイルすべての `{{NEWSPAPER_MASTHEAD}}` をこの値に置換します。未認識の `{{...}}` が残る場合は、リテラルのプレースホルダーを LLM に送らないようプロンプト読み込みをエラーにします。

> **注意:** `final-shared-common.md`、`group-a-short-social.md`、`group-b-longform.md`、`group-c-repo.md` は文書ではなく、内容がそのまま LLM に送られる実行時プロンプトです。説明、運用メモ、注釈、blockquotes は追加せず、このガイドに記載してください。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 接続文字列 |
| `AUTH_SECRET` | ✅（Auth有効時） | Auth.js/NextAuth セッション署名シークレット。本番では `AUTH_SECRET` または `NEXTAUTH_SECRET` のどちらかが必須 |
| `NEXTAUTH_SECRET` | 任意 | `AUTH_SECRET` の互換エイリアス。開発では両方未設定時に固定 fallback へ退避し、module init で warning を1回出す。本番では fallback せず fail-close |
| `AUTH_GOOGLE_ID` | ✅（Auth有効時） | Google OAuth Client ID。本番では `AUTH_GOOGLE_ID` または `GOOGLE_CLIENT_ID` のどちらかが必須 |
| `AUTH_GOOGLE_SECRET` | ✅（Auth有効時） | Google OAuth Client Secret。本番では `AUTH_GOOGLE_SECRET` または `GOOGLE_CLIENT_SECRET` のどちらかが必須 |
| `GOOGLE_CLIENT_ID` | 任意 | `AUTH_GOOGLE_ID` の互換エイリアス |
| `GOOGLE_CLIENT_SECRET` | 任意 | `AUTH_GOOGLE_SECRET` の互換エイリアス |
| `NEXTAUTH_URL` | 推奨 | Auth.js callback URL（ローカル例: `http://localhost:3000`） |
| `ADMIN_EMAIL_ALLOWLIST` | ✅（Auth有効時） | Googleログイン自体と全NextAuth保護ルート（`/admin`・`/api/admin/**` を含む）を許可するGoogleプライマリアドレスのカンマ区切り。trim＋小文字化で比較し、未設定・空なら誰もログインできず既存トークンもfail-close。myaccount.google.com に表示されるプライマリアドレスを指定すること。Gmailのドット・plus variant、`googlemail.com`、Workspace aliasは別アドレスとして扱う |
| `NEWSPAPER_MASTHEAD` | 任意 | 紙面題字。未設定時は "AI Daily News" |
| `NEWSPAPER_SHARED_ID` | 任意 | `/calendar` 共有ログインの ID。password と安全な auth secret が揃わない場合は無効 |
| `NEWSPAPER_SHARED_PASSWORD` | 任意 | `/calendar` 共有ログインのパスワード。ID と安全な auth secret が揃わない場合は無効 |
| `SCRAPECREATORS_API_KEY` | ✅ | ScrapeCreators API キー（Twitter/Instagram/Facebook/Reddit） |
| `RAILWAY_API_BASE_URL` | ✅（BFF利用時） | BFF が Bearer 注入で中継する先の Railway API ベース URL |
| `NEWSLETTER_API_KEY` | 推奨 | Newsletter API 認証キー（最優先）。`/api/newsletter-editions/latest` は `NEWSLETTER_API_KEY -> DIGEST_API_KEY -> FEED_API_KEY` の順で解決し、本番で全て未設定なら `401 {"error":"api key not configured"}` |
| `DIGEST_API_KEY` | 任意 | Daily Digest API の認証キー（newsletter fallback 2nd）。`/api/daily-digest` は既存どおり未設定時に studio session fallback があり、open にはならない |
| `FEED_API_KEY` | 推奨 | 統合 Feed API の認証キー。`/api/feed` は本番で未設定なら fail-close、非本番では open + warning 1回 |
| `FAMILY_FEED_API_KEY` | 推奨 | `/api/family-feed` の認証キー。`/api/family-feed` は本番で未設定なら fail-close、非本番では open + warning 1回 |
| `MCP_API_KEY` | 任意 | `/api/mcp` の Bearer 認証キー。未設定時は `FAMILY_FEED_API_KEY` に fallback。両方未設定なら非本番では open + warning 1回、本番では fail-close |
| `MCP_SELF_BASE_URL` | 任意 | MCP tool が同一アプリの API を呼ぶベース URL。既定: `http://localhost:${PORT:-3000}` |
| `PORT` | 任意 | `MCP_SELF_BASE_URL` 未設定時に使うローカルポート（既定: `3000`） |
| `OG_FETCH_UA_CONTACT` | 任意 | `/api/bff/og-image` の outbound User-Agent に埋め込む連絡先。制御文字・括弧は除去し、未設定時は `+https://github.com/x-collector` |
| `SUMMARY_DASHBOARD_URL` | 任意 | daily summary の末尾に出す dashboard リンク。未設定時はリンク行を出さない |
| `TRANSCRIPT_PROVIDER` | 任意 | YouTube 文字起こし補強のプロバイダ（現状 `transcriptapi`） |
| `TRANSCRIPTAPI_API_KEY` | 任意 | TranscriptAPI キー（`enrich:pipeline:transcripts` 実行時に必須） |
| `LINK_ENRICH_MAX_URLS_PER_ITEM` | 任意 | 1記事あたりで新規取得する URL 上限（既定: 3） |
| `LINK_ENRICH_MAX_LINKS_PER_ITEM` | 任意 | `raw.enrichment.linkContents[]` に保持する最大件数（既定: 20） |
| `LINK_ENRICH_TIMEOUT_MS` | 任意 | URL 取得タイムアウト（既定: 8000ms） |
| `LINK_ENRICH_MAX_RETRIES` | 任意 | URL 取得リトライ回数（既定: 2） |
| `LINK_ENRICH_MAX_FETCH_CHARS` | 任意 | 取得 HTML の最大読み込み文字数（既定: 220000） |
| `LINK_ENRICH_MAX_TEXT_CHARS` | 任意 | 保存本文の最大文字数（既定: 8000） |
| `LINK_ENRICH_MAX_CLASSIFY_CONTEXT_CHARS` | 任意 | 分類向け抜粋の最大文字数（既定: 1000） |
| `NORMALIZE_LOOKBACK_DAYS` | 任意 | Step0 normalize の再走査窓（日数）。既定 `14`、`0` で全件バッチ走査 |
| `OPENROUTER_API_KEY` | Step1-3/Step4 LLM時必須 | OpenRouter API キー（`classify:pipeline:llm` / `step4:crosslink:llm` で使用） |
| `STEP4_CROSSLINK_LLM_MODEL` | 任意 | Step4 LLM モデル上書き（既定: `google/gemini-3.1-flash-lite-preview`） |
| `CROSSLINK_LLM_MODEL` | 任意 | `STEP4_CROSSLINK_LLM_MODEL` の旧互換エイリアス（優先度は下）。既定モデルは同じ |
| `CLASSIFY_MODEL` | 任意 | Step1-3 LLM モデル上書き（既定: `google/gemini-3.1-flash-lite-preview`） |
| `PROD_CLASSIFY_LIMIT` | 任意 | `collect:prod` 実行時の Step1-3 処理上限（既定: `600`） |
| `STEP4_CROSSLINK_LIMIT` | 任意 | `collect:prod` 実行時の Step4 処理上限（既定: `600`） |
| `STEP4_CROSSLINK_BATCH_SIZE` | 任意 | `collect:prod` 実行時の Step4 バッチサイズ（既定: `45`、許容範囲 `30`〜`150`。下限未満は既定値、上限超過は150へ clamp し warning） |
| `STEP4_LOOKBACK_HOURS` | 任意 | Step4 ローリング窓の長さ（既定: `48`） |
| `STEP_TOPIC_CLUSTER_ENABLED` | 任意 | `true` の時だけ Step4.5 Topic Cluster を有効化（既定: 無効） |
| `STEP_TOPIC_CLUSTER_COSINE_THRESHOLD` | 任意 | Topic Cluster の cosine 類似度閾値（既定: `0.84`） |
| `STEP_TOPIC_CLUSTER_MAX_ITEMS` | 任意 | Topic Cluster が1回に処理する対象件数の上限（既定: `2000`） |
| `STEP_HEADLINE_CLUSTER_BETA` | 任意 | Topic Cluster の headline score 係数（既定: `8`） |
| `STEP_HEADLINE_CLUSTER_GAMMA` | 任意 | 複数 platform の headline boost 係数（既定: `0.5`） |
| `STEP_EMBED_MODEL` | 任意 | Topic Cluster の embedding モデル（既定: `openai/text-embedding-3-small`） |
| `STEP_EMBED_ENDPOINT` | 任意 | embedding API endpoint（既定: `https://openrouter.ai/api/v1/embeddings`） |
| `STEP_EMBED_BATCH_SIZE` | 任意 | embedding API のバッチサイズ（既定: `64`） |
| `STEP_EMBED_MAX_RETRIES` | 任意 | embedding API の最大試行回数（既定: `3`） |
| `CROSSLINK_PUBLISHED_LOOKBACK_DAYS` | 任意 | ルールベース Step4 が既刊 binding を参照する期間（日数、既定: `90`） |
| `STEP6_VOICESIGNAL_LIMIT` | 任意 | `collect:prod` 実行時の Step6 処理上限（既定: `400`） |
| `STEP5_PUBLISH_LIMIT` | 任意 | `publish:prod` 実行時の Step5 処理上限（既定: `120`） |
| `STEP5_COMPOSE_MODE` | 任意 | Step5 組版方式。`script` のみ script mode、それ以外は `llm`（既定: `llm`） |
| `STEP5_COMPOSE_MODEL` | 任意 | `publish:prod` 後段の contentMd 組版モデル（既定: `google/gemini-3.1-flash-lite-preview`） |
| `STEP5_COMPOSE_MIN_ITEMS_PER_DENSE_SECTION` | 任意 | Step5 compose で「候補が十分あるセクション」に要求する最小掲載件数（既定: `3`） |
| `STEP5_COMPOSE_DENSE_SECTION_MIN_CANDIDATES` | 任意 | 高密度セクション扱いする候補件数の閾値（既定: `3`） |
| `STEP5_COMPOSE_DENSITY_RETRY_MAX` | 任意 | 密度不足時の再生成リトライ回数（既定: `1`、0で無効） |
| `STEP5_SCRIPT_MAX_PER_SECTION` | 任意 | script mode のセクション別掲載上限（既定: `0`＝上限なし） |
| `STEP5_SCRIPT_SUMMARY_MAX_CHARS` | 任意 | script mode の summary 最大文字数（既定: `220`） |
| `STEP_GITHUB_REPO_DEDUP_ENABLED` | 任意 | `true` の時だけ GitHub repo の重複抑制を有効化（既定: 無効） |
| `STEP_LOCALIZE_JA` | 任意 | `true` の時だけ組版で日本語ローカライズ結果を優先（既定: 無効） |
| `RETENTION_MODE` | 任意 | `dry-run` または `apply`。`publish:prod` 後段 retention の明示スイッチ。未設定/その他は skip |
| `RETENTION_RAW_DAYS` | 任意 | raw 7テーブルを `fetchedAt` で保持する日数（既定: `7`） |
| `RETENTION_PIPELINE_DAYS` | 任意 | `PipelineItem.createdAt` ベースの保持日数（既定: `30`、最小 `28`） |
| `RETENTION_OPS_DAYS` | 任意 | `PipelineRun` / `OrModelEvent` / crosslink LLM decision の保持日数（既定: `30`） |
| `PROD_DISCOVER_FETCH_LIMIT` | 任意 | `discover:prod` の Phase 2 プロフィール取得上限/日（既定: `20`） |
| `PROD_DISCOVER_EVAL_LIMIT` | 任意 | `discover:prod` の Phase 3 LLM 評価上限/日（既定: `20`） |
| `DISCOVER_EXTRACT_LOOKBACK_DAYS` | 任意 | Phase 1 の候補抽出・言及集計に使う直近期間（日数、既定: `7`） |
| `OPS_ALERT_WEBHOOK_URL` | 任意 | 運用アラート（cron 致命エラー・部分失敗・stale Run 検知）の送信先 webhook。未設定時は `SLACK_WEBHOOK_URL` に fallback、両方未設定なら通知なし（従来挙動） |
| `OPS_ALERT_FAILED_THRESHOLD` | 任意 | collect-cycle の per-item 失敗数がこの値を超えたらアラート（既定: `10`） |
| `HEARTBEAT_URL_COLLECT` | 任意 | collect-cycle が**アラート条件ゼロ**で完走した時だけ GET する deadman URL（healthchecks.io 等）。鳴らなくなったら異常。閾値以下の per-source エラーは抑止しない（summary JSON には出る）。dry-run では鳴らない |
| `HEARTBEAT_URL_STEP5` | 任意 | Step5（publish）が **edition を実際に生成**した時だけ GET する deadman URL。dry-run・空 publish では鳴らない |
| `SLACK_WEBHOOK_URL` | 任意 | Daily summary の投稿先。運用アラートでは `OPS_ALERT_WEBHOOK_URL` 未設定時の fallback にも使用 |
| `GITHUB_TOKEN` | 任意 | GitHub collector の API Bearer token。未設定時は匿名 API アクセス |
| `PROD_RUNTIME_TIMEZONE` | 任意 | prod ジョブのログ表示タイムゾーン（既定: `Asia/Tokyo`）。Railway cron の解釈は UTC のまま |

> Newsletter 系 BFF の API キー解決順序（server-side only）: `NEWSLETTER_API_KEY -> DIGEST_API_KEY -> FEED_API_KEY`

### Auth / API key fail-closed rules

- Auth.js env (`AUTH_SECRET`/`NEXTAUTH_SECRET`, `AUTH_GOOGLE_ID`/`GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_SECRET`/`GOOGLE_CLIENT_SECRET`) は本番で未設定なら module init 時点で throw する。開発では既存 fallback を維持し、欠落した env group 名をまとめた warning を1行だけ出す。例外: `next build` 中（`NEXT_PHASE=phase-production-build`）は NODE_ENV=production でも throw せず fallback+warning に留める（secrets なしのローカルビルドを維持。サーバ起動時の module init で必ず再評価される）。
- 管理者認可は、Google sign-in gate → middleware token gate → admin gate の順に同じ `ADMIN_EMAIL_ALLOWLIST` を適用する。さらに middleware の matcher 外にあるAPIは session callback がJWTのメールを再評価し、許可外なら既存のsession必須判定を401にする。未設定・空は全層でfail-close。許可判定にはGoogle profileの `email_verified === true` と、profile email／session user emailの正規化後一致も必要。
- allowlist未設定・空の起動警告は、`[auth-signin] ADMIN_EMAIL_ALLOWLIST is unset or empty; Google sign-in is denied for everyone (fail-close). Set ADMIN_EMAIL_ALLOWLIST to a comma-separated list of Google primary addresses.`。`next build` とtestでは出さず、サーバ起動時にモジュールごとに1行（Nodeランタイムとmiddleware bundleで最大2行）出す。
- sign-in拒否ログは `[auth-signin] deny provider=<provider|(none)> email=<masked> reason=<email_missing|email_unverified|email_mismatch|allowlist_unconfigured|allowlist_miss>`、session拒否ログは `[auth-session] deny email=<masked> reason=<allowlist_miss|allowlist_unconfigured>`。middleware拒否ログは従来どおり `[auth-admin] deny path=… email=<masked> reason=allowlist_miss_or_unconfigured` とする。生のメールアドレスは記録しない。
- allowlistからアドレスを削除した場合、sign-in gateへの反映は次回ログイン時で、発行済みJWT自体は `AUTH_SECRET`/`NEXTAUTH_SECRET` をローテーションするかNextAuth既定 `maxAge`（30日）が満了するまで有効。ただしmiddleware／session gateは各リクエストでallowlistを再評価するため、削除後の保護ページは次のアクセスから403、session必須APIは401になる。JWTそのものを即時失効させるにはsecretをローテーションする。
- `/calendar` の `/np-login` 共有パスワード経路はNextAuthの外側なので機能自体に変更はない。allowlist外のGoogleアカウントはGoogle経由では `/calendar` に入れないが、有効な共有クッキーは従来どおり利用できる。
- **デプロイ時は `AUTH_SECRET`/`NEXTAUTH_SECRET` の変更によるローテーションを同時に行うこと。** この変更以前に任意のGoogleアカウントへ発行されたsessionは、コードのデプロイだけでは失効しない。ローテーションは同じsecretでHMAC署名する `/calendar` 共有クッキー（`np_shared`）も無効化するため、共有パスワード利用者は `/np-login` から再ログインが必要（`/np-login` の機能自体は変わらない）。
- `/api/feed`, `/api/family-feed`, `/api/newsletter-editions/latest`, `/api/mcp/[transport]` は、**effective route key が未設定のまま本番に入ると 401 fail-close** する。レスポンスは `{"error":"api key not configured"}`。
- 同4 route は非本番では従来どおり open のままだが、auth が無効なことを module/process あたり 1 回だけ warning 出力する。

## ソース追加方法

### UI から

`/settings` → 対象タブ → フォームに入力

### API から

```bash
# Reddit subreddit を追加
curl -X POST https://<HOST>/api/reddit-sources \
  -H "Content-Type: application/json" \
  -d '{"name":"AI Video","subreddit":"aivideo","tags":["ai-video"]}'

# YouTube チャンネルを追加
curl -X POST https://<HOST>/api/alert-sources \
  -H "Content-Type: application/json" \
  -d '{"name":"YT: Luma AI","feedUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx","tags":["youtube"]}'

# Instagram アカウントを追加
curl -X POST https://<HOST>/api/ig-sources \
  -H "Content-Type: application/json" \
  -d '{"name":"OpenAI","handle":"openai","tags":["ai","official"]}'

# GitHub リポを追加
curl -X POST https://<HOST>/api/gh-sources \
  -H "Content-Type: application/json" \
  -d '{"name":"Hugging Face Transformers","type":"repo","repo":"huggingface/transformers","tags":["huggingface","transformers"]}'
```

## 自律ソース発見・信頼度

X の新ソースを毎日自動で発見・評価し、人間は**週に数分の承認だけ**でソース集合が育ち・代謝する仕組み。設計は複数の独立提案を相互レビューして統合し、自動承認を許さない運用モデルと、可逆的な降格ライフサイクルを安全レールとして採用している。

### 日次サイクル（`npm run discover:prod`、03:00 JST）

```
Phase 1  候補抽出      — 収集済みツイートから @メンション / x.com リンク / quote・RT 起点を集計
                         （資格ルール: 異なる2ツイート以上 or 2名以上の VIP が言及）
Phase 2  プロフィール取得 — ScrapeCreators で bio・フォロワー数・サンプル10ツイート（上限20件/日）
Phase 3  LLM 評価       — 1候補1コール・厳格JSON（上限20件/日）。score<45 は自動却下、
                         needs_review 昇格には「信頼できる言及者」との照合が必須。auto-approve は構造上不可能
Lifecycle 降格判定      — 下記参照
```

- 手動 dry-run: `railway run --service x-collector-cron -- npm run discover:prod -- --dry-run --skip-lifecycle`
- extract は直近 N 日窓（`DISCOVER_EXTRACT_LOOKBACK_DAYS`、既定7日）で言及を集計し、資格ルールも窓内の件数に適用する
- 各ステップは fail-open（1ステップの失敗で残りは止まらない）。ただし lifecycle 失敗のみ `critical_failed` + exit 1
- API 経由の単発実行: `POST /api/discover` に `{phase: "extract"|"fetch"|"evaluate"|"promote", dryRun?}`（要 studio セッション）

### ソース信頼度スコア（`source-score.ts`、collect cron 内で日次再計算）

- **0-100 スコア + ラベル**（high ≥75 / medium 50-74 / low <50 / unknown / blocked）。LLM 不使用の純集計で追加コスト≈ゼロ
- 重み: アイテム品質 45% / 選定価値 25%（**システム中央値との相対評価** — 採用率~1%が基準値の世界なので、採用ゼロ単独ではペナルティにならない）/ 発見時prior 15%（実績が貯まるほど減衰）/ 鮮度 5%（裏取り10%は未実装のため外して再正規化）
- コールドスタート: 28日窓の分類 <15件 or 稼働 <14日 → `unknown` ラベルがスコアに優先。**消費側は必ずラベルで判定**（スコアで WHERE しない）
- 新聞への反映（compose-edition）: ランキング乗数 high ×1.08 / medium ×1.0 / unknown ×0.95 / low ×0.8 / **blocked は紙面除外**。unknown/low の X 記事には紙面に「未検証・単一ソース」「低信頼」バッジを表示（ハイブリッド真偽性: 排除ではなく可視化）
- 分布確認: `railway run --service x-collector-cron -- npx ts-node src/scripts/trust-score-dry-run.ts`（read-only）

### 降格ライフサイクル（自動停止の安全レール）

- 対象は **`type="discovered"`（自動発見由来）のみ**。手動登録・VIP ソースは絶対に自動停止されない（推奨表示のみ）
- 条件（全て必須）: 稼働≥14日 かつ 分類≥20件、かつ（noise率が中央値+15pt以上 or priority最下位decile or trustScore<45）
- **2週連続ゲート**: 初回該当は `demote` 監査イベントの記録のみ（状態変更なし）→ 6-8日後も該当が続いた場合のみ deactivate（`active=false` + 理由 + クールダウン30日）
- noise ≥85% の深刻ケースのみ `blocked` ラベル付与。**ハード削除は存在しない**。全アクションは `SourceDemotionEvent` に metricsSnapshot 付きで記録（SQL で監査可能）
- 復活: 週次レビュー画面からワンクリック（discovered かつ lifecycle 停止済みの行のみ復活可能・30日グレース付与）

### 週次レビュー（人間の唯一の定常作業）

`/settings?tab=candidates` → **Weekly Review**:

1. `needs_review` 候補が最大10件（aiScore 順・埋め合わせなし・10未満で正常）— Approve / Reject をポチポチ
2. 不健康ソースが最大5件（降格フラグ・自動停止済み）— 理由を見て必要なら Restore
3. Approve した候補は `POST /api/discover {phase:"promote"}` 相当の Phase 4 で `Source` 化され、次回 collect から自動収集に合流

## Daily Digest（自動デイリーニュース）

- **スケジュール**: 毎日 19:00 TH（Asia/Bangkok）
- **実行環境**: スケジュール実行される分離ジョブ
- **投稿先**: Slack `#daily-digest`
- **フロー**: Feed API から直近24h取得 → AI 精査 → 5-8件厳選 → Slack 投稿
- **広範囲取得の注意**: 最大7日間の指定でも engagement 順位は各 source query の最新2,000件内だけで比較されるため、信頼できる「週トップ」を得るには範囲を狭めて取得する
- **バリデーション**:
  - メンション: `<@U...>` 形式必須（テキスト `@名前` は NG → 再生成）
  - タイムゾーン: TH/ICT/Asia/Bangkok 必須
  - フッター: 「母数」「除外」両方必須
  - NG 時は投稿せず再生成 → 全通過で投稿

## 運用状況

収集規模: 約 1,000〜10,000 件/サイクル（X ハンドル拡充後）。記事は script モードで日次最大 300 件掲載。

### ソース数（2026-03-06 時点のスナップショット）

| Platform | ソース数 | 蓄積件数 |
|----------|---------|---------|
| 𝕏 Twitter | 36 VIPハンドル → 124 に拡充（2026-06） | 66+ |
| 📸 Instagram | 0（未稼働） | — |
| 📘 Facebook | 49 グループ | 1,841 |
| 🟠 Reddit | 22 subreddit | 1,573 |
| 📝 Qiita | 44 タグ | 1,893 |
| 🐙 GitHub | 34 リポ/クエリ | 1,188 |
| 📰 Alerts/RSS/YouTube | 57 フィード | 500+ |
| **合計** | **242+** | **7,000+** |

## 媒体別の役割マッピング

- **X/IG**: 情報の"浸透度"センサー（海外→日本の受容度）
- **Reddit/Qiita**: 技術の"深掘り"レイヤー（実装・検証・比較）
- **Gizmodo/RSS/YouTube**: ニュースの"速報"レイヤー
- **Facebook**: 独自情報のみ厳選（ノイズ比率が最も高い）
- **GitHub**: コードベース変化追跡（リリースノート・差分）

## 既知の follow-up（未着手）

- **Step4 fallback の sticky 化**: バッチ失敗時の fallback 決定が `completed` で永続するため、`pendingOnly` 運用では transient 失敗を自動再試行しない（`--include-completed` か status 設計の見直しが必要）。
- **重複クラスタ昇格ロジックの再設計**: 現 dedup は完全一致のみ（~0.8%、最大クラスタ4件）。話題レベルの意味的クラスタリング + 異なるソース数（ソース多様性）による重要度ブーストを検討中。
