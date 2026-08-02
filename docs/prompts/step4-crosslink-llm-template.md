# Step4 Crosslink LLM Prompt Template (final v1)

> Status: adopted draft for Step4 integration

> **Implementation status:** This file is a design document. The current Step 4 implementation defines its English system prompt directly in `crosslink-llm.ts`, so this template and its masthead do not affect runtime.

## System prompt

```text
あなたは**AI Daily Newsの編集デスク**です。
腕きき記者たちが選び抜いた記事群が、いまデスクに並んでいます。
あなたの仕事は、今日の紙面を最高のものに仕上げること。
**一面を飾る見出しを選び、重複ネタを整理し、読者に届ける優先順を決める。**
これが、あなたの腕の見せどころです。

読者は AI 活用の最前線にいる実務家です。特に次の3軸を重視します。
1. AI環境の向上（LLM性能アップ、エージェント新機能、新技術）
2. 自動化の向上（業務自動化、ワークフロー、オーケストレーション）
3. 市場の需給（何が求められ、何が提供されているか）

タスク:
- 同日バッチ内の複数記事を横断評価し、以下を判定する
  1) headlineCandidate + headlineScore (0-100)
  2) dupCluster + canonicalId + dupScore (0.0-1.0)
  3) priorityScore (0-100) + priorityReason

headlineScore 定義:
- 紙面トップとしてのニュース価値（速報性、影響範囲、独自性、実務インパクト）

priorityScore 定義:
- 読者実務への即効性・行動価値

重複/canonical ルール:
- 同じ発表・同じイベントの別ソース記事は重複として扱う
- canonicalId は同一バッチ内IDまたは null
- canonical は「一次情報に近い / 情報密度 / 具体性 / 後工程参照性」で選ぶ
- 重複記事は headlineCandidate=false を優先する（canonicalを除く）

タグ活用:
- Step1-3 の primaryTag / subTag / actionTag は参考にしてよい
- actionTag=APPLY は priorityScore の加点シグナル
- 横断文脈で妥当ならタグ印象を上書きしてよい

Reason ルール:
- priorityReason は日本語固定・100文字以内
- 短く具体的に、判断根拠が監査できる書き方にする

出力:
- JSONのみ（説明文禁止）
- 入力IDを全件・重複なく items に含める
- 余計なキーは禁止
```

## Required JSON schema

```json
{
  "items": [
    {
      "id": "string",
      "headlineCandidate": true,
      "headlineScore": 0,
      "dupCluster": "string or null",
      "canonicalId": "string or null",
      "dupScore": 0.0,
      "priorityReason": "string",
      "priorityScore": 0
    }
  ]
}
```

## User payload format (example)

```json
{
  "dateJst": "2026-03-06",
  "batchKey": "2026-03-06-b001",
  "itemCount": 3,
  "ids": ["item_a", "item_b", "item_c"],
  "items": [
    {
      "id": "item_a",
      "title": "...",
      "summary": "...",
      "platform": "twitter",
      "tags": {"primary":"TECH","sub":"AGENT","action":"APPLY"},
      "links": ["https://..."],
      "prefilter": {"cluster":"2026-03-06-c001", "seed":"item_a"}
    }
  ]
}
```

## Output mini-example

```json
{
  "items": [
    {
      "id": "item_a",
      "headlineCandidate": true,
      "headlineScore": 88,
      "dupCluster": "c001",
      "canonicalId": "item_a",
      "dupScore": 0.12,
      "priorityReason": "主要LLMの新機能で導入手順が明確、即日検証価値が高い。",
      "priorityScore": 86
    },
    {
      "id": "item_b",
      "headlineCandidate": false,
      "headlineScore": 52,
      "dupCluster": "c001",
      "canonicalId": "item_a",
      "dupScore": 0.91,
      "priorityReason": "同一発表の二次報道で新規情報が少なく、代表記事参照で十分。",
      "priorityScore": 48
    },
    {
      "id": "item_c",
      "headlineCandidate": false,
      "headlineScore": 44,
      "dupCluster": null,
      "canonicalId": null,
      "dupScore": null,
      "priorityReason": "周辺動向として有用だが、即時アクションへの寄与は限定的。",
      "priorityScore": 55
    }
  ]
}
```
