# Contributing Guide

このプロジェクトへのコントリビュートに興味を持っていただきありがとうございます。以下のフローに沿って進めてください。

## 開発フロー（Issue-First）

1. **Issue を立てる** — 作業はすべて GitHub Issue 起点です。本文には以下を含めてください。
   - **Why**: なぜこの変更が必要か
   - **Done when**: 何ができたら完了か（受け入れ条件）
   - **触るファイル予測**: 変更しそうなファイル・モジュールの一覧
2. **重複確認** — 着手前に `gh issue list` / `gh pr list` で同じ領域を触る作業がないか確認してください。ファイル集合が交差する場合は直列で進めます。
3. **ブランチを切る** — `main` へ直接コミットしないでください。`main` はマージ専用です。
   - 命名例: `feat/<issue番号>-<短い説明>`、`fix/<issue番号>-<短い説明>`、`docs/<短い説明>`
4. **実装 + 検証** — 変更後は `npm run build` と、パイプラインに触れる場合は `--dry-run` での動作確認を行ってください（[検証コマンド例](docs/operations.md#production-ジョブcron-用)）。
5. **PR を出す** — 本文に Issue 番号（`Closes #NN`）と**触ったファイル一覧**を記載してください。
6. **マージ** — レビュー通過後、`fetch → rebase → 再検証` してから 1 本ずつマージします。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に準拠します。

```
feat: add agent search params to family-feed API
fix: ensure the cron entrypoint exits cleanly
docs: restructure README for public release
```

- prefix: `feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- 対応 Issue がある場合は `(#NN)` を含める

## コードスタイル

- TypeScript / Next.js 14 App Router / Prisma
- 既存コードのスタイル（命名・コメント密度・エラーハンドリング）に合わせてください
- 本番挙動に影響する変更は、本番 DB 実測ベースで効果を確認してから PR に記載してください

## コミュニティソースへの貢献

公開 X ソースをコミュニティ一覧へ提案する場合は、スキーマ、ヘルパー、手動 PR 手順、永続性の注意事項を [Community sources guide](docs/community-sources.md) で確認してください。一覧への掲載だけでは購読されません。

## 質問・提案

バグ報告・機能提案は [Issues](../../issues) へお願いします。
