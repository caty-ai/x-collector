# X Collector UI API Contract v1

Last updated: 2026-09-09
Version: `v1` (frozen for the six UI milestones below; clarification patch on 2026-03-12)

§1b は凍結済み v1 surface への追加拡張である（既存 endpoint の contract は変えない）。

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
- `includeItems=0|1` (default `0`)
- `format=markdown|json` (optional; `markdown` returns raw markdown text)
- `status=published` (optional; only `published` is accepted)
- `projection=public` (optional; only `public` is accepted)

### Status behavior (fixed)
- `status=published` disables the no-date fallback to any edition with non-empty `contentMd`
- `200`: edition found (JSON or markdown)
- `400`: invalid date format
- `400 { "error": "Invalid status. Use status=published" }`: unsupported non-null `status`
- `400 { "error": "Invalid projection. Use projection=public" }`: unsupported non-null `projection`
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
    // includeItems=1 only
    items?: Array<{
      pipelineItemId: string;
      section: string;
      position: number;
      title: string | null;
      titleJa: string | null;
      url: string;
      platform: string;
      sourceRef: string | null;
      trustLabel: string | null;
    }>;
  };
}
```

When `projection=public`, `meta` is unchanged and `edition` is restricted to exactly:

- `editionDate`, `title`, `status`, `publishedAt`, `bindingsCount`, `contentChars`
- `contentMd` only when `includeContent=1`
- `items` only when `includeItems=1`; each item contains only `section`, `position`, `title`, `titleJa`, `url`, `trustLabel`

The anonymous BFF (`/api/bff/newsletter-editions/latest`, public mode) additionally rebuilds `meta` as exactly the four keys `dateBasis`, `timeZoneForDateParam`, `requestedDate`, and `requestedSlug`; each value is a string or `null` (`null` when upstream omits it or sends a non-string), so an extended or missing upstream `meta` cannot change the anonymous response shape.

The public projection never includes `id`, `slug`, `model`, `summary`, `generatedAt`, `createdAt`, `updatedAt`, `voiceSignalCount`, or item fields `pipelineItemId`, `platform`, `sourceRef`.

### Markdown response headers

- Without `projection=public`: `content-type`, `x-content-type-options`, `x-edition-id`, `x-edition-slug`, `x-edition-status`
- With `projection=public`: `content-type`, `x-content-type-options`, `x-edition-status` only

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

## 1b. `GET /api/newsletter-editions/month`

「month summary」はこの `/month` route が返す月単位の疎な索引を指す概念名である。

### Query and bounds

- `month=YYYY-MM`（必須）。year は 4 桁で、最後に受理できる月は `9999-11`（`9999-12` は翌月境界を表現できないため。実運用上は到達しない）。JST の月初 `00:00:00.000+09:00` から翌月月初の 1 ms 前までを検索する。
- `status=published`（任意。指定できる値は `published` だけ）。

`days[].date` は保存 instant の **JST calendar date** であり、calendar cell と `latest?date=` に渡す JST label に一致する。これは `latest` の `edition.editionDate` が使う UTC slice とは意図的に異なる。通常の production storage（UTC midnight）では一致するが、JST midnight（前日 `15:00Z`）を保存した row でも calendar 上の正しい日を返すためである。

### Response (`200`)

```json
{
  "meta": {
    "month": "2026-09",
    "timeZoneForDateParam": "Asia/Tokyo",
    "status": "published"
  },
  "days": [
    { "date": "2026-09-01", "status": "published", "bindingsCount": 12 }
  ]
}
```

`days` は edition が存在する日だけを含む昇順の sparse array で、`bindingsCount` は article binding の件数である。空の月も `200` と `days: []` を返し、upstream month route 自体は 404 を返さない。エラーは無効な `month` / `status` が 400、認証失敗が 401 である。

匿名 public BFF `/api/bff/newsletter-editions/month` は query を `month` だけに制限し、`2020-01` から JST today+1 を含む月までを許可する。upstream へは `status=published` を固定し、IP ごとの独立した `newsletter-month` scope で 60 requests/60 秒に制限する。匿名 response は `meta` を正確に `month`, `timeZoneForDateParam`, `status`、各 `days[]` を正確に `date`, `bindingsCount` に再構築する。公開可能な `published` day だけを残し、JST の今日+1 より後の日はすべて除外する。top-level body が non-object、`meta.month` が欠落または request と不一致、`days` が array ではない、または raw `days` が 31 件を超える場合（および malformed JSON）は、`502 {"error":"Bad upstream response"}` とする。一方、個々の day row が non-published、日付不正、許可 window 外、または `bindingsCount` が非整数・負数の場合、その row だけを除外し response は 200 のまま保つ。upstream の 404/429 以外の non-2xx と fetch failure は `502 {"error":"Upstream error"}` とする。匿名の固定 non-2xx body は、これら 2 種類の 502 に加え、404 が `{"error":"Month summary not found","code":"UPSTREAM_ROUTE_MISSING"}`、429 が `{"error":"Too many requests"}` である（429 は `Retry-After: 60` 付き）。

coded 404 は empty month ではなく「upstream route missing」を全 auth mode で表す operator signal である。calendar はエラー banner を表示し、per-day request へ fan-out せず、月全体を `known:false` とする。月 endpoint が成功した場合、response にない日（JST の今日+1 より後の日を含む）は `known:true, hasData:false` として dim 表示され、エラー banner は出さない。たとえば JST 09-30 に 10 月へ移動した場合、印が付きうるのは 10-01 だけである。月全体または一部の日付の取得失敗に表示する「一部の日付の取得に失敗しました（…）」という wording は continuity のため意図的に維持する。

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
