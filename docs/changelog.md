# 変更履歴（Changelog）

README から移設した改修履歴。最新の開発ステータスは [エンジニア向けドキュメントの開発状況](engineering.ja.md#development-status) を参照。

## Unreleased

- 同日の `publish` 再実行を冪等化（#108）。published 済み edition への再実行は no-op、`--allow-append` で明示追記。
- `/a/` 記事向けの `robots.txt` と `sitemap.xml` を追加（#107）。`NEWSPAPER_PUBLIC` と site origin の両方が揃う時だけ公開エントリを出す。直近 7 日分・既存 loader 経由。robots は `/a/`・`/calendar`・`/sitemap.xml`・`/og-default.png` を許可、sitemap は 1 リクエスト 5 秒予算。
- 全角 `引用元：` を引用元マーカーとして受理（#106）。半角の記事 ID は不変。

## v0.4.0 — 2026-09-05

- 公開済み記事の `/a/<date>/<id>` ランディングページ、記事別共有リンク、AI メニュー、OG メタデータと既定画像を追加。
- 公開記事は GET/HEAD のみ。IP ごと 240件/60秒を超えると `Retry-After: 60` 付き 429、取得待ちの容量・時間超過は 500（load-shed）となる。
- 非公開の号は全 caller に 404、未知の記事 ID は当日の紙面へ 307。origin 未設定時は noindex とし、絶対 URL を出力しない。

### Behaviour change

- `STEP5_COMPOSE_MODE` 未設定時の既定を `llm` から `script` に変更。明示設定済みの環境には影響しない。

## 2026-07-21

| 内容 |
|---|
| read-only Streamable HTTP MCP サーバーを追加。既存 `/api/family-feed` と `/api/newsletter-editions/latest` を `search_feed` / `get_daily_news` として薄く公開し、MCP 専用 Bearer gate と honest cursor の利用契約を文書化 |

## 2026-07 後半（Phase 5: 自律ソース取得・真偽性）

| 内容 |
|---|
| 無認証スタジオ API のセキュリティ修正（本番 401 実測確認）と、追加のハードニング作業 |
| UI 全面リニューアル（WIRED スタイル採択） |
| OG サムネイル BFF。多層レビューで pinned-lookup バグ + CRITICAL SSRF（mapped-IPv6）を捕捉し ipaddr.js で根治。追加のハードニングも実施 |
| ソース信頼度スコア: 中央値相対の日次純集計（LLM 不使用）+ `Source` trust 列 + `SourceDemotionEvent` 監査テーブル。「採用ゼロは単独ペナルティにしない」相対評価を複数の独立提案のレビューで確認 |
| X 内発見経路の拡張: @メンションに加え x.com ステータスリンク・quote/RT 起点を抽出。count=「言及した異なるツイート数」の意味論を厳守（1ツイート内で複数経路が重複計上されるバグをレビューで捕捉・修正） |
| Phase 3 評価脳: 候補アカウントを1件1 LLM コール・厳格 JSON で採点（上限20件/日）。厳格ラダー（<45 自動却下 / needs_review 昇格は信頼言及者との照合必須 / auto-approve は構造的に不可能） |
| 信頼度を新聞選定に反映: ランキング乗数（high +8% 〜 low -20%・blocked 除外）+ 紙面の「未検証/低信頼」バッジ（ハイブリッド真偽性=排除でなく可視化）。バッジは引用元 URL 厳密一致のみ |
| 自律運転の配線: 日次発見サイクル `discover:prod`（03:00 JST）+ 降格ライフサイクル（discovered 限定・2週連続ゲート・ハード削除なし・全アクション監査イベント）+ 週次レビュー UI（承認/却下/ワンクリック復活） |

この機能群は、曖昧度ゲート付きの要件収束、複数モデルの独立提案、相互クロスレビュー、統合設計の順で設計した。初回本実行は候補470件を発見し、評価スコアは ollama 95 / google 85 / スパム 15 と妥当に弁別した（2026-07-10）。

## 2026-07（Phase 4 前半）

| 内容 |
|---|
| Step5 compose の Prisma 書込みクラッシュ修正（サロゲート安全な切り詰め + `sanitizeToWellFormed()`）。絵文字切断による ill-formed UTF-16 が原因で edition が空になる問題を根治 |
| `/api/family-feed` にエージェント検索パラメータ追加: `tags`（primary/sub/action 横断OR）/ `keywords`（大文字小文字無視）/ `since` + `meta.nextSince`・`meta.truncated`（honest cursor: 切詰め時も返却済みページまでカーソルを前進）。`FAMILY_FEED_API_KEY` を本番有効化。ガイド: `docs/agent-feed.md` |
| タクソノミー v2: AGENT（AGENT_DEV/AGENT_OPS/MULTI_AGENT）・RESEARCH（PAPER/BENCH）を primary 昇格、TECH は実装術に限定（+RAG_SEARCH）、MCP_API にサブ追加（MCP/SDK_API）、OTHER 最終手段化。紙面 13 セクション化 + 見出し連番化。JA要約プロンプト v2。promptVersion bump で旧分類は cron が自動再分類。初日実測: TECH 48.6%→25%、OTHER 9.5%→0.7% |
| cron entrypoint に explicit exit(0)（stdout drain + failsafe timer）。成功後にプロセスが exit せずコンテナ残存 → Railway cron が後続発火をスキップする事故（2026-07-05/06 に約25h の収集欠落）を根治 |

運用イベント: OpenRouter クレジット枯渇による停止（07-04、チャージで復旧）/ step5-cron の auto-deploy トリガー欠落を修理（07-05）/ 07-05 紙面は backfill 後に再製本して完全版（307記事）。

## 2026-06

「1日1000件以上収集しているのに記事が10件弱しか出ない」問題の根本対応として、本番DB実測ベースで以下を順次実施（すべて Issue 起点 + PR レビュー済み）:

| 内容 |
|---|
| Step4 を当日カレンダー窓 → ローリング窓（既定48h）。00:00 JST 実行が14件しか処理しない問題を解消 |
| Step6 市場の声を edition に紐付け（早期 draft 作成 + orphan backfill）。全号 0 件だった市場の声が掲載されるように |
| Reddit 収集を死んだ old.reddit JSON（2026-05-28 に 403 化）→ ScrapeCreators API へ移行 |
| X VIP ハンドルを 56 → 124 に拡充（idempotent import スクリプト + `data/x-handles.json`、カテゴリタグ付き） |
| Step4 LLM バッチの出力截断バグ修正。batch 120→45 + max_tokens 動的化。silent fallback で headlineScore が常に 0 になっていた問題を解消（headline 復活） |

加えて Step5 compose を **script モード**（`STEP5_COMPOSE_MODE=script`）に切り替え、掲載上限を 120→300（`STEP5_PUBLISH_LIMIT`）に引き上げ。
