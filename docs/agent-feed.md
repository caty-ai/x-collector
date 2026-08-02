# Agent Feed

`GET /api/family-feed` supports stateless differential search for agents. Agents can filter the classified feed by taxonomy, platform, date window, tags, keywords, and a cursor-style `since` value without storing server-side session state.

## Auth

Send the family feed API key as a bearer token:

```bash
Authorization: Bearer $FAMILY_FEED_API_KEY
```

Requests without a valid bearer token return `401` when `FAMILY_FEED_API_KEY` is configured.

## Query Parameters

| Param | Default | Description |
| --- | --- | --- |
| `category` | all non-null `primaryTag` values | Comma-separated OR filter on `primaryTag`, for example `category=TECH,AI`. |
| `action` | all | Exact `actionTag` filter, for example `action=WATCH`. |
| `platform` | all | Exact source platform filter on the pipeline item. |
| `date` | none | Strict JST calendar day in `YYYY-MM-DD` format. Produces a full-day classified-at window. |
| `from` | rolling 48h start when no date range is supplied | Strict ISO 8601 datetime lower bound for `classifiedAt` (`T`, optional milliseconds, and `Z` or `±hh:mm` offset required). |
| `to` | now minus 2 seconds | Strict ISO 8601 datetime upper bound for `classifiedAt`. |
| `limit` | `100` | Maximum returned items. Clamped to `500`; a boundary tie may expand a pagination page beyond `limit` (hard bound: `takeCap = min(limit * 10, 5000)`). |
| `dedup` | `true` | Set `dedup=false` to return all eligible rows instead of one canonical item per multi-source topic cluster. |
| `tags` | none | Comma-separated exact tags. An item matches when any supplied tag equals its `primaryTag`, `subTag`, or `actionTag`. This composes with `category` and `action` as an additional AND filter. |
| `keywords` | none | Comma-separated search terms. An item matches when any keyword appears case-insensitively in `title`, `titleJa`, or `summaryJa`. |
| `since` | none | Strict ISO 8601 datetime cursor. Returns only items with `classifiedAt > since`. If no `date`/`from`/`to` is supplied, the date window becomes `[since, now minus 2 seconds]` and `window.basis` is `"since"` instead of the default rolling 48h window. |

Date-window precedence is:

1. `date`
2. `from`/`to`
3. `since`
4. rolling last 48 hours

When `since` is combined with `date` or an explicit `from`, it is applied as an additional strict lower bound. When `since` is present with `to` but no explicit `from`, `since` becomes the effective `from` for the explicit range.

## Cursor Pattern

Every response with items supplies a usable `meta.nextSince`, including pagination responses
where `meta.truncated === true`. On truncation, persist `nextSince`, request the next page with
`since=meta.nextSince`, and loop until `meta.truncated === false`. `nextSince` never points
past data delivered in that response, subject to the datetime-cursor limitations below.

If the response has no items, `meta.nextSince` is `null`; keep the previous cursor.

With `dedup=true`, at-least-once delivery is defined over deduplicated logical clusters: a
suppressed member is represented by its cluster canonical. Canonicals can differ across pages,
so clusters may be over-delivered but are never skipped at the cluster level. Use `dedup=false`
for row-level at-least-once delivery. Agents should still deduplicate re-delivered IDs locally.

The `since` filter is a strict `>` comparison on `classifiedAt`. The default upper bound stays
two seconds behind now to avoid skipping rows committed concurrently in the cursor-boundary
millisecond. The guarantee is scoped to monotonically committed `classifiedAt` values;
backdated backfills older than an already advanced cursor are not re-delivered. A single
timestamp tie group larger than `takeCap` cannot be paginated by a datetime-only cursor, so
rows beyond the cap are lost until the compound `(classifiedAt, id)` cursor follow-up lands.

## Examples

Tags-only search:

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?tags=AI,WATCH&limit=50"
```

Keywords plus cursor:

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?keywords=robotics,agent&since=2026-07-05T00:00:00.000Z"
```

Full combo:

```bash
curl -H "Authorization: Bearer $FAMILY_FEED_API_KEY" \
  "https://example.com/api/family-feed?category=TECH,AI&action=WATCH&platform=twitter&tags=MODEL,TOOL&keywords=openai,codex&from=2026-07-01T00:00:00.000Z&to=2026-07-05T00:00:00.000Z&since=2026-07-03T12:00:00.000Z&limit=100&dedup=false"
```

## Response Cursor Fields

The response includes:

```json
{
  "meta": {
    "window": {
      "from": "2026-07-03T12:00:00.000Z",
      "to": "2026-07-05T08:30:00.000Z",
      "basis": "since"
    },
    "nextSince": "2026-07-05T08:30:00.000Z",
    "truncated": false,
    "filters": {
      "tags": ["MODEL", "TOOL"],
      "keywords": ["openai", "codex"],
      "since": "2026-07-03T12:00:00.000Z"
    }
  }
}
```

`items[*].topicClusterKey` remains the current cluster identifier field. The response schema is compatible with a future `clusterKey` field, but agents should continue to read `topicClusterKey` unless the API explicitly changes.
