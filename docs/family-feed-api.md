# Family Feed API

`GET /api/family-feed` returns a classified pipeline feed for the AI family. It includes only eligible pipeline classifications:

- `noise: false`
- `primaryTag` is present
- `classifiedAt` falls inside the requested date window

By default, the endpoint uses a rolling 48-hour window and deduplicates multi-source topic clusters to one canonical item.

## Auth

Set `FAMILY_FEED_API_KEY` to require bearer-token auth:

```bash
Authorization: Bearer <key>
```

If `FAMILY_FEED_API_KEY` is unset, the endpoint is open for local/dev use.

Unauthorized requests return `401`.

## Query Params

| Param | Default | Description |
| --- | --- | --- |
| `date` | none | Strict JST calendar day in `YYYY-MM-DD` format. Produces `[T00:00:00+09:00, +24h-1ms]`. |
| `from` | none | Strict ISO 8601 datetime range start (`T`, optional milliseconds, and `Z` or `±hh:mm` offset required). |
| `to` | none | Strict ISO 8601 datetime range end. When omitted, the upper bound is now minus two seconds. |
| `category` | all | Comma-separated OR filter on `primaryTag`. |
| `action` | all | Single `actionTag` filter. |
| `platform` | all | Single platform filter. |
| `limit` | `100` | Maximum returned items. Clamped to `500`. |
| `dedup` | `true` | Use `false` to return all eligible rows without topic-cluster collapse. |
| `since` | none | Strict ISO 8601 datetime cursor. Returns only rows with `classifiedAt > since`. |
| `lang` | `ja` | Reserved metadata hint. `ja` and `raw` have no functional effect. |

Date-window precedence is:

1. `date`
2. `from`/`to`
3. rolling last 48 hours

## Cursor and Truncation

Pass `since=<ISO 8601 datetime>` to retrieve classifications strictly newer than that
cursor. When `meta.truncated` is `true`, the response is a pagination page: it returns
the oldest remaining classifications first and provides a usable `meta.nextSince`.
Continue requesting with `since=meta.nextSince` until `meta.truncated` is `false`.
`nextSince` never points past data delivered by that response, subject to the datetime-cursor
limitations below.

At a page boundary, every item with the same `classifiedAt` as the limit-th item is
included in that response. A page can therefore contain slightly more than `limit` items;
the hard bound is `takeCap = min(limit * 10, 5000)`. This tie expansion prevents the strict
`since` filter from skipping items tied at the boundary.

The database fetch has a separate `takeCap` safety boundary. If it lands on a newest
`classifiedAt` tie-group, that entire fetched group is omitted from the current page; the
next request uses a cursor before that timestamp and re-fetches the whole group. In the
pathological case where a single timestamp tie group is larger than `takeCap`, a datetime-only
cursor cannot paginate the group: rows beyond that cap are lost until the compound
`(classifiedAt, id)` cursor follow-up lands.

With `dedup=true`, at-least-once delivery is defined over deduplicated logical clusters: a
suppressed member is represented by its cluster canonical. Canonicals can differ across pages,
so clusters can be over-delivered but are never skipped at the cluster level. Row-level
at-least-once delivery requires `dedup=false`.

The guarantee is scoped to monotonically committed `classifiedAt` values. Backdated backfills
older than an already advanced cursor are not re-delivered.

If a response contains no items, `meta.nextSince` is `null`.

## Agent Examples

`agent-a` (AI and engineering):

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=TECH,TOOL,AI"
```

`agent-b` (business and markets):

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=BUSINESS,MARKET"
```

`agent-c` (music and creative work):

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=MUSIC,CREATIVE"
```

`agent-d` (technology and product):

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=TECH,PRODUCT"
```

`agent-e` (code and development):

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=CODE,DEV,TECH"
```

## Cluster Metadata

Use `dedup=false` to inspect all eligible items and their cluster fields:

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=AI&dedup=false&limit=25"
```

Cluster metadata fields:

- `topicClusterKey`
- `distinctSources`
- `clusterSize`
- `mentionedBy`

## Response Shape

```json
{
  "meta": {
    "window": {
      "from": "2026-06-19T00:00:00.000Z",
      "to": "2026-06-21T00:00:00.000Z",
      "basis": "rolling-48h"
    },
    "totalItems": 1,
    "counts": {
      "AI": 1
    }
  },
  "items": [
    {
      "id": "clx123",
      "platform": "twitter",
      "author": null,
      "sourceRef": "openai",
      "url": "https://example.com/item",
      "title": "Original title",
      "titleJa": "Localized title",
      "summaryJa": "Localized summary",
      "tags": ["AI", "MODEL", "WATCH"],
      "publishedAt": "2026-06-20T10:00:00.000Z",
      "classifiedAt": "2026-06-20T11:00:00.000Z",
      "topicClusterKey": "topic:abc",
      "distinctSources": 3,
      "clusterSize": 4,
      "mentionedBy": 3
    }
  ]
}
```
