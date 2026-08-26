# X Collector — Engineering Guide

[← Back to the front page](../README.md) ｜ 📘 [Reference](reference.md)

X Collector is a self-hosted Next.js + PostgreSQL service that collects AI and technology updates from sources you choose, refines them through a classification pipeline, and publishes the result as a daily Markdown newspaper, a searchable feed, authenticated Feed APIs, and a read-only MCP server.

---

## Features

- **Collect from 7 platform families — 8 source types in total.** X (Twitter), Instagram, Facebook, Reddit, Qiita, GitHub, and Alerts feeds covering RSS and YouTube.
- **Turn noise into an organized feed.** The pipeline normalizes each item, classifies it with an 11-category primary taxonomy and 15 optional subcategories, links duplicates and follow-ups, and aggregates market voices.
- **Publish a daily newspaper.** A scheduled publishing job lays selected items out as a 13-section Markdown edition.
- **Give people and agents the same information.** Readers get the newspaper and web interface; integrations get authenticated Feed APIs and a read-only Streamable HTTP MCP server.
- **Enrich thin source material.** Linked pages and YouTube transcripts can be added before classification to provide more context.
- **Review new sources instead of hunting for them.** The discovery workflow extracts candidates from collected X posts, retrieves profiles, and uses an LLM to score them; promotion always requires a person to approve it.
- **Make source quality visible.** Daily, rules-based trust scores influence newspaper ranking; stories from low-trust or unverified sources are badged in the newspaper, and blocked sources are excluded from selection.
- **Retire declining discovered sources safely.** Only automatically discovered sources are eligible for automatic deactivation, and only after two consecutive weekly gates; manually added sources are never automatically stopped.
- **Manage sources in one place.** The settings interface covers platform source lists, candidate review, and restoration of lifecycle-deactivated sources.

---

<a id="supported-environments"></a>

## Supported environments

✅ means verified from this repository or its documented production deployment. ⚠️ means documented and expected to work, but not exercised in this checkout.

| Area | Environment | Status |
|---|---|---|
| Runtime | Node.js 20 or newer; this checkout was built with Node.js 26.5.0 | ✅ Verified |
| Database | PostgreSQL; no minimum server version is documented | ✅ Prisma provider and migrations verified |
| Hosting | Railway | ✅ Verified in production |
| Operating systems (develop & self-host) | Linux (`ubuntu-latest`) and macOS (`macos-latest`, Apple Silicon) | ✅ Full test suite (typecheck, Prisma generate, tests) runs on both in CI |
| Operating systems (WSL2 addendum) | WSL2 (Ubuntu on Windows) | ⚠️ Covered by the Linux path; not separately exercised. Clone under the Linux filesystem (e.g. `~/`), not `/mnt/c` — `next dev` file watching is unreliable and `npm install` is much slower over drvfs |
| MCP clients | Claude CLI, Claude.ai, and Claude Desktop | ⚠️ Documented; not exercised here |

---

## Architecture

**Design principle:** collect once, refine into a shared information base, then publish it in forms that both people and AI agents can use.

| Module | Responsibility |
|---|---|
| `src/app/` | Next.js pages, the management interface, and API endpoints |
| `src/collector/` | Platform collectors and production job entry points |
| `src/lib/pipeline/` | Normalization, classification, cross-linking, trust-aware selection, and publishing logic |
| `src/summary/` | Daily summary generation |
| `prisma/` | PostgreSQL schema and migrations |

The full pipeline is documented in [the V2 design](v2-design.md) (Japanese). Deployment schedules, safety behavior, retention, and operational commands live in [the operations guide](operations.md) (Japanese).

> **Note:** `docs/prompts/` is not documentation — it is the runtime prompt source. The classification pipeline loads `<cwd>/docs/prompts/step1-3/` at run time, so do not move or delete that directory.

---

<a id="quickstart"></a>

## Quickstart

### Prerequisites

- Node.js 20 or newer
- A PostgreSQL database
- Google OAuth credentials for signing in to the management interface
- ScrapeCreators and OpenRouter API keys when you are ready to collect and classify data
- A TranscriptAPI key only if you want YouTube transcript enrichment (optional)

