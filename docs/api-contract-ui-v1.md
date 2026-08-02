# X Collector UI API Contract v1

Last updated: 2026-03-12
Version: `v1` (frozen for the six UI milestones below; clarification patch on 2026-03-12)

## 0. Auth Policy (fixed)

- UI (browser): **Auth.js session** only
- Backend/job calls to Railway API: **Bearer API Key**
- Never expose API keys in browser/client bundle.
- Recommended pattern: UI -> Next.js server route (BFF) -> Railway API with Bearer header.

### Required headers
- `GET /api/feed`: `Authorization: Bearer <FEED_API_KEY>`
- `GET /api/newsletter-editions/latest`: `Authorization: Bearer <NEWSLETTER_API_KEY>`
  - fallback key order on server: `NEWSLETTER_API_KEY` -> `DIGEST_API_KEY` -> `FEED_API_KEY`

Unauthorized response:
```json
{ "error": "Unauthorized..." }
```
HTTP status: `401`

---

## 1. `GET /api/newsletter-editions/latest`

### Query
- `date=YYYY-MM-DD` (interpreted as the **JST delivery-date label** for the 06:00-to-06:00 edition window; 内容日で引くなら `-1日`)
- `slug=<edition-slug>`
- `includeContent=0|1` (default `1`)
- `format=markdown` (optional; returns raw markdown text)

### Status behavior (fixed)
- `200`: edition found (JSON or markdown)
- `400`: invalid date format
- `401`: unauthorized
- `404`: edition not found
- `404`: `format=markdown` and `contentMd` empty

### JSON response schema (`200`)
```ts
{
  meta: {
    dateBasis: "jst-date" | "slug" | "latest";
    timeZoneForDateParam: "Asia/Tokyo";
    requestedDate: string | null;
    requestedSlug: string | null;
  };
  edition: {
    id: string;
    editionDate: string; // YYYY-MM-DD
    title: string;
    slug: string;
    status: "draft" | "published" | string;
    summary: string | null;
    model: string | null;
    generatedAt: string | null;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    bindingsCount: number;
    voiceSignalCount: number;
    contentChars: number;
    // includeContent=1 only; when empty => null
    contentMd?: string | null;
  };
}
```

### Null/empty rules (fixed)
- edition not found: `404 { error }`
- `contentMd` empty: JSON returns `contentMd: null`, `contentChars: 0`
- `format=markdown` + empty content: `404 { error }`

### Example (`200`)
```json
{
  "meta": {
    "dateBasis": "jst-date",
    "timeZoneForDateParam": "Asia/Tokyo",
    "requestedDate": "2026-03-10",
    "requestedSlug": null
  },
  "edition": {
    "id": "cmmm4jb6j0000o5s0krjt8o3z",
    "editionDate": "2026-03-10",
    "title": "2026年03月10日 AI Daily News",
    "slug": "ai-daily-news-20260310",
    "status": "draft",
    "summary": null,
    "model": "google/gemini-3.1-flash-lite-preview",
    "generatedAt": "2026-03-11T14:21:47.036Z",
    "publishedAt": null,
    "createdAt": "2026-03-11T14:21:32.074Z",
    "updatedAt": "2026-03-11T14:21:48.048Z",
    "bindingsCount": 120,
    "voiceSignalCount": 0,
    "contentChars": 4149,
    "contentMd": "# 2026年03月10日 AI Daily News\n..."
  }
}
```

---

## 2. `GET /api/feed`

### Query
- `date=YYYY-MM-DD` (**JST day**)
- OR `from=<ISO8601>&to=<ISO8601>`
- `platform=twitter,facebook,...`
- `source=<string>` (partial match against `sourceName` or `author`)
- `keyword=<string>` or `q=<string>`
- `limit=<number>` (1..1000, default 200)

### Status behavior (fixed)
- `200`: success (including empty list)
- `400`: invalid date/platform/limit
- `401`: unauthorized

### JSON response schema (`200`)
```ts
{
  meta: {
    from: string; // UTC ISO8601
    to: string;   // UTC ISO8601
    dateBasis: "jst-date" | "explicit-range" | "rolling-24h";
    timeZoneForDateParam: "Asia/Tokyo";
    platforms: string[];
    keyword: string | null;
    source: string | null;
    totalItems: number;
    counts: Record<string, number>;
  };
  items: Array<{
    id: string;
    platform: string;
    title: string;
    text: string;
    url: string;
    author: string | null;
    sourceName: string | null;
    tags: string[];
    publishedAt: string; // UTC ISO8601 (UI converts to JST)
    metrics: Record<string, number> | null;
  }>;
}
```

### Null/empty rules (fixed)
- no data: `200 { meta..., items: [] }`
- `publishedAt` is always returned as UTC ISO string in item payload.

### Example (`200`)
```json
{
  "meta": {
    "from": "2026-03-09T15:00:00.000Z",
    "to": "2026-03-10T14:59:59.999Z",
    "dateBasis": "jst-date",
    "timeZoneForDateParam": "Asia/Tokyo",
    "platforms": ["twitter", "facebook"],
    "keyword": null,
    "source": "verge",
    "totalItems": 2,
    "counts": { "twitter": 1, "facebook": 1 }
  },
  "items": [
    {
      "id": "2031399484895408414",
      "platform": "twitter",
      "title": "...",
      "text": "...",
      "url": "https://x.com/...",
      "author": "swapnakpanda",
      "sourceName": "@swapnakpanda",
      "tags": [],
      "publishedAt": "2026-03-10T15:59:13.000Z",
      "metrics": { "like": 12, "retweet": 2 }
    }
  ]
}
```

---

## 3. UI Handling Rules (fixed)

- 404 on newsletter endpoint:
  - Calendar Viewer should show **empty-day state** (not fatal red error).
- 400/401/500:
  - show retryable error state/toast.
- Date display:
  - convert all `publishedAt/generatedAt/...` from UTC to JST in UI layer.
- Dark/light mode:
  - no change to contract.

---

## 4. Implementation clarifications for UI (added 2026-03-12, non-breaking)

These notes are **binding for UI implementation** until backend and contract values are fully re-aligned.

1) `GET /api/feed` `limit` handling (contract vs runtime mismatch)
- Contract (this doc): `limit=1..1000`, default `200`
- Runtime currently observed: default `500`, max `2000`
- UI/BFF rule (fixed for v1): **always send `limit` explicitly** and use `200` as default.

2) Avoid implicit default dependency
- UI should not rely on server implicit defaults for `limit`.
- Always pass query params explicitly for reproducible behavior.

3) Newsletter API key fallback order (server-side only)
- `NEWSLETTER_API_KEY -> DIGEST_API_KEY -> FEED_API_KEY`
- BFF `.env` comments should document this order.

4) UTC -> JST conversion policy
- `publishedAt` / `generatedAt` / `createdAt` / `updatedAt` are UTC in API payloads.
- UI must centralize conversion in one shared date formatter utility.

5) `format=markdown` retrieval policy
- Newsletter markdown retrieval should use `format=markdown` query.
- `Accept` header usage can be optional, but team should keep one convention in BFF/fetch wrapper.

6) `FeedItem.url` validation edge case
- Some upstream items may produce empty string URL (e.g., certain Facebook cases).
- UI schema should allow empty string or apply fallback guard:
  - recommended: `z.string().url().or(z.literal(""))`

---

## 5. Implementation order

Implement the UI milestones in this order so each layer builds on an available dependency:

1. **App Shell**
2. **Auth foundation**
3. **Feed API connectivity**
4. **Feed list view**
5. **Newsletter viewer**
6. **Calendar navigation**
