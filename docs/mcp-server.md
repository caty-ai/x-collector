# MCP server

x-collector exposes a read-only Streamable HTTP MCP server at `/api/mcp/mcp` (for example, `https://example.com/api/mcp/mcp`). The dynamic route segment is `mcp`; clients should use this exact URL.

## Authentication

Send `Authorization: Bearer <token>`. The route accepts `MCP_API_KEY`, falling back to `FAMILY_FEED_API_KEY`. If neither variable is set, the route is open in development, matching the family-feed development behavior.

The proxied endpoints retain their own authentication: `search_feed` uses `FAMILY_FEED_API_KEY`; `get_daily_news` uses the newsletter route's existing fallback order, `NEWSLETTER_API_KEY`, then `DIGEST_API_KEY`, then `FEED_API_KEY`.

## Server configuration

On serverless or split deployments, set `MCP_SELF_BASE_URL` to this app's own reachable base URL (for example, `https://example.com`). Otherwise the MCP tools' internal requests default to `localhost` and fail with `Upstream request failed` in that topology.

## Tools

### `search_feed`

Searches `/api/family-feed`. Parameters are `tags`, `keywords`, `category`, `platform`, `date` (`YYYY-MM-DD`), `from` (ISO datetime), `to` (ISO datetime), `since` (ISO datetime cursor), `limit` (1–500; default 100), and `dedup` (boolean).

Pagination uses an honest cursor. While `meta.truncated === true`, call `search_feed` again with `since=meta.nextSince`. Stop only when `meta.truncated === false`. Preserve the returned cursor exactly; do not infer completion from the number of returned items.

### `get_daily_news`

Gets `/api/newsletter-editions/latest`. Parameters are `date` (`YYYY-MM-DD`, interpreted as JST), `format` (`json` or `markdown`, default `markdown`), and `includeItems` (boolean). Markdown is returned as raw text; JSON is returned as serialized JSON.

## Client setup

For the Claude CLI:

```sh
claude mcp add --transport http x-collector https://example.com/api/mcp/mcp --header "Authorization: Bearer <token>"
```

Claude.ai and Claude Desktop can also add this URL as a remote MCP server.