The current schema stores embeddings as PostgreSQL JSONB. It does not require the pgvector extension.

### Install

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

### Minimal configuration

Open `.env` and set these values before starting the application:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000

# The feed/newspaper UI reads through /api/bff/* proxy routes.
# For a single local instance, point the app at itself and self-issue a key.
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

Without `RAILWAY_API_BASE_URL` and `FEED_API_KEY`, sign-in succeeds but the feed, explorer, and newspaper screens return errors, because they all read through the BFF proxy.

To collect and classify data, also set:

```dotenv
SCRAPECREATORS_API_KEY=your_scrapecreators_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

LLM classification and newspaper composition run through OpenRouter; the default model for both is `google/gemini-3.1-flash-lite-preview`, configurable via `CLASSIFY_MODEL`, `STEP4_CROSSLINK_LLM_MODEL`, and `STEP5_COMPOSE_MODEL`. Optional keys: `TRANSCRIPTAPI_API_KEY` enables YouTube transcript enrichment, and `GITHUB_TOKEN` raises GitHub API rate limits (collection works without it). Qiita and RSS collection require no keys.

What works without which key:

- **No ScrapeCreators key** — Qiita, GitHub, and RSS collection still work; X, Instagram, Facebook, and Reddit collection fail or are skipped
- **No OpenRouter key** — collection and browsing work, but every LLM step (classification, cross-linking, newspaper composition) is unavailable
- **Production cycle job** — `collect:prod:cycle` asserts both `SCRAPECREATORS_API_KEY` and `OPENROUTER_API_KEY` at startup and exits early if either is missing

### Run

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`, sign in, and add your own seed list under `/settings` — or run `npm run seed` once to load neutral sample sources (a few X handles plus Facebook, Reddit, Qiita, and GitHub samples). In another terminal, run a manual collection when your collector keys and sources are ready:

```bash
npm run collect
```

---

## Configuration

| What you want to do | Where to look |
|---|---|
| Review every environment variable | [Environment variable reference](operations.md#環境変数全リファレンス) (Japanese) |
| Run individual pipeline steps | [V2 pipeline helper CLI](operations.md#v2-パイプライン補助-cli) (Japanese) |
| Configure production schedules | [Production cron guide](operations.md#cron本番運用) (Japanese) |
| Add your own collection sources | [Adding sources](operations.md#ソース追加方法) (Japanese) |
| Understand source discovery, trust scoring, and lifecycle rules | [Operations guide](operations.md) (Japanese) |
| Review known operational follow-ups | [Known follow-ups](operations.md#既知の-follow-up未着手) (Japanese) |

---

<a id="development-status"></a>

## Development status and roadmap

- [x] **Collection:** 7 platform families, unified PostgreSQL storage, and Feed API
- [x] **Refinement:** normalization, LLM classification, cross-linking, voice aggregation, and the current taxonomy
- [x] **Publishing:** 13-section Markdown editions with source links
- [x] **Agent access:** searchable feed and read-only MCP tools (`search_feed` and `get_daily_news`)
- [x] **Source quality controls:** candidate evaluation, trust scoring, approval UI, and guarded deactivation lifecycle
- [x] **Publication foundation:** multilingual public documentation, community health files, and MIT licensing
- [ ] **Future candidates:** semantic topic clustering improvements, a clearer edition publishing flow, and a documented data-retention policy

Recent changes are listed in the [changelog](changelog.md) (Japanese); current operational gaps are tracked in the [known follow-ups](operations.md#既知の-follow-up未着手) (Japanese).

---

## Contributing

Issue-driven development, branch conventions, and pull request guidance are described in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Acknowledgments

X Collector builds on these services:

- [ScrapeCreators](https://scrapecreators.com/) — collection APIs for X, Instagram, Facebook, and Reddit
- [OpenRouter](https://openrouter.ai/) — LLM classification and edition composition
- [Qiita API v2](https://qiita.com/api/v2/docs) — Qiita item collection
- [GitHub REST API](https://docs.github.com/en/rest) — repository and search data
- [Railway](https://railway.com/) — hosting and scheduled jobs
- [TranscriptAPI](https://transcriptapi.com/) — YouTube transcript enrichment
