# X Collector

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/) [![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql) [![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)

English · [日本語](README.ja.md) · [ไทย](README.th.md) · [中文](README.zh.md)

**What it is.** X Collector is a service that gathers AI and technology updates into one daily newspaper and one searchable feed.

**The frustration it solves.** Useful news is scattered across social networks, specialist websites, software project pages, and subscriptions, so keeping up means repeatedly checking many places and still missing important context.

**How it works.** You choose the sources; X Collector gathers their updates, sorts and connects them, then publishes the same organized information for people and AI agents.

![Diagram showing X Collector gathering updates from eight source types, refining and publishing them for people and AI agents, with a reviewed source lifecycle](assets/hero.svg)

## Table of contents

- [Features](#features)
- [Supported environments](#supported-environments)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Development status and roadmap](#development-status)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

<a id="features"></a>
## Features

- **Collect from seven platform families — eight source types in total.** Bring together X (Twitter), Instagram, Facebook, Reddit, Qiita, GitHub, and Alerts feeds covering RSS and YouTube.
- **Turn noise into an organized feed.** The pipeline normalizes each item, classifies it with an 11-category primary taxonomy and 15 optional subcategories, links duplicates and follow-ups, and aggregates market voices.
- **Publish a daily newspaper.** A scheduled publishing job lays selected items out as a 13-section Markdown edition.
- **Give people and agents the same information.** Readers get the newspaper and web interface; integrations get authenticated Feed APIs and a read-only Streamable HTTP MCP server.
- **Enrich thin source material.** Linked pages and YouTube transcripts can be added before classification to provide more context.
- **Review new sources instead of hunting for them.** The discovery workflow extracts candidates from collected X posts, retrieves profiles, and uses an LLM to score them; promotion always requires a person to approve it.
- **Make source quality visible.** Daily, rules-based trust scores influence newspaper ranking, while low-confidence items are labeled rather than silently treated as reliable.
- **Retire declining discovered sources safely.** Only automatically discovered sources are eligible for automatic deactivation, and only after two consecutive weekly gates; manually added sources are never automatically stopped.
- **Manage sources in one place.** The settings interface covers platform source lists, candidate review, and restoration of lifecycle-deactivated sources.

<a id="supported-environments"></a>
## Supported environments

✅ means verified from this repository or its documented production deployment. ⚠️ means documented and expected to work, but not exercised in this checkout.

| Area | Environment | Status |
|---|---|---|
| Runtime | Node.js 18.17.0 or newer; this checkout was built with Node.js 26.5.0 | ✅ Verified |
| Database | PostgreSQL; no minimum server version is documented | ✅ Prisma provider and migrations verified |
| Hosting | Railway | ✅ Verified in production |
| MCP clients | Claude CLI, Claude.ai, and Claude Desktop | ⚠️ Documented; not exercised here |

<a id="architecture"></a>
## Architecture

**Design principle:** collect once, refine into a shared information base, then publish it in forms that both people and AI agents can use.

| Module | Responsibility |
|---|---|
| `src/app/` | Next.js pages, the management interface, and API endpoints |
| `src/collector/` | Platform collectors and production job entry points |
| `src/lib/pipeline/` | Normalization, classification, cross-linking, trust-aware selection, and publishing logic |
| `src/summary/` | Daily summary generation |
| `prisma/` | PostgreSQL schema and migrations |

The full pipeline is documented in [the V2 design](docs/v2-design.md). Deployment schedules, safety behavior, retention, and operational commands live in [the operations guide](docs/operations.md).

<a id="quickstart"></a>
## Quickstart

### Prerequisites

- Node.js 18.17.0 or newer
- A PostgreSQL database
- Google OAuth credentials for signing in to the management interface
- ScrapeCreators and OpenRouter API keys when you are ready to collect and classify data

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
```

To collect and classify data, also set:

```dotenv
SCRAPECREATORS_API_KEY=your_scrapecreators_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

### Run

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`, sign in, and add your own seed list under `/settings`. In another terminal, run a manual collection when your collector keys and sources are ready:

```bash
npm run collect
```

<a id="configuration"></a>
## Configuration

| What you want to do | Where to look |
|---|---|
| Review every environment variable | [Environment variable reference](docs/operations.md#環境変数全リファレンス) |
| Run individual pipeline steps | [V2 pipeline helper CLI](docs/operations.md#v2-パイプライン補助-cli) |
| Configure production schedules | [Production cron guide](docs/operations.md#cron本番運用) |
| Add your own collection sources | [Adding sources](docs/operations.md#ソース追加方法) |
| Understand source discovery, trust scoring, and lifecycle rules | [Operations guide](docs/operations.md) |
| Review known operational follow-ups | [Known follow-ups](docs/operations.md#既知の-follow-up未着手) |

<a id="documentation"></a>
## Documentation

| Document | Contents |
|---|---|
| [Pipeline design](docs/v2-design.md) | Processing stages, taxonomy, and data model |
| [Operations guide](docs/operations.md) | Deployment jobs, cron, configuration, retention, and source operations |
| [API reference](docs/api.md) | Feed and application endpoints |
| [Agent feed guide](docs/agent-feed.md) | Searching and incrementally reading the feed from an agent |
| [MCP server guide](docs/mcp-server.md) | Endpoint, authentication, tools, and client setup |
| [Changelog](docs/changelog.md) | Project changes |

<a id="development-status"></a>
## Development status and roadmap

- [x] **Collection:** seven platform families, unified PostgreSQL storage, and Feed API
- [x] **Refinement:** normalization, LLM classification, cross-linking, voice aggregation, and the current taxonomy
- [x] **Publishing:** 13-section Markdown editions with source links
- [x] **Agent access:** searchable feed and read-only MCP tools (`search_feed` and `get_daily_news`)
- [x] **Source quality controls:** candidate evaluation, trust scoring, approval UI, and guarded deactivation lifecycle
- [x] **Publication foundation:** multilingual public documentation, community health files, and MIT licensing
- [ ] **Future candidates:** semantic topic clustering improvements, a clearer edition publishing flow, and a documented data-retention policy

Recent changes are listed in the [changelog](docs/changelog.md); current operational gaps are tracked in the [known follow-ups](docs/operations.md#既知の-follow-up未着手).

<a id="contributing"></a>
## Contributing

Issue-driven development, branch conventions, and pull request guidance are described in [CONTRIBUTING.md](CONTRIBUTING.md).

<a id="acknowledgments"></a>
## Acknowledgments

X Collector builds on these services:

- [ScrapeCreators](https://scrapecreators.com/) — collection APIs for X, Instagram, Facebook, and Reddit
- [OpenRouter](https://openrouter.ai/) — LLM classification and edition composition
- [Qiita API v2](https://qiita.com/api/v2/docs) — Qiita item collection
- [GitHub REST API](https://docs.github.com/en/rest) — repository and search data
- [Railway](https://railway.com/) — hosting and scheduled jobs
- [TranscriptAPI](https://transcriptapi.com/) — YouTube transcript enrichment

<a id="license"></a>
## License

X Collector is available under the [MIT License](LICENSE).
