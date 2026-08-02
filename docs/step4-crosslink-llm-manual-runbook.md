# Step4 LLM Crosslink — Manual Runbook

Last updated: 2026-03-09

## 目的

Step4（LLM crosslink）を**cronなし手動実行**で回すための運用手順。
最新方針に合わせて、実行順序は以下を推奨:

1. Step4: `step4:crosslink:llm`
2. Step6: `voicesignal:pipeline`
3. Step5: `publish:pipeline`

---

## 実装ポイント

- **JST日次窓**で対象抽出（00:00-23:59）
  - `publishedAt` を優先
  - 欠損時のみ `ingestedAt` → `createdAt` をフォールバック
- **ルール事前圧縮**
  - ノイズ除外
  - URL/タイトル類似でDUP候補をクラスタ化
  - クラスタ代表のみLLM送信（非代表はルールでDUP補完）
- **LLM入力粒度（medium）**
  - `title + shortSummary + tags + platform + keyLinks`
- **バッチ実行**
  - 既定: 45件（30〜150にクランプ）
- **保存先（専用）**
  - `pipeline_crosslink_llm_decisions`
  - 既存の `pipeline_classifications` / `pipeline_links` も更新
- 既存の `crosslink:pipeline`（rule-based）はそのまま維持（非破壊）

---

## 必須/推奨環境変数

| 変数 | 必須 | 例 | 用途 |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Step4 LLM時必須 | `sk-or-...` | OpenRouter呼び出し |
| `STEP4_CROSSLINK_LLM_MODEL` | 任意 | `google/gemini-3.1-flash-lite-preview` | デフォルトモデル上書き |

---

## コマンド例

### 1) ドライラン（最初に必ず）

```bash
npm run step4:crosslink:llm -- --dry-run --date-jst=2026-03-09 --batch-size=45
```

### 2) 本実行

```bash
npm run step4:crosslink:llm -- --date-jst=2026-03-09 --batch-size=45
```

### 3) 再評価（既存結果も再処理）

```bash
npm run step4:crosslink:llm -- --date-jst=2026-03-09 --include-completed
```

### 4) 小さく検証（モデル/件数調整）

```bash
npm run step4:crosslink:llm -- --dry-run --date-jst=2026-03-09 --limit=150 --batch-size=100 --max-batches=1
```

---

## 主なCLIオプション

- `--date-jst=YYYY-MM-DD` : 対象JST日
- `--dry-run` : DB更新なし
- `--limit=<n>` : 対象上限
- `--platform=reddit,qiita,...` : 媒体絞り込み
- `--batch-size=<n>` : LLMバッチ件数（30〜150）
- `--model=<openrouter-model>` : 実行時モデル指定
- `--max-retries=<n>` : LLMリトライ
- `--max-output-tokens=<n>` : 出力トークン上限
- `--max-summary-chars=<n>` : shortSummary文字数
- `--max-batches=<n>` : バッチ数上限（検証向け）
- `--include-completed` : 同一inputHashスキップを無効化

---

## 進捗ログの見方

- `[step4-llm] selected=...` : ノイズ除外後の件数
- `[step4-llm] prefilter clusters=... pruned=...` : ルール圧縮結果
- `[step4-llm] LLM batch x/y ...` : LLMバッチ進行
- `persisted n/m changed items` : DB反映進捗

---

## 失敗時の確認順

1. `OPENROUTER_API_KEY` がセットされているか
2. 指定モデル名がOpenRouterで有効か
3. `--batch-size` を下げる（例: 45 → 30）
4. `--max-batches=1` で最小再現
5. `--dry-run` で再確認
