# X Collector — 詳細仕様

[← 玄関ページへ戻る](../README.ja.md) ｜ 🔧 [エンジニア向けドキュメント](engineering.ja.md)

このページは正確な仕様への入口です。領域ごとに正本ドキュメントが分かれており、どれが何の正本かをこの索引で示します。

---

## 仕様索引

| 領域 | 正本ドキュメント | 言語 |
|---|---|---|
| 環境変数（全リスト） | [operations.md — 環境変数全リファレンス](operations.md#環境変数全リファレンス) | 日本語 |
| Feed APIとアプリケーションAPI | [api.md](api.md) | 日本語 |
| UI APIコントラクト（v1） | [api-contract-ui-v1.md](api-contract-ui-v1.md) | 日本語 |
| エージェント向けFeed：差分検索の契約 | [agent-feed.md](agent-feed.md) | 英語 |
| MCPサーバー：エンドポイント・認証・ツール | [mcp-server.md](mcp-server.md) | 英語 |
| Family Feed API | [family-feed-api.md](family-feed-api.md) | 日本語 |
| パイプライン処理・分類体系・データモデル | [v2-design.md](v2-design.md) | 日本語 |
| デザインシステム（WIREDインスパイアの編集言語） | [DESIGN.md](DESIGN.md) | 英語 |
| LLMプロンプト（実行時読込・移動禁止） | [prompts/](prompts/) | — |
| 本番ジョブ・cron・データ保持・情報源ライフサイクル | [operations.md](operations.md) | 日本語 |
| Step4 クロスリンクの手動実行 runbook | [step4-crosslink-llm-manual-runbook.md](step4-crosslink-llm-manual-runbook.md) | 日本語 |
| 変更履歴 | [changelog.md](changelog.md) | 日本語 |

---

## 主要な契約の早見表

連携時によく参照するルールの要約です。上の正本ドキュメントと食い違う場合は、正本が優先します。

- **Newsletter BFFのキー解決順** — サーバーサイドのルートは `NEWSLETTER_API_KEY` → `DIGEST_API_KEY` → `FEED_API_KEY` の順でAPIキーを解決します
- **MCPのゲート** — `MCP_API_KEY` が未設定なら `FAMILY_FEED_API_KEY` にフォールバック。両方未設定のときはオープンな開発モードで動作します
- **管理ルートはfail-close** — `ADMIN_EMAIL_ALLOWLIST` が未設定の場合、`/admin` と `/api/admin/**` は403を返します
- **既定のLLMモデル** — 分類・クロスリンク・紙面生成はいずれもOpenRouter経由の `google/gemini-3.1-flash-lite-preview` が既定です
- **MCPエンドポイント** — `/api/mcp/mcp` のread-only Streamable HTTPで、`search_feed` と `get_daily_news` を提供します
