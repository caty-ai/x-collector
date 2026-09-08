# Supporter Reward Loop — 入口 / entry page

x-collector を応援してくれた人（Star・Issue / Discussions 投稿・PR マージ）に、人手を介さずお礼と特典が届く仕組みの設計文書です。
This folder holds the design documents for the loop that thanks and rewards x-collector supporters without a human in the loop.

| 文書 / document | 中身 / what it is |
|---|---|
| [CONTRACT.md](CONTRACT.md) | **契約 v2.0（`contract_version` 2・凍結済み）** — 3段の定義・再利用ワークフローの入力と secret 名・NDJSON 元帳スキーマ・トークンの最小権限・record-only の証明条件・**§16 容量（上限と警報・1日45件の招待キュー・X ローンチ時のオーナー運用ルール）**。ここに書いてある面は契約 Issue を立てずに変えない / the frozen interfaces every implementation child depends on, plus the capacity section (§16) added by v2.0 for the X launch |
| EPIC caty-ai/x-collector#119 | なぜやるか・人間チェックポイント表・子 Issue 一覧 / why, human checkpoints, child issues |
| caty-ai/x-collector#142 · caty-ai/.github#91 · caty-ai/x-collector#143 | v2.0 の実装レーン: 契約本文 (A)・中央ワークフロー (B)・警報発火待ちの backlog (E) / the v2.0 lanes: contract text, central workflow, alarm-triggered backlog |

## 3行で / in three lines

1. **Star → 特典リポ（private）への招待**、Issue/Discussions → **お礼コメント**、PR マージ → **Contributors 壁とリリースノート記名**。累積で上がり、下がらない。
2. 最初は **record-only**（何をするつもりだったかを元帳に書くだけ・外部に一切送らない）で動かし、オーナーの承認コメント後にだけ **live** に切り替える。
3. 長期の認証情報は **用途別に2本**（`SUPPORTER_LEDGER_TOKEN` = 元帳の読み書きだけ・record-only で使うのはこれだけ / `SUPPORTER_LOOP_TOKEN` = 招待と解除だけ・live の `act` job でしか読まれない）。どちらも特典リポにしか届かない。お礼コメントは呼び出し元リポの `GITHUB_TOKEN` で出す。
4. **v2.0（X ローンチ前のスケール対応）**: Star が一気に来ても取りこぼさない — イベント run は速達、**1日2回の sweep が正**（Star に割り込まれない専用レーン・未配達の特典を後追い配達・GitHub の招待上限 50件/24h に合わせて 1日45件のキュー）。上限や警報の数字は CONTRACT.md §16 / v2.0 for the X launch: event runs are the fast path, the twice-daily sweep is the truth (its own lane, standing catch-up, a 45-per-day invitation queue under GitHub's 50-per-24 h cap); numbers in CONTRACT.md §16.

## 置き場 / where things live

| 役割 | リポ | パス |
|---|---|---|
| 呼び出し元（数行） | `caty-ai/x-collector` | `.github/workflows/supporter-loop.yml` |
| 仕組み本体（再利用ワークフロー） | `caty-ai/.github` | `.github/workflows/supporter-loop-reusable.yml` |
| 特典・元帳・Supporters 一覧 | `caty-ai/ask-ai-widget`（private） | `ledger/`・`SUPPORTERS.md`・`assets/badges/` |

質問や提案は EPIC #119 か、このフォルダを触る子 Issue へ。
Questions and proposals go to EPIC #119 or the child issue that owns the file.
