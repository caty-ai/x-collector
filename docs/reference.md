# X Collector — Reference

[← Back to the front page](../README.md) ｜ 🔧 [Engineering guide](engineering.md)

This page is the entrance to the exact specifications. Each area below has a dedicated document; this index tells you which one is authoritative for what.

---

## Specification index

| Area | Authoritative document | Language |
|---|---|---|
| Environment variables (complete list) | [operations.md — environment variable reference](operations.md#環境変数全リファレンス) | Japanese |
| Feed and application APIs | [api.md](api.md) | Japanese |
| UI API contract (v1) | [api-contract-ui-v1.md](api-contract-ui-v1.md) | Japanese |
| Agent feed: differential search contract | [agent-feed.md](agent-feed.md) | English |
| MCP server: endpoint, auth, tools | [mcp-server.md](mcp-server.md) | English |
| Family Feed API | [family-feed-api.md](family-feed-api.md) | Japanese |
| Pipeline stages, taxonomy, data model | [v2-design.md](v2-design.md) | Japanese |
| Design system (WIRED-inspired editorial language) | [DESIGN.md](DESIGN.md) | English |
| LLM prompts (runtime-loaded — do not move) | [prompts/](prompts/) | — |
| Production jobs, cron, retention, source lifecycle | [operations.md](operations.md) | Japanese |
| Step4 cross-linking: manual-run runbook | [step4-crosslink-llm-manual-runbook.md](step4-crosslink-llm-manual-runbook.md) | Japanese |
| Change history | [changelog.md](changelog.md) | Japanese |

---

## Key contracts at a glance

Short versions of the rules integrators most often need. The documents above always win if they disagree.

- **Newsletter BFF key fallback** — server-side routes resolve the API key in the order `NEWSLETTER_API_KEY` → `DIGEST_API_KEY` → `FEED_API_KEY`
- **MCP gate** — `MCP_API_KEY` falls back to `FAMILY_FEED_API_KEY`; when both are unset the server runs in open dev mode
- **Google sign-in and protected routes fail closed** — `ADMIN_EMAIL_ALLOWLIST` gates Google sign-in and every NextAuth-protected route; unset or empty denies all sign-ins, and tokens of non-allowlisted accounts are rejected (403 on pages, 401 on session-gated APIs; `/calendar` still honours the shared-passphrase cookie)
- **Default LLM models** — classification, cross-linking, and composition all default to `google/gemini-3.1-flash-lite-preview` via OpenRouter
- **MCP endpoint** — read-only Streamable HTTP at `/api/mcp/mcp`, exposing `search_feed` and `get_daily_news`
