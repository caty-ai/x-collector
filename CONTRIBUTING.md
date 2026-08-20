# Contributing Guide

**English** | [日本語](#日本語)

Thank you for your interest in contributing to this project. Please follow the workflow below.

## Prerequisites

- Node.js 20 or newer (npm included) — push-to-main CI pins Node 20 while the pull-request gate uses the runner default Node.js
- GNU Make — `make test` / `make lint` are the unified entry points
- git

PostgreSQL and API credentials are only needed to run the app or collectors; `npm ci && make test` needs none of them.

## Development workflow (Issue-First)

1. **Open an issue** — All work starts with a GitHub Issue. Include the following in its description.
   - **Why**: Why this change is needed
   - **Done when**: What must be achieved for the work to be considered complete (acceptance criteria)
   - **Expected files to touch**: A list of files and modules likely to change
2. **Check for duplicates** — Before starting, use `gh issue list` / `gh pr list` to check for other work touching the same area. If the sets of files overlap, proceed sequentially.
3. **Create a branch** — Do not commit directly to `main`. `main` is for merges only.
   - Naming examples: `feat/<issue-number>-<short-description>`, `fix/<issue-number>-<short-description>`, `docs/<short-description>`
4. **Implementation & verification** — After making changes, run `npm run build` and `npm test` (Vitest). `make test` / `make lint` are the unified entry points added by #36. If you touch the pipeline, also verify its behavior with `--dry-run` ([verification command examples](docs/operations.md#production-ジョブcron-用)).
5. **Open a PR** — In the description, include the issue number (`Closes #NN`) and a **list of files touched**.
6. **Merge** — After the review passes, `fetch → rebase → re-verify`, then merge PRs one at a time.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/).

```
feat: add agent search params to family-feed API
fix: ensure the cron entrypoint exits cleanly
docs: restructure README for public release
```

- Prefix: `feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- Include `(#NN)` when there is a corresponding issue

## Code style

- TypeScript / Next.js 14 App Router / Prisma
- Follow the existing code style (naming, comment density, and error handling)
- For changes that affect production behavior, verify their effect using measurements from the production database before documenting the results in the PR

## Contributing community sources

When proposing a public X source for the community list, consult the [Community sources guide](docs/community-sources.md) for the schema, helper, manual PR procedure, and persistence caveats. Adding a source to the list alone does not subscribe to it.

## Questions and suggestions

Please use [Issues](../../issues) for bug reports and feature requests.

## 日本語

このプロジェクトへのコントリビュートに興味を持っていただきありがとうございます。以下のフローに沿って進めてください。

### 前提ツール

- Node.js 20 以降（npm を含む）— main への push 用 CI は Node 20 を固定し、pull request のゲートはランナー既定の Node.js を使います
- GNU Make — `make test` / `make lint` が統一エントリーポイントです
- git

PostgreSQL と API 認証情報はアプリまたはコレクターを実行する場合にのみ必要です。`npm ci && make test` にはどちらも必要ありません。

### 開発フロー（Issue-First）

1. **Issue を立てる** — 作業はすべて GitHub Issue 起点です。本文には以下を含めてください。
   - **Why**: なぜこの変更が必要か
   - **Done when**: 何ができたら完了か（受け入れ条件）
   - **触るファイル予測**: 変更しそうなファイル・モジュールの一覧
2. **重複確認** — 着手前に `gh issue list` / `gh pr list` で同じ領域を触る作業がないか確認してください。ファイル集合が交差する場合は直列で進めます。
3. **ブランチを切る** — `main` へ直接コミットしないでください。`main` はマージ専用です。
   - 命名例: `feat/<issue番号>-<短い説明>`、`fix/<issue番号>-<短い説明>`、`docs/<短い説明>`
4. **実装 + 検証** — 変更後は `npm run build` と、パイプラインに触れる場合は `--dry-run` での動作確認を行ってください（[検証コマンド例](docs/operations.md#production-ジョブcron-用)）。`npm test`（Vitest）も実行してください。`make test` / `make lint` は #36 で追加された統一エントリーポイントです。
5. **PR を出す** — 本文に Issue 番号（`Closes #NN`）と**触ったファイル一覧**を記載してください。
6. **マージ** — レビュー通過後、`fetch → rebase → 再検証` してから 1 本ずつマージします。

### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に準拠します。

```
feat: add agent search params to family-feed API
fix: ensure the cron entrypoint exits cleanly
docs: restructure README for public release
```

- prefix: `feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- 対応 Issue がある場合は `(#NN)` を含める

### コードスタイル

- TypeScript / Next.js 14 App Router / Prisma
- 既存コードのスタイル（命名・コメント密度・エラーハンドリング）に合わせてください
- 本番挙動に影響する変更は、本番 DB 実測ベースで効果を確認してから PR に記載してください

### コミュニティソースへの貢献

公開 X ソースをコミュニティ一覧へ提案する場合は、スキーマ、ヘルパー、手動 PR 手順、永続性の注意事項を [Community sources guide](docs/community-sources.md) で確認してください。一覧への掲載だけでは購読されません。

### 質問・提案

バグ報告・機能提案は [Issues](../../issues) へお願いします。
