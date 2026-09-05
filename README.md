# X Collector

<div align="center">

**🇺🇸 English** ｜ [🇯🇵 日本語](README.ja.md) ｜ [🇨🇳 简体中文](README.zh.md) ｜ [🇹🇭 ไทย](README.th.md)

![X Collector hero image: a woman reads a printed newspaper woven from streams of collected posts — "One information base, read by people and agents alike."](assets/hero.jpg)

<h4>Free, open-source software you run on your own computer or server —<br>it turns scattered AI and tech updates into one daily newspaper and one searchable feed.</h4>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql)
[![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)
[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20WSL2-lightgrey)

[What it does](#what) ｜ [What you need](#requirements) ｜ [Get started](#start) ｜ [Why you can trust it](#safety) ｜ [Learn more](#more)

Useful updates are scattered across social networks, specialist sites, and project pages,<br>
so keeping up means checking many places every day — and still missing the important context.<br>
X Collector gathers updates from the sources you choose, organizes and connects them,<br>
then delivers the same organized information to both people and AI agents.

**Stop making the rounds — your news arrives already organized.**

🔧 [Engineering guide](docs/engineering.md) ｜ 📘 [Reference](docs/reference.md)

</div>
<!-- repo-state:begin (generated; do not edit) -->
<p align="center"><sub>generation: <code>2fa4a21</code> (2026-09-05T04:00:00Z) · verify: <a href="https://api.github.com/repos/caty-ai/x-collector/commits/main">API HEAD</a> · <a href="./status.json">status.json</a></sub></p>
<!-- repo-state:end -->

---

## Sound familiar?

If any of these ring a bell, X Collector was built for you.

- You follow AI news on X, Reddit, GitHub, and a dozen sites — and still miss big announcements
- Checking every source takes an hour a day, and much of it is the same story repeated
- You can't tell which of the accounts you follow are still worth following
- Your AI assistant can't answer "what happened this week?" from the sources *you* trust

The common cause is simple: **the news never arrives in one organized place.** X Collector takes over that gathering-and-sorting work.

---

<a id="what"></a>

## What it does

Four steps, always in this order.

```mermaid
flowchart LR
    A["① Collect<br/>from 8 source types"] --> B["② Organize<br/>classify and connect"]
    B --> C["③ Publish<br/>one daily newspaper"]
    C --> D["④ Serve<br/>people and AI agents"]
```

- 📥 **Collect**

  Gathers updates from X (Twitter), Instagram, Facebook, Reddit, Qiita, GitHub, and RSS/YouTube feeds. You choose every source.

- 🗂️ **Organize**

  Sorts every item into categories, links duplicates and follow-up stories, and scores how trustworthy each source has been lately.

- 📰 **Publish**

  Lays the selected stories out as a 13-section newspaper, every day, automatically.

- 🤖 **Serve people and AI together**

  You read the newspaper and the searchable feed on the web; your AI agents read exactly the same data through an API and an MCP server (a standard way for AI tools to connect).

- ✅ **Keep humans in charge**

  It can suggest promising new sources it discovered, but nothing joins your collection without your explicit approval.

---

<a id="requirements"></a>

## What you need

Three things. The full compatibility table is in the [engineering guide](docs/engineering.md#supported-environments).

- **A place to run it** — your own computer or a server, with Node.js 20 or newer
- **A PostgreSQL database** — where the collected items are stored
- **API keys, only for the features you use** — see the table below

| What you want to do | What it needs |
|---|---|
| Sign in to the web interface | Google OAuth credentials (free) + the e-mail addresses allowed to sign in |
| Collect from X, Instagram, Facebook, Reddit | A [ScrapeCreators](https://scrapecreators.com/) key |
| Classify with AI and compose the newspaper | An [OpenRouter](https://openrouter.ai/) key |
| Add YouTube transcripts to stories | A [TranscriptAPI](https://transcriptapi.com/) key (optional) |
| Collect from Qiita, GitHub, RSS | No key required |

About money: Google OAuth is required for signing in, but it is free — it is a login method, not a paid API. ScrapeCreators and OpenRouter are paid, pay-as-you-go services; check their sites for current pricing. Without any paid key, the app starts, you can sign in, and keyless sources can be collected — the AI steps (classification and the daily newspaper) stay off until you add an OpenRouter key. You can add keys later, one at a time.

---

<a id="start"></a>

## Get started

### Ask an AI agent to install it

If you use an AI coding agent (Claude Code, Codex CLI, and similar tools), the fastest path is to hand it the repository:

```text
Set up https://github.com/caty-ai/x-collector on this machine.
Use .env.example to walk me through the settings I need.
```

The agent clones, installs, and asks you only for the values it cannot decide for you, such as the database address and sign-in keys. If you cannot answer one of those questions, just say so — preparing the PostgreSQL database and setting up Google OAuth are also things the agent can walk through with you.

### Install it yourself

Step 1 — download and install:

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

Step 2 — open `.env` in any text editor and fill in the required values. The first six are for the database and sign-in; the last two make the feed and newspaper screens work:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000

# Google accounts allowed to sign in (comma-separated).
# If left empty, nobody can sign in.
ADMIN_EMAIL_ALLOWLIST=you@example.com

# For a single local install, point the app at itself
# and make up your own long random key
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

Step 3 — start it:

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`, sign in, and register your sources under `/settings`. To try it right away with sample sources instead, run `npm run seed` once. When your collector keys are ready, open a second terminal window and run a collection with `npm run collect`.

<details>
<summary>If something goes wrong</summary>

<br>

**`command not found: npm`**

Node.js is not installed yet. Download it from [nodejs.org](https://nodejs.org/) (version 20 or newer), then reopen your terminal and try again.

**The database connection fails**

Make sure PostgreSQL is running and that the `DATABASE_URL` user, password, and database name actually exist. Creating a database named `x_collector` first is the most common missing step.

**Google sign-in shows an error**

Google OAuth credentials are created for free in the [Google Cloud Console](https://console.cloud.google.com/) (APIs & Services → Credentials → Create credentials → OAuth client ID). Check that `NEXTAUTH_URL` matches the address you opened in the browser, and that the OAuth redirect URI registered on Google Cloud is `http://localhost:3000/api/auth/callback/google`.

**Google sign-in says `AccessDenied`**

Your Google account is not on `ADMIN_EMAIL_ALLOWLIST`. Add the primary address shown on myaccount.google.com (a Gmail dot or plus variant counts as a different address), then restart the app.

</details>

---

<a id="safety"></a>

## Why you can trust it

X Collector is designed so that automation never quietly takes over.

- **You approve every new source** — discovered candidates are scored and presented, but only a person can promote them
- **Manually added sources are never auto-stopped** — automatic retirement only ever applies to sources the system itself discovered, and only after two consecutive weekly checks
- **Source quality is scored every day** — trust scores shape the newspaper's ranking, and stories from low-trust or unverified sources carry a warning badge instead of being silently treated as reliable
- **Agent access is read-only** — the MCP server can search and read, never change anything
- **The newspaper is private by default** — only people you allow can read it; opening it to the public is an explicit switch you turn on yourself
- **Your data stays yours** — it runs on your own server and your own database, under the MIT license

## Project status

[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)

- **CI**: the badge above is live — vitest + TypeScript checks on every pull request and every push to main
- **Verified environments**: push-to-main CI pins Node.js 20 on Ubuntu and macOS; the pull-request gate uses the runner default Node.js (currently 22+)
- **Maturity**: core pipeline in daily production use; actively maintained
- **Known constraints**: collectors that talk to external platforms need your own API credentials and are not exercised by CI

Run the checks yourself: `make test` / `make lint` (wraps `npm test` and the TypeScript checks — see [CONTRIBUTING](CONTRIBUTING.md)).

---

<a id="more"></a>

## Learn more

Community source catalog and contribution guide: [docs/community-sources.md](docs/community-sources.md) — entries are suggestions and are never auto-subscribed.

Entrances by purpose.

| What you want to know | Where to look |
|---|---|
| How it works: architecture, full setup, operations (for engineers) | [docs/engineering.md](docs/engineering.md) |
| Exact specifications: environment variables, APIs, MCP tools | [docs/reference.md](docs/reference.md) |
| Every setting, schedule, and operational detail in one place | [docs/operations.md](docs/operations.md) (Japanese) |
| How to contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| How to report a bug or vulnerability | [SECURITY.md](SECURITY.md) |

<!-- family:generated:family-footer:start -->

---

Part of the **Caty AI family** — open tools for running a family of AI agents. The full map, including modules still being prepared for release, lives in [Family OS](https://github.com/caty-ai/family-os).

| Axis | Module | What it does | State |
| --- | --- | --- | --- |
| Map | [Family OS](https://github.com/caty-ai/family-os) | The map of the whole family — every module, its state, and how they fit | published, MIT |
| Rules | [Family Dev Handbook](https://github.com/caty-ai/family-dev-handbook) | The rules of the road — issues, PRs, worktrees, handoffs, parallel development | published, MIT |
| Vertical · foundation | [Caty Agent Harness](https://github.com/caty-ai/caty-agent-harness) | Task backbone for AI agents — retries, checkpoints, and honest completion | published, MIT |
| Vertical | [context-kit](https://github.com/caty-ai/context-kit) | Six-piece context hygiene kit for one agent — bounded output, delegation briefs, safety guards, recall, worktree snapshots | published, MIT |
| Vertical | [Persona Engine](https://github.com/caty-ai/persona-engine) | Layers relationship and emotion onto an agent's existing persona | published, MIT |
| Vertical | [Persona Growth Loop](https://github.com/caty-ai/persona-growth-loop) | Grows the persona itself — minimal, idempotent proposals | published, MIT |
| Vertical | **X Collector** | Turns X and the web into one daily digest — for people and agents | published, MIT |
| Vertical | [Self Growth Loop](https://github.com/caty-ai/self-growth-loop) | Lets an agent grow its own abilities — proposals, governance, adoption records | published, MIT |
| Horizontal · foundation | [Family Memory Architecture](https://github.com/caty-ai/family-memory-architecture) | The memory bus — how the family shares what it knows | published, MIT |
| Horizontal | [Sitter](https://github.com/caty-ai/sitter) | Babysits delegated agent runs — watches, keeps evidence, restarts only within declared bounds | published, MIT |
| Horizontal | [Alpha Nightshift](https://github.com/caty-ai/alpha-nightshift) | Nightly autonomous maintenance loop — isolated night lanes behind a deny-by-default guard; humans cherry-pick in the morning | published, MIT |

<!-- family:generated:family-footer:end -->

---

## Acknowledgments

X Collector stands on these services: [ScrapeCreators](https://scrapecreators.com/) (social collection APIs), [OpenRouter](https://openrouter.ai/) (AI classification and newspaper composition), [Qiita API v2](https://qiita.com/api/v2/docs), [GitHub REST API](https://docs.github.com/en/rest), [Railway](https://railway.com/) (hosting), and [TranscriptAPI](https://transcriptapi.com/) (YouTube transcripts).

---

## License

[MIT](LICENSE) © 2026 Sho Jikumaru

We want anyone to use X Collector freely — run it, modify it, and build it into your own products. As long as the copyright notice stays, commercial use and redistribution are both welcome.

---

<div align="center">

**One newspaper a day** ｜ **8 source types** ｜ **For people and AI agents**

</div>
