# API リファレンス

## 統合 Feed API

エージェントや外部ツールから全データにアクセスするための統合エンドポイント。

### 認証

```
Header: Authorization: Bearer <FEED_API_KEY>
```

### エンドポイント

```
GET /api/feed                              # 直近24時間の全データ
GET /api/feed?date=2026-03-04              # 特定日
GET /api/feed?from=2026-03-01&to=2026-03-04  # 日時範囲
GET /api/feed?platform=reddit              # プラットフォーム絞込
GET /api/feed?platform=reddit,qiita        # 複数指定
GET /api/feed?q=OpenAI                     # キーワード検索
GET /api/feed?limit=100                    # 件数制限（最大2000）
```

### レスポンス例

```json
{
  "meta": {
    "from": "2026-03-04T00:00:00.000Z",
    "to": "2026-03-04T23:59:59.999Z",
    "platforms": ["twitter", "instagram", "facebook", "reddit", "qiita", "github", "alerts"],
    "keyword": null,
    "totalItems": 500,
    "counts": {
      "facebook": 184,
      "reddit": 124,
      "github": 98,
      "alerts": 55,
      "qiita": 34,
      "twitter": 5
    }
  },
  "items": [
    {
      "id": "...",
      "platform": "reddit",
      "title": "New AI model released...",
      "text": "...",
      "url": "https://...",
      "author": "username",
      "sourceName": "r/MachineLearning",
      "tags": ["ai", "ml"],
      "publishedAt": "2026-03-04T12:00:00.000Z",
      "metrics": { "score": 150, "comments": 23 }
    }
  ]
}
```

### プラットフォーム別 metrics

| Platform | metrics フィールド |
|----------|-------------------|
| Twitter | bookmark, like, retweet, view |
| Instagram | likes, comments |
| Facebook | reactions, comments |
| Reddit | score, comments |
| Qiita | likes, stocks |
| GitHub | stars, forks |
| Alerts | null |

## エージェント向け検索 API（family-feed）

`GET /api/family-feed` — `tags` / `keywords` / `since` + `meta.nextSince`・`meta.truncated`（honest cursor）でステートレス差分取得に対応。認証は `FAMILY_FEED_API_KEY`。

詳細は [agent-feed.md](agent-feed.md) / [family-feed-api.md](family-feed-api.md) を参照。

## UI 向け BFF

- `GET /api/bff/feed`
  - 認証: Auth.js セッション必須（未ログインは 401）
  - 挙動: `RAILWAY_API_BASE_URL + /api/feed` へサーバー側で中継し、`Authorization: Bearer <FEED_API_KEY>` を注入
  - ブラウザには API キーを露出しない

UI v1 の API 契約は [api-contract-ui-v1.md](api-contract-ui-v1.md) を参照。

## ソース管理 API

各プラットフォームのソース CRUD は `/api/{platform}-sources`（Twitter のみ `/api/sources`）。追加例は [operations.md の「ソース追加方法」](operations.md#ソース追加方法) を参照。
