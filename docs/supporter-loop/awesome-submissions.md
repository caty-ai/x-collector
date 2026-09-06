# Awesome-list submissions — preparation and record

候補リストの調査、受入条件の照合、投稿用原稿をまとめた文書です。
送信は EPIC #119 のチェックポイント⑤で、承認コメント後にオーナー本人の GitHub アカウントから行います。
この差分では送信せず、未確認・不適合の条件が残る候補は保留します。
送信後の URL と結果は第5節へ記録してください。

## 1. Purpose and rules

[Issue #122](https://github.com/caty-ai/x-collector/issues/122) is child #4 of [EPIC #119](https://github.com/caty-ai/x-collector/issues/119), the last playbook item: prepare relevant listings and record outcomes.
- Sending is checkpoint ⑤, owner only, from the owner's own GitHub account after an approval comment on EPIC #119; put that approval URL in EPIC table row 5.
- One target and one item per PR. No automated sending, bot submissions, or contact in this preparation lane.
- [CONTRACT §0](CONTRACT.md#0-design-invariants-frozen): thank, never ask for stars, shares, or follows. PR text must contain no personal-account URLs, e-mail addresses, or maintainer mentions.
- Listing x-collector elsewhere changes nothing in the reward loop. This file changes no reward, detection, credential, or workflow contract (CONTRACT §0 invariants untouched).
- Do not add `🤖🤖🤖` unless the owner explicitly opts into punkpeye's agent-authored fast-track; no such marker or generated-by footer is included in the paste blocks.
- Awesome-selfhosted's exact rule is: “Machine/LLM-generated contributions, that do not respect project guidelines are not allowed and will result in a ban.” (`S/CONTRIBUTING.md`, Other guidelines.) This is conditional, not a blanket ban; the owner must personally verify compliance before sending.

Evidence snapshot: Alpha's read-only packet dated **2026-09-06**, rooted at `.omc-brief/research/` (local review evidence, not published with this document). Aliases: `F` = `x-collector-facts/facts.md`; `P` = `punkpeye_awesome-mcp-servers`; `S` = `awesome-selfhosted_awesome-selfhosted-data`; `W` = `wong2_awesome-mcp-servers`; `M` = `modelcontextprotocol_servers`; `A` = `appcypher_awesome-mcp-servers`; `E` = `e2b-dev_awesome-ai-agents`; `G` = `awesome-selfhosted_awesome-selfhosted`.
`PASS` means evidenced now; `FAIL` includes unverified required conditions (not a claim of proven noncompliance); `N/A` means inapplicable. “Ready” is preparation readiness, always subject to checkpoint ⑤ and refreshed duplicate/link checks.

## 2. Survey

All counts and push dates below are from the corresponding packet `meta.json`; PR activity is a snapshot, not a promise of acceptance.

| Repo | Stars | Last push (UTC) | Accepts additions? | Verdict | Reason / packet evidence |
|---|---:|---|---|---|---|
| punkpeye/awesome-mcp-servers | 94,354 | 2026-09-01 | Yes | selected | Server additions invited; six sampled merges on Aug 29 (`P/CONTRIBUTING.md`, `P/merged-prs.tsv`). |
| awesome-selfhosted/awesome-selfhosted-data | 1,126 | 2026-09-06 | Yes, conditional | deferred | Release age and eligibility checks remain (`S/PULL_REQUEST_TEMPLATE.md`, `S/CONTRIBUTING.md`). |
| awesome-selfhosted/awesome-selfhosted | 317,398 | 2026-09-05 | Via data repo | rejected | Generated output, not submission destination (`S/README.md`). |
| wong2/awesome-mcp-servers | 4,292 | 2026-07-13 | Template exists; activity uncertain | deferred | Sponsor-only recent commits; empty open/all PR samples (`W/recent-commits.tsv`, `W/recent-prs.tsv`, `W/open-pr-count.txt`). |
| modelcontextprotocol/servers | 90,105 | 2026-09-03 | No new listings/implementations | rejected | Third-party list retired for Registry (`M/CONTRIBUTING.md`). |
| appcypher/awesome-mcp-servers | 5,765 | 2026-05-06 | No, archived | rejected | `archived: true` (`A/meta.json`). |
| e2b-dev/awesome-ai-agents | 29,895 | 2026-08-21 | Agent additions | rejected | Autonomous-agent scope; x-collector is a data source/server (`E/meta.json`, `F`); sampled last content addition Jul 9 (`E/merged-prs.tsv`). |

MCP Server Registry (`registry.modelcontextprotocol.io`) is a separate, out-of-scope publication lane, not an awesome-list PR (`M/CONTRIBUTING.md`).
Packet correction: `P/open-pr-count.txt` is **200** (the listing was capped at 200, so the true count is at least 200), not four; sampled merges establish activity on Aug 29, not daily activity.

## 3. Selected targets (three prepared; two deferred)

Current baseline: MIT, created 2026-08-02, latest release v0.4.4 on 2026-09-05, 232 commits in 30 days (`F`). Node.js **>=20.3**, PostgreSQL, no Dockerfile/Compose (`F`). MCP is read-only Streamable HTTP at `/api/mcp/mcp`, with `search_feed` and `get_daily_news` (`docs/reference.md:38`).
Paste bodies link the dedicated MCP document (`docs/mcp-server.md`); `docs/reference.md` has no `#mcp` anchor, so it is not linked. Verify every link at send time.

### 3.1 punkpeye/awesome-mcp-servers

Destination: `README.md`, **Search & Data Extraction** (`#search`). News search belongs here (`P/category-index.txt`, `P/sample-search-section.md`); Aggregators integrates many apps/tools (`P/sample-aggregators-section.md`). Sort by owner/repository, key `caty-ai/x-collector`, among the C owners; `P/example-pr-13054.md` and `.diff` establish owner order. Live check 2026-09-06 (reviewer seats, read-only): the section is not strictly sorted; `caty-ai/x-collector` goes after `capad-xyz/searchts` and before `cevatkerim/unsplash-mcp`. Re-check neighbors at send time.

| Written rule (`P/CONTRIBUTING.md`) | Status | Evidence / application |
|---|---|---|
| Fork the repo | N/A | Owner action at checkpoint ⑤, §4; `P/CONTRIBUTING.md` step 1. |
| Create a descriptive branch | N/A | Owner action, suggested `add-x-collector`; `P/CONTRIBUTING.md` step 2. |
| Edit README; linked server name | PASS | §3.1 entry links the public repo; `F` visibility PUBLIC. |
| Brief functionality description | PASS | §3.1 entry describes the two read-only tools; `docs/reference.md:38`. |
| Relevant category; alphabetize new categories | PASS | Existing Search & Data Extraction; `P/category-index.txt`, `P/sample-search-section.md`. |
| Clear commit message; push fork; open titled/described PR | N/A | Owner actions, §4; title/body below; `P/CONTRIBUTING.md` steps 4–6. |
| Maintainer review / clarification | N/A | Post-send owner action; `P/CONTRIBUTING.md` step 7. |
| Consistent formatting/capitalization/punctuation | PASS | Single-line format below matches `P/example-pr-13054.diff`. |
| Alphabetical order within category | FAIL (verify at send time) | Sort key and live neighbors above; the exact line position is only decidable against the section as it stands when the owner edits it. |
| Accurate, current information; double-check links | PASS | Functionality verified in `docs/reference.md:38`, environment in `F`; live link check remains checkpoint ⑤. |
| One server per line | PASS | One entry below, per `P/CONTRIBUTING.md`, Guidelines. |
| Concise, informative key features | PASS | Search and daily news only; `docs/reference.md:38`. |
| Agent fast-track opt-in | N/A | Optional in `P/CONTRIBUTING.md`; owner has not opted in. |

Legend (`P/legend.md`): 📇 TypeScript (`F`, MCP `.ts` source paths); ☁️ because the maintained public instance is hosted (Railway badge in `README.md`) and its MCP endpoint is reached as a remote Streamable HTTP service (`docs/mcp-server.md`); 🏠 because the same server can run on your own computer or server against a local database (`F`). Both badges together are common practice in this list (attested peers in the Search section). No OS emoji: the legend's 🍎/🪟/🐧 mean OS-specific servers, and a web service tested on macOS/Linux CI is not one. No official-implementation badge.
Exact entry:
```markdown
- [caty-ai/x-collector](https://github.com/caty-ai/x-collector) 📇 ☁️ 🏠 - Read-only MCP server for searching collected AI and tech updates and retrieving daily news editions.
```
PR title:
```text
Add caty-ai/x-collector to Search & Data Extraction
```
PR body (short factual structure follows `P/example-pr-12966.md`):
```markdown
Adds x-collector to Search & Data Extraction, alphabetically by owner/repository.

The read-only Streamable HTTP MCP server exposes search_feed and get_daily_news at /api/mcp/mcp for collected AI and tech updates and daily news editions.

- Repository: https://github.com/caty-ai/x-collector
- MCP endpoint, authentication and tools: https://github.com/caty-ai/x-collector/blob/main/docs/mcp-server.md
- Specification index: https://github.com/caty-ai/x-collector/blob/main/docs/reference.md

Thank you for reviewing this addition.
```
Ready to send: **YES** (blocker: none for preparation; the line position is fixed at edit time per §4 step 2, and owner approval plus the send-time checks are still required). Priority: **1**.

### 3.2 awesome-selfhosted/awesome-selfhosted-data

Destination: **`software/x-collector.yml` in the data repo**, category **Feed Readers**. No Markdown insertion: filename sorts under `x`; generated category ordering is upstream's responsibility (`S/README.md`, `S/CONTRIBUTING.md`).
First Release **v0.1.0 was published 2026-08-08T01:31:01Z** (verified live from the Releases API by two reviewer seats on 2026-09-06; `F` holds only the latest five releases). Four calendar months gives **2026-12-08**; re-confirm that more than four months have elapsed before opening.

| Written rule (`S/CONTRIBUTING.md`, PR template, `addition.md`) | Status | Evidence / application |
|---|---|---|
| One item per PR | PASS | One YAML entry below; `S/PULL_REQUEST_TEMPLATE.md`. |
| Search relevant issues and PRs, including closed | FAIL | `S/merged-prs.tsv` is a sample, not an exhaustive duplicate search; verify at send time. |
| Not already in awesome-sysadmin / staticgen / staticsitegenerators / dbdb | FAIL | Those catalogs are absent from packet; `S/PULL_REQUEST_TEMPLATE.md` requires checking them. |
| Required YAML fields / schema | PASS | Structure follows `S/addition.md`; `Nodejs` platform, `MIT` license and `Feed Readers` tag all exist upstream (live check 2026-09-06). |
| Interactive demo and direct credentials if needed | N/A | No demo field supplied; optional in `S/addition.md`. |
| Remove comments / unused optional fields | PASS | YAML below follows `S/addition.md`; only needed third-party flag retained. |
| Kebab-case file under software | PASS | `software/x-collector.yml`, per `S/CONTRIBUTING.md`. |
| Platforms match runtime | PASS | `F`: Node >=20.3 + PostgreSQL. Upstream has `platforms/nodejs.yml` and no PostgreSQL platform (live check 2026-09-06), so `Nodejs` is the only valid value; the database is named in the PR body. |
| Actively maintained | PASS | `F`: 232 commits in last 30 days; v0.4.4 published 2026-09-05. |
| First released more than four months ago | FAIL | Until 2026-12-08 at earliest, computed above; original release absent from `F`. |
| Working installation instructions | FAIL | Instructions exist (`README.md:108`); packet `F` supplies requirements, not a reproduced installation. Owner must test. |
| Understand merge at least ~one week after approval | N/A | Owner acknowledgement pending; `S/PULL_REQUEST_TEMPLATE.md`. |
| Descriptive commit; new branch; propose file; create PR | N/A | Checkpoint ⑤ owner actions; `S/CONTRIBUTING.md`, Add software. |
| First tag controls single-page category | PASS | Feed Readers exists (`S/related-tags.txt`, exact name `S/sample-miniflux.yml`). |
| Description <250 chars, sentence case, short; no redundant open-source/free/self-hosted terms | PASS | 131-character description below; `S/addition.md`, Other guidelines. |
| Non-English docs need language suffix | N/A | English README/reference available (`F`, `docs/reference.md:1`). |
| Alternative-to claim needs suffix | N/A | No alternative-to claim in entry below; `S/CONTRIBUTING.md`, Other guidelines. |
| Fork needs differences and fork-of suffix | FAIL | `F` omits fork metadata; verify provenance before deciding applicability. |
| Single static binary needs source language | N/A | Node runtime required (`F`), not a static binary distribution. |
| Machine/LLM contributions must respect guidelines | FAIL | Exact rule §1; outstanding checks above prevent compliance claim (`S/CONTRIBUTING.md`). |
| No dependency on a specific cloud provider | FAIL | Required Google OAuth; AI requires OpenRouter (`F`); eligibility conflict needs resolution, not merely a flag. |
| Not a desktop/mobile/CLI app requiring separate sync server | PASS | Web app and PostgreSQL (`F`, README web access/requirements). |
| Not library/SDK needing application code | PASS | Runnable end-user app with setup instructions (`F`, `README.md:108`). |
| Not PaaS/serverless platform | PASS | Collected-feed/news application (`F` repo description). |
| Not generic container/deployment/virtualization tool | PASS | Collected-feed/news application (`F` repo description). |
| Not merely a port/Dockerization | FAIL | No Dockerfile (`F`), but project provenance absent; verify at send time. |
| Curation: development within 6–12 months | PASS | 232 commits in 30 days (`F`). |
| Curation: working software | FAIL | `F` has no full installation/runtime validation; owner test required. |
| Curation: maintained or active community | PASS | Maintained per `F` commit activity; no independent community-size claim. |
| Curation: no persistent serious security issues | FAIL | Security issue history absent from packet; `S/CONTRIBUTING.md` requires this. |
| New tag/license/platform; removal/rename rules | N/A | Existing values intended; no metadata additions/removals planned (`S/addition.md`); verify MIT catalog identifier at send time. |

Complete candidate YAML. Live check 2026-09-06 (reviewer seats, read-only): upstream `platforms/` has `nodejs.yml` and **no PostgreSQL platform file**, so `platforms` lists `Nodejs` only and the database requirement is stated in the PR body; `licenses.yml` contains `MIT`. Do not add a platform file and do not substitute Docker.
`depends_3rdparty: true` is required because Google OAuth sign-in and OpenRouter AI processing depend on external services (`F`); it does not waive the cloud-provider exclusion.
```yaml
name: X Collector
website_url: https://github.com/caty-ai/x-collector
source_code_url: https://github.com/caty-ai/x-collector
description: Collect AI and tech updates into a searchable feed and daily newspaper, with read-only MCP access for search and edition retrieval.
licenses:
  - MIT
platforms:
  - Nodejs
tags:
  - Feed Readers
depends_3rdparty: true
```
PR title:
```text
Add X Collector
```
PR body (template checklist retained; the awesome-sysadmin link rendered as plain text to keep publication URLs within the declared set):
```markdown
Adds software/x-collector.yml under Feed Readers.
X Collector collects AI and tech updates into a searchable feed and daily newspaper. Its MCP endpoint is read-only, exposing search_feed and get_daily_news.
- Repository: https://github.com/caty-ai/x-collector
- MCP documentation: https://github.com/caty-ai/x-collector/blob/main/docs/mcp-server.md
Requires Node.js >=20.3 and a PostgreSQL database; MIT licensed; no Docker distribution. Google OAuth sign-in and OpenRouter AI steps require third-party services.

Thanks for taking the time to suggest an addition to awesome-selfhosted!

To ensure your Pull Request is dealt with swiftly, please check the following (check the boxes `[x]`):
- [x] Submit one item per pull request. This eases reviewing and speeds up inclusion.
- [ ] You have searched the repository for any relevant [issues](https://github.com/awesome-selfhosted/awesome-selfhosted-data/issues) or [PRs](https://github.com/awesome-selfhosted/awesome-selfhosted-data/pulls), including closed ones.
- [ ] Any software you are adding is not already listed at any of awesome-sysadmin, [staticgen.com](https://www.staticgen.com/), [staticsitegenerators.bevry.me](https://staticsitegenerators.bevry.me/), [dbdb.io](https://dbdb.io/browse).
- [ ] The file you are adding is formatted as described in [addition.md](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/.github/ISSUE_TEMPLATE/addition.md).
- [ ] `Demo` links should only be used for interactive demos, i.e. not video demonstrations. If login credentials are required to access the demo, please link to the credentials directly.
- [x] Comments and unused optional fields have been removed.
- [x] The file you are adding uses [kebab-case](https://en.wikipedia.org/wiki/Letter_case#Kebab_case) file naming, for example `my-awesome-software.yml`.
- [ ] Values for `platform` should match the platforms required to install and run the software.
- [x] Any software project you are adding to the list is actively maintained.
- [ ] Any software project you are adding was first released more than 4 months ago.
- [ ] Any software project you are adding has working installation instructions.
- [ ] You understand that your Pull Request will be merged at least ~1 week after approval, depending on maintainers time.
```
Ready to send: **NO** (blocker: open only on/after 2026-12-08 — v0.1.0 was published 2026-08-08T01:31:01Z, verified live by two reviewer seats on 2026-09-06; the cloud-provider exclusion, provenance, security, duplicate and install checks must be resolved first, and the date alone resolves none of them). Priority: **2**. The template boxes left unchecked above are ticked by the owner at send time only once each check has actually been done.

### 3.3 wong2/awesome-mcp-servers

Destination: `README.md`, **Community Servers**; sort by display name **X Collector**, among X entries. Exact neighbors cannot be inferred from the A-only `W/sample-community-section.md`.

| Written rule / format | Status | Evidence / application |
|---|---|---|
| Place new server alphabetically | FAIL | `W/pull_request_template.md`; X insertion key known, but current X neighbors absent from `W/sample-community-section.md`. |
| Community entry format | PASS | Bold linked name below follows `W/sample-community-section.md`; functionality `docs/reference.md:38`. |
Exact entry:
```markdown
- **[X Collector](https://github.com/caty-ai/x-collector)** - Read-only MCP server for searching collected AI and tech updates and retrieving daily news editions.
```
PR title:
```text
Add X Collector
```
PR body:
```markdown
Adds X Collector to Community Servers, with insertion by display name under X.
Its read-only Streamable HTTP MCP endpoint exposes search_feed and get_daily_news for collected AI and tech updates and daily news editions.
- Repository: https://github.com/caty-ai/x-collector
- MCP documentation: https://github.com/caty-ai/x-collector/blob/main/docs/mcp-server.md

- [ ] Place the newly added server in the right position alphabetically.

Thank you for reviewing this addition.
```
Ready to send: **NO** (blocker: hold / low priority; owner must confirm active intake and alphabetical placement). Priority: **3**.
Evidence: `W/recent-commits.tsv` shows only sponsor changes Jun 13–Jul 13; `W/recent-prs.tsv` and `W/merged-prs.tsv` are empty, `W/open-pr-count.txt` is zero. This suggests dormancy, not proof that additions are forbidden.

## 4. Checkpoint ⑤ procedure

1. Owner reads this file, the current target rules and CONTRACT §0 and §15; use only targets whose blockers are resolved.
2. Owner refreshes duplicate searches (entries, open/closed PRs and issues), link validity, alphabetical neighbors, and factual checks; test installation where required. Resolve deferred checks and update this preparation document before approval; leave N/A boxes unchecked.
3. Owner posts an approval comment on EPIC #119 naming the target and prepared revision; put its URL into EPIC table row 5. No approval URL is fabricated here.
4. From the owner's own GitHub account, fork the target, create a descriptive branch, and edit only its specified file/section with the exact entry; use a clear commit message. Never target the generated selfhosted Markdown repo.
5. Owner opens one PR per target, pasting the approved title and body from §3 verbatim, then ticks any template checkbox whose check the owner has actually completed. No automated sending; fast-track requires separate explicit owner opt-in.
6. Owner pastes each PR URL and sent date into §5; mark pending, then accepted/rejected when known.
7. On rejection, record the reason verbatim, do not argue; resubmit only after a stated blocker is cleared. Redact prohibited personal data from the public log, noting the redaction; retain the exact reason in the owner's private record.
8. Record outcomes in this lane's follow-up PR to `epic/119` or `main`; include the approval reference in EPIC row 5. An empty log means nothing has been sent.

## 5. Result log

| Target | PR URL | Sent (date) | Result (accepted / pending / rejected) | Reason / notes |
|---|---|---|---|---|
| punkpeye/awesome-mcp-servers | — | — | — | — |
| awesome-selfhosted/awesome-selfhosted-data | — | — | — | — |
| wong2/awesome-mcp-servers | — | — | — | — |

## 6. Deferred / rejected

- **2026-12-08:** re-check awesome-selfhosted's first-release publication timestamp, maintenance, cloud-provider exclusion, catalogs/platforms, provenance, security and working installation. Four months is a minimum re-check date, not automatic permission to send.
- Wong2 stays on hold until the owner verifies intake and exact placement; the snapshot does not establish active review.
- Generated awesome-selfhosted, archived appcypher, and autonomous-agent e2b-dev are rejected for the reasons in §2.
- MCP Server Registry remains a separate lane requiring its own preparation/approval; do not submit to `modelcontextprotocol/servers`.
