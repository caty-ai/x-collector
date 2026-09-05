# Supporter Reward Loop — 入口 / entry page

x-collector を応援してくれた人（Star・Issue / Discussions 投稿・PR マージ）に、人手を介さずお礼と特典が届く仕組みの設計文書です。
This folder holds the design documents for the loop that thanks and rewards x-collector supporters without a human in the loop.

| 文書 / document | 中身 / what it is |
|---|---|
| [CONTRACT.md](CONTRACT.md) | **契約（`epic/119` へのマージをもって凍結・それまでは freeze candidate）** — 3段の定義・再利用ワークフローの入力と secret 名・NDJSON 元帳スキーマ・トークンの最小権限・record-only の証明条件。ここに書いてある面は契約 Issue を立てずに変えない / the frozen interfaces every implementation child depends on |
| EPIC caty-ai/x-collector#119 | なぜやるか・人間チェックポイント表・子 Issue 一覧 / why, human checkpoints, child issues |

## 3行で / in three lines

1. **Star → 特典リポ（private）への招待**、Issue/Discussions → **お礼コメント**、PR マージ → **Contributors 壁とリリースノート記名**。累積で上がり、下がらない。
2. 最初は **record-only**（何をするつもりだったかを元帳に書くだけ・外部に一切送らない）で動かし、オーナーの承認コメント後にだけ **live** に切り替える。
3. 長期の認証情報は **1本だけ**（`SUPPORTER_LOOP_TOKEN`・特典リポにしか届かない）。お礼コメントは呼び出し元リポの `GITHUB_TOKEN` で出す。

## 置き場 / where things live

| 役割 | リポ | パス |
|---|---|---|
| 呼び出し元（数行） | `caty-ai/x-collector` | `.github/workflows/supporter-loop.yml` |
| 仕組み本体（再利用ワークフロー） | `caty-ai/.github` | `.github/workflows/supporter-loop-reusable.yml` |
| 特典・元帳・Supporters 一覧 | `caty-ai/ask-ai-widget`（private） | `ledger/`・`SUPPORTERS.md`・`assets/badges/` |

質問や提案は EPIC #119 か、このフォルダを触る子 Issue へ。
Questions and proposals go to EPIC #119 or the child issue that owns the file.
