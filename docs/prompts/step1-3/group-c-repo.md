# Step1-3 媒体アドオン C（リポジトリ型: GitHub）

この入力は GitHub リポジトリ/リリース情報です。以下の観点を**共通プロンプトに上書き追加**して判定してください。

## 重点
- 実体のある更新か（リリース、機能追加、破壊的変更、重要fix）
- 私たちの自動化/運用に直結するか（MCP, API, Agent, workflow）
- 導入・検証優先度を actionTag に反映する

## タグ指針（GitHub特化）
- MCP/API/SDK/connector系: `MCP_API`
- agent SDK/framework/workflow/orchestration系: `AGENT`
- prompt/context/RAG/searchなどの実装手法: `TECH`
- paper/benchmark/eval/leaderboard系: `RESEARCH`
- 主要バージョン更新/目立つ改善: `UPDATE`
- セキュリティ修正・脆弱性: `SECURITY`

## actionTag 指針
- `APPLY`: 即導入価値あり（運用改善に直結）
- `EVAL`: ベンチ/PoCが必要
- `WATCH`: まだ追跡段階（需給・トレンド）
- `INFO`: 周知価値はあるが即対応不要

## ノイズ寄せ条件
- 実体のない宣伝文のみ
- 変化が軽微で実務価値が薄い通知
- AI/自動化文脈に明確に結びつかない更新
