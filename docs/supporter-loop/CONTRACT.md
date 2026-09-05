# Supporter Reward Loop — contract (v1) — FROZEN INTERFACES

Status: **freeze candidate v1.2** (v1.0 → v1.2: design-review rounds 1–2 folded in; see the changelog) for caty-ai/x-collector#120 (child #0 of EPIC caty-ai/x-collector#119). Once the design review (five heterogeneous seats, E-6①) reaches GO and this file is merged into `epic/119`, every section marked **[frozen]** may change only through a new contract issue that bumps `contract_version` (and, where noted, the ledger `schema`). Changing a frozen section is a *contract-level deviation* and stops the Epic at human checkpoint #7 (EPIC #119, E-3).

Companions: EPIC caty-ai/x-collector#119 (why, tiers at a glance, human checkpoints) · child #1 caty-ai/ask-ai-widget#9 (reward repo) · child #2 caty-ai/.github#75 (central workflow) · child #3 caty-ai/x-collector#121 (caller + README) · child #4 caty-ai/x-collector#122 (awesome lists). Entry page: [README.md](README.md).

Wording: MUST / MUST NOT / SHOULD / MAY as in RFC 2119. "Source repo" = the public repo whose activity is rewarded (v1: `caty-ai/x-collector`). "Reward repo" = the private repo supporters are invited to (v1: `caty-ai/ask-ai-widget`). "Central workflow" = the reusable workflow in `caty-ai/.github`. "Caller" = the thin workflow in the source repo. "Actor" = the person being thanked: for `watch` the `sender`, for `issues` the Issue author (`issue.user`), for `discussion` the Discussion author (`discussion.user`), and for `pull_request_target` the **PR author** (`pull_request.user`) — never the merger. `github.actor` / `sender` MUST NOT be used for `pull_request_target`. Actor identity is the numeric `user.id` (`actor_id`); the login is display data.

---

## 0. Design invariants [frozen]

1. **Thanks, not solicitation.** Every message and artifact is a thank-you for something already done. Nothing asks for a Star, a share, or a follow. Copy that violates this is a contract violation, not a style issue.
2. **GitHub-native delivery only.** The only outbound channels are (a) a repository collaborator invitation to the reward repo and (b) a comment on the actor's own Issue / PR in the source repo. No e-mail, no DM, no third-party API is ever called with the actor as recipient. (Telegram is an *owner-side* notification, §9, never a supporter-facing channel.)
3. **Record-only first.** The central workflow ships and runs in `mode: record-only` (§5). Switching to `live` is human checkpoint #4 of EPIC #119 and requires an owner approval comment; the switch is a one-word change in the caller (§4.3) and nothing else.
4. **Least privilege, two single-purpose credentials.** Exactly two long-lived credentials exist (§8), both scoped to the reward repo only and never used against the source repo: `SUPPORTER_LEDGER_TOKEN` (Contents only — ledger and `SUPPORTERS.md`) and `SUPPORTER_LOOP_TOKEN` (Administration — invitations and revokes). The Administration-capable token is loaded **only** by the `act` job, which does not run in `record-only` (§4.4). Supporter-facing comments use the caller's `GITHUB_TOKEN`.
5. **Ledger is the source of truth.** Every decision — including "did nothing" — is one NDJSON line (§6). `SUPPORTERS.md` and every report are derived from the ledger, never the other way round.
6. **Idempotent by construction.** A supporter receives each reward at most once per generation (§7). Re-delivered webhooks, re-runs, and duplicate events are safe.
7. **Family and bots are excluded.** Accounts in the family roster (§3.2) and bot accounts never receive rewards and never appear in `SUPPORTERS.md`.

---

## 1. Versioning and freeze rules [frozen]

- Versioned surfaces: `contract_version` (this document; integer, v1 = `1`), ledger `schema` (§6; integer, v1 = `1`), the reusable workflow's `workflow_call` interface (§4), the secret names (§8), the ledger location (§6.1), and the comment marker prefix `supporter-loop:` (§10).
- Ledger readers MUST ignore unknown fields and MUST NOT drop lines whose `schema` is higher than they understand (deliver verbatim, annotate).
- Adding an optional input with a default, an optional ledger field, or a new `action` value in the *record-only* vocabulary is not a bump. Renaming or removing an input/secret/field, changing a type, changing `dedup_key` construction, adding an `action` to the *live* vocabulary, or moving the ledger is a bump and re-opens the design review.
- Anything not described here is undefined and MUST NOT be relied on by another child issue.

---

## 2. Tier definitions [frozen]

Tiers are **cumulative** in *entitlement*: reaching tier N grants everything from tiers 1..N. Delivery is per tier and idempotent (§7); reaching tier 3 directly (first contact is a merged PR) delivers tiers 1, 2 and 3 in one run.

| Tier | Trigger event (source repo) | Qualifying condition | Delivered | Decided in v1 |
|---|---|---|---|---|
| **1** | `watch` (`action: started`) | Actor not excluded (§3) | **Invitation to the reward repo** (collaborator with permission **`pull`** — the REST enum value; `act` MUST send `{"permission":"pull"}` on every `PUT`, because the platform default when the field is omitted is `push`) + **`SUPPORTERS.md` entry** (login + tier + date) + the **Supporter badge** (an image in the reward repo the supporter may embed; delivered implicitly by repo access) | yes |
| **2** | `issues` (`action: opened`) or `discussion` (`action: created`) | Actor not excluded (v1 has **no spam check**: a spam Issue earns tier 2 like any other; spam handling is an explicit non-goal of the sweep, §11, and is the owner's manual job — block the user, which also makes future invitations fail) | Tier 1 + **one thank-you comment** on that Issue / Discussion (§10) + `SUPPORTERS.md` tier updated to 2 | yes |
| **3** | `pull_request_target` (`action: closed`, `merged == true`) | Actor = PR author, not excluded | Tier 1 + 2 (comment goes on the merged PR) + `SUPPORTERS.md` tier updated to 3 + listing in the source repo's **Contributors wall** and **release notes** (both produced by child #3's `release.yml` from git history, not by the central workflow) | yes |
| Fork | `fork` | — | **Nothing.** Not even a ledger line (the caller does not subscribe to `fork`). | yes (no reward) |

### 2.1 Items deferred to a later contract version (decided: **後回し / deferred**)

The strategy note (alpha-wiki `supporter-reward-loop-strategy.md` §7) listed "one more repo invitation" for tier 2 and a "contributor repo invitation" for tier 3. v1 **defers both** and delivers tier 2 and 3 as in the table above.

- Why: the owner decided on 2026-09-05 that no new repository is created for this Epic and that the reward repo is `caty-ai/ask-ai-widget` only. A second private repo does not exist, so a second invitation has nothing to point at. Defining it now would freeze an interface to an artifact nobody owns.
- Exit trigger (re-opens this item as a contract bump, not silently): the owner names a second reward repo *or* the first early-access item rotates out (§12) and a second private repo becomes the natural place for the next one. Until then tier 2 and 3 add **recognition** (comment, tier label, wall, release notes), not further access.
- Consequence for §8: both tokens' repository access stays a single repo. If the deferral is lifted, §8 is bumped and human checkpoint #2 (token issuance) is repeated for the new scope.

### 2.2 Downgrade

Tiers never decrease. Unstarring after tier 2 or 3 is reached does not revoke anything. Unstarring at tier 1 is handled by the weekly sweep (§11).

---

## 3. Eligibility and exclusions [frozen]

### 3.1 Included

- Any GitHub user account (`type == "User"`) that performs a tier trigger on a source repo listed in the caller.

### 3.2 Excluded (no reward, no `SUPPORTERS.md` entry; ledger line with `action: skip`, `result: excluded-<reason>`)

| Reason code | Rule |
|---|---|
| `excluded-family` | `ascii-lower(login)` equals one of the tokens of the **family roster** (GitHub logins are case-insensitive; the compare is case-insensitive exactly as `external-input-watch.yml` does it). The roster is the single string already maintained in `caty-ai/.github` `external-input-watch.yml` (`fam_roster`, measured 2026-08-29). Child #2 MUST use the identical token set **and** the identical compare rule (copy is acceptable in v1 provided a comment in both files names the other as the twin and says "case-insensitive; identical token set"; a shared file is preferred if it exists by then). |
| `excluded-bot` | `type == "Bot"` or login ends with `[bot]`. |
| `excluded-self` | Actor equals the repository owner org's login or the workflow's own identity. |
| `excluded-org` | `type == "Organization"`. |
| `excluded-member` | On events that carry `author_association` (`issues`, `discussion`, `pull_request_target`) the value is `OWNER` or `MEMBER` — the same first-line check `external-input-watch.yml` applies; the roster stays as defense in depth. `watch` carries no association, so for `watch` the roster is the only check (the sweep MAY additionally drop roster members it finds in the ledger). |

### 3.3 Not an exclusion

- Prior tier already reached → this is a **dedup** (§7), recorded as `action: skip`, `result: already-<tier>`, not as an exclusion.
- Star from a fork's owner → eligible (fork is neutral, star is a star).

---

## 4. Reusable workflow interface [frozen]

### 4.1 Files

| Role | Repo | Path | Owner child |
|---|---|---|---|
| Central (reusable) workflow | `caty-ai/.github` | `.github/workflows/supporter-loop-reusable.yml` | #2 |
| Caller | `caty-ai/x-collector` | `.github/workflows/supporter-loop.yml` | #3 |

The central workflow file name, the `on: workflow_call` block below, and the `permissions` maps are the frozen surface. Step names and internal structure are child #2's.

### 4.2 `on: workflow_call` — inputs

```yaml
on:
  workflow_call:
    inputs:
      mode:
        description: "record-only | live. Anything else fails the run before any step touches the network."
        required: true
        type: string
      reward_repo:
        description: "owner/name of the private reward repo (ledger + invitations)."
        required: false
        type: string
        default: "caty-ai/ask-ai-widget"
      tiers_enabled:
        description: "Comma-separated subset of 1,2,3. Events for a disabled tier are ledgered as action=skip result=tier-disabled."
        required: false
        type: string
        default: "1,2,3"
      sweep:
        description: "true only from the scheduled sweep job (§11). Mutually exclusive with a tier event."
        required: false
        type: boolean
        default: false
    secrets:
      SUPPORTER_LEDGER_TOKEN:
        description: "Fine-grained PAT, reward_repo only, Contents R/W (§8). Used by decide (ledger) and act (SUPPORTERS.md). Required in both modes."
        required: true
      SUPPORTER_LOOP_TOKEN:
        description: "Fine-grained PAT, reward_repo only, Administration R/W (§8). Loaded only by the act job; may be left unset until checkpoint #4. act fails loud if empty in live."
        required: false
      TELEGRAM_BOT_TOKEN:
        description: "Owner notification bot (§9)."
        required: true
      TELEGRAM_CHAT_ID:
        description: "Owner notification chat (§9)."
        required: true
```

Rules:

- The four secrets above are the complete list (naming rule: `UPPER_SNAKE`, each with an explicit `required`, exactly as `external-input-watch.yml` does; `SUPPORTER_LOOP_TOKEN` is the only optional one, §8.1). A caller passing any other secret fails validation; `secrets: inherit` is forbidden (§4.3).

- `mode` MUST be validated as the **first** step. Any value other than the two literals fails the job with `::error::` and exit 1 before any `gh`/`curl` call.
- `inputs.*` are caller-controlled constants, never actor-controlled; they MAY be used in `${{ }}` expressions. Actor-controlled strings (login, title, body) MUST enter `run:` scripts only through `env:` or `$GITHUB_EVENT_PATH`, never inline via `${{ }}` (same invariant as `external-input-watch.yml`).
- The source repo is `github.repository` of the caller; there is no input for it.

### 4.3 Caller — frozen shape

```yaml
name: supporter-loop
on:
  watch:
    types: [started]
  issues:
    types: [opened]
  discussion:
    types: [created]
  pull_request_target:
    types: [closed]
  schedule:
    - cron: "17 3 * * 1"   # weekly sweep, Monday 03:17 UTC
permissions:
  contents: none
  actions: read          # sweep precondition: "no failed supporter-loop runs since last sweep" (§11)
  issues: write
  pull-requests: write
  discussions: write
# Load-bearing: serializes runs per source repo so two deliveries of the same
# event cannot both miss the comment marker (§7). Do not delete.
concurrency:
  group: supporter-loop-${{ github.repository }}
  cancel-in-progress: false
jobs:
  loop:
    uses: caty-ai/.github/.github/workflows/supporter-loop-reusable.yml@main
    with:
      mode: record-only          # <- the ONLY line that changes at checkpoint #4
      sweep: ${{ github.event_name == 'schedule' }}
    secrets:
      SUPPORTER_LEDGER_TOKEN: ${{ secrets.SUPPORTER_LEDGER_TOKEN }}
      SUPPORTER_LOOP_TOKEN: ${{ secrets.SUPPORTER_LOOP_TOKEN }}
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

This block is the **single copy** of the caller shape; §4.4 refers to it and does not restate the `concurrency` block.

- `secrets: inherit` is **forbidden** in the caller (same rule as `external-input-caller.yml`).
- `contents: none` is load-bearing under `pull_request_target` and MUST NOT be removed. The caller never checks out code.
- `discussions: write` is present only for the tier-2 thank-you comment on a Discussion (GraphQL `addDiscussionComment`). Repos without Discussions leave the `discussion` trigger as a no-op.
- The `@main` pin follows the org precedent (`external-input-caller.yml`): `caty-ai/.github` `main` is merge-only via reviewed PR.

### 4.4 Central workflow — jobs and permissions [frozen]

The central workflow MUST be split into two jobs so that *record-only cannot send* by construction:

| Job | Runs when | `permissions` | May use |
|---|---|---|---|
| `decide` | always | `contents: none`, `actions: read`, `issues: read`, `pull-requests: read`, `discussions: read` | `GITHUB_TOKEN` (read) · `SUPPORTER_LEDGER_TOKEN` (Contents only) in the steps that read/append the ledger (§6) · **never** `SUPPORTER_LOOP_TOKEN` (the secret is not referenced anywhere in this job) · **no** Telegram secrets (§9 is live-only) |
| `act` | `needs: decide` **and** `inputs.mode == 'live'` **and** `decide` produced at least one live action; its first step is the token preflight (§8.1) on which every other step depends | `contents: none`, `issues: write`, `pull-requests: write`, `discussions: write` | `GITHUB_TOKEN` (write, source repo comments) · `SUPPORTER_LOOP_TOKEN` (reward repo invitations / revokes) · `SUPPORTER_LEDGER_TOKEN` (`SUPPORTERS.md` and the ledger lines for the actions it executed) · Telegram secrets (§9) |

| `alert` | `needs: [decide, act]` **and** `failure()` **and** `inputs.mode == 'live'` | none (`permissions: {}`) | Telegram secrets only (§9) — one message naming the failed job and the run URL; no ledger, no PATs |

- The Administration-capable credential (`SUPPORTER_LOOP_TOKEN`) is referenced **only** inside `act`. A job-level `permissions` map restricts `GITHUB_TOKEN`, not a PAT — which is exactly why the PAT that can invite is kept out of the job that runs in `record-only`. Child #2's static check (below) MUST also fail if the string `SUPPORTER_LOOP_TOKEN` appears anywhere in the `decide` job.

**Who writes which ledger line** (§6):

| Line | Written by | When |
|---|---|---|
| every `would-*` line (record-only) | `decide` | after the decision, before the job ends |
| every `skip` line (both modes) | `decide` | same |
| every live-vocabulary line (`invite`, `comment`, `supporters-append`, `revoke`, `cancel-invite`) | `act` | **after** the corresponding API call returned (never before; §5.2) |

- In `record-only`, the `act` job is **skipped by its `if:`**; the run log therefore shows `act` as skipped for every record-only run. That log line, the ledger check, and the GitHub-side audit (§5.3) together are the proof required by EPIC #119 Done-when.
- `decide` never issues a **write** (`PUT`, `POST`, `PATCH`, `DELETE`) to any endpoint under `/collaborators`, `/invitations`, `/comments`, `/contents/SUPPORTERS.md`, nor the GraphQL mutation `addDiscussionComment`. Reads (`GET`, GraphQL queries) of those resources are allowed in `decide` (the marker search and the audit need them). Child #2's CI MUST enforce this statically: a script that extracts the `decide` job's `run:` blocks and fails if (a) the string `SUPPORTER_LOOP_TOKEN` appears, or (b) a `gh api`/`curl` invocation with a write method (`--method PUT|POST|PATCH|DELETE`, `-X PUT|POST|PATCH|DELETE`, `-f`/`-F`/`--input` payload flags, or `-f query=mutation`) targets one of those paths, or (c) `addDiscussionComment` appears (fixture-tested: one clean workflow, one violating per rule).
- Neither PAT may be exported as a job-level or workflow-level `env:`. Each is passed to exactly the steps that call the reward repo, as a step-level `env:`.
- No `actions/checkout`, no third-party actions, in either job. Only `gh`, `jq`, `curl`, `git` preinstalled on `ubuntu-latest`.
- `timeout-minutes` MUST be set on both jobs (≤ 10).
- Run serialization per source repo is the caller's `concurrency` block (§4.3, single copy). Cross-repo ledger races are handled by §6.4; a **second source repo is a contract bump** that must define cross-repo delivery serialization (§7) before it is added.

---

## 5. Modes [frozen]

### 5.1 `record-only`

The workflow performs the full decision (§2, §3, §7) and writes one ledger line per **would-be action** (§6.2 cardinality) with the **would-** vocabulary. It MUST NOT: create an invitation, post a comment, edit `SUPPORTERS.md`, remove a collaborator, cancel an invitation, or send Telegram. It MAY: read the reward repo (collaborators; **not** invitations — the ledger token cannot) and the source repo (stargazers, comments), and append to the ledger. The only network writes in `record-only` are Contents API appends to the ledger in the family's own private repo with a Contents-only token (§4.4, §8); nothing reaches any person. Failures surface as red runs (GitHub notifies the owner of failed runs natively).

### 5.2 `live`

Same decision; the `act` job executes the actions and each executed action is ledgered with the **live** vocabulary *after* the API call returned (never before).

### 5.3 Action vocabulary and the machine check [frozen]

| `mode` | Allowed `action` values |
|---|---|
| `record-only` | `would-invite`, `would-comment`, `would-supporters-append`, `would-revoke`, `would-cancel-invite`, `skip` |
| `live` | `invite`, `comment`, `supporters-append`, `revoke`, `cancel-invite`, `skip` |

**Zero-external-send proof** for a record-only period is the following check over the ledger returning **0** lines, plus the Actions run list showing `act` skipped for every run in the period:

```sh
# 0 == proof. Any hit == contract violation (stop, checkpoint #7).
jq -c 'select(.mode=="record-only" and (.action|IN("invite","comment","supporters-append","revoke","cancel-invite")))' ledger/*.ndjson | wc -l
```

and, symmetrically, `mode=="live"` lines MUST NOT carry a `would-*` action. Child #2 MUST ship this check as a script in `caty-ai/.github` and run it in its own CI against fixture ledgers (one clean, one violating, expected 0 and non-0).

The ledger check proves the ledger is honest and `act` was idle; it does not by itself prove GitHub's state. The proof therefore has a **third, GitHub-side clause**, produced by the same script **at checkpoint #4** (the full form below, run by the owner or by a one-off live sweep with both tokens) and, **once live, at every sweep**. In `record-only` sweeps only the reduced form runs: the collaborator set equals the baseline (readable with the ledger token), the `/invitations` probe returns 403 (§8.4 — evidence that no credential able to invite was present), and the source-repo marker search (GraphQL/REST reads, allowed in `decide`, §4.4) returns 0; the pending-invitation comparison is deferred to checkpoint #4 because no token able to read it exists before then. A reduced-form pass is not a spurious violation; only a failed clause is.

1. **Baseline**: at the moment the caller first runs in `record-only` (child #3's PR), the owner records `GET /repos/{reward_repo}/collaborators` and `GET /repos/{reward_repo}/invitations` (logins + ids) as `ledger/baseline-<YYYY-MM-DD>.json` in the reward repo.
2. **Audit**: the collaborator and pending-invitation sets of the reward repo equal the baseline (no additions), **and** a search of the source repo for comments containing the marker prefix `<!-- supporter-loop:` (Issues/PRs via REST, paginated to the end; Discussions via GraphQL) returns 0 for the period.

All three clauses = proof. Any one failing = contract violation → stop at checkpoint #7.

### 5.4 Switching

`record-only → live` = human checkpoint #4 (EPIC #119). Preconditions the requester MUST show: the §5.3 check = 0 over the whole record-only period; the full ledger; the exact comment text (§10); the list of logins that would be invited. The switch is the one-line change in §4.3 merged via PR to the source repo's default branch. `live → record-only` (rollback) is the same one-line change and needs no checkpoint.

---

## 6. NDJSON ledger [frozen] (`schema: 1`)

### 6.1 Location

- Repo: the **reward repo** (`inputs.reward_repo`, v1 `caty-ai/ask-ai-widget`), default branch.
- Path: `ledger/<source_owner>--<source_repo>.ndjson` (v1: `ledger/caty-ai--x-collector.ndjson`). One file per source repo.
- Written only via the GitHub Contents API (`PUT /repos/{reward_repo}/contents/{path}` with `sha` of the previous blob) using `SUPPORTER_LEDGER_TOKEN`; commit message `supporter-loop: <event> <actor> <action>`; committer identity `supporter-loop[bot] <supporter-loop@caty-ai.noreply>` (a label; not an account).
- The ledger lives in a private repo. It is **not** published; derived artifacts (`SUPPORTERS.md`) are.

### 6.2 Line schema

**Cardinality: one line per action attempt** (not per event). A first-contact tier-2 event produces up to three lines (`invite`, `comment`, `supporters-append`) plus, in the same run, any `skip` lines; all lines of one event share `run_id`. ISSUE-120's phrase "1事象1行" is read as "one *action attempt* per line" — the unit a ledger reader can recover from individually; this reading is recorded here rather than by editing the Issue.

One JSON object per line, keys in this order, no other keys in v1:

| Key | Type | Value |
|---|---|---|
| `schema` | int | `1` |
| `ts` | string | RFC 3339 UTC, second precision, from the runner clock |
| `run_id` | string | `${{ github.run_id }}-${{ github.run_attempt }}` |
| `repo` | string | source repo `owner/name` |
| `event` | string | `watch` \| `issues` \| `discussion` \| `pull_request_target` \| `sweep` |
| `actor` | string | GitHub login (never display name, never e-mail) |
| `actor_id` | int | GitHub numeric user id (stable across renames) |
| `tier` | int | `1` \| `2` \| `3` \| `0` (sweep / excluded) |
| `subject` | string | `""` for `watch`/`sweep`; otherwise the HTML URL of the Issue / Discussion / PR |
| `action` | string | §5.3 vocabulary |
| `mode` | string | `record-only` \| `live` |
| `result` | string | `ok` \| `ok-backfill` \| `already-<tier>` \| `noop` \| `expired` \| `excluded-<reason>` \| `tier-disabled` \| `error-<http-status\|code>` — success results are the first five (§7) |
| `dedup_key` | string | §7 |
| `gen` | int | generation counter for this `dedup_key` (§7), starts at `1` |

Forbidden content: Issue/PR/Discussion titles or bodies, e-mail addresses, display names, any token, any URL other than `subject`. Child #2 MUST build every line with `jq -n --arg …` from an allowlist of fields; free text from the event payload never reaches the ledger.

### 6.3 Append-only

Lines are only ever appended. Corrections are new lines (e.g. a later `revoke`). Rewriting history of the ledger file is a contract violation. The Contents API refuses writes to files larger than 1 MB, so the weekly sweep MUST rotate the file when it exceeds **900 KB**: rename to `ledger/<name>.<YYYY-MM-DD>.ndjson` (a `PUT` of the new name + a `DELETE` of the old, both via the Contents API — the *only* permitted deletion in this system, and the content is preserved under the new name) and start a new file; readers MUST glob `ledger/<name>*.ndjson` and concatenate in file-name order. If an append fails with the size error before rotation happened, the run fails loud (§14) and the next sweep rotates.

### 6.4 Concurrency

Appends use the Contents API compare-and-swap (`sha`). On `409` / `422 sha mismatch` the writer MUST re-read and retry up to 5 times with jitter; after that the job fails loud (`::error::`); in `live` the `alert` job (§4.4) sends the owner a Telegram failure notice, in `record-only` the red run itself is the signal (GitHub's native failure notification). A lost append is a *failed run*, never a silent drop.

### 6.5 `SUPPORTERS.md` (derived; format owned by child #1)

`SUPPORTERS.md` in the reward repo is regenerated (whole file) from the ledger by the `act` job after every live `invite` / tier upgrade / `revoke`. Contract-level rules only: one line per `actor_id` (a renamed account stays one line); content = the most recently ledgered login for that id (as `@login`), the **achieved tier** (§7 — success results only; `skip`/`error-*`/`tier-disabled` lines never raise it), first-seen date; sorted by first-seen date; ids whose current generation is closed (§7) are omitted; family/bot logins never appear; regeneration is a normal commit on the default branch. The header text, badge markup, and translations are child #1's. Ledger semantics of regeneration: a regeneration caused by a tier event emits exactly **one** `supporters-append` (or `would-supporters-append`) line for that actor and `dedup_key`; a regeneration caused by `revoke` / `cancel-invite` emits **no** `supporters-append` line (the revoke line is the record).

---

## 7. Deduplication and idempotency [frozen]

- `dedup_key` = `"<repo>:<tier>:<actor_id>"` for tier events (e.g. `caty-ai/x-collector:1:184229851`); `"<repo>:sweep:<actor_id>"` for sweep lines (`revoke`, `cancel-invite`, their `would-*` forms, and sweep `skip`s).
- **Success results** = `result` equal to `ok`, starting with `ok-`, starting with `already-`, or equal to `noop` / `expired`. Everything else (`error-*`, `excluded-*`, `tier-disabled`) is a non-success and never counts as delivered, achieved, or closing.
- **Achieved tier** of an actor on a repo (used by §6.5 and §11): the highest `tier` among lines with `.action` in {`invite`, `comment`, `supporters-append`} (live) or their `would-*` forms (record-only) **and a success result**, within the current generation. `skip`, `error-*`, `tier-disabled` and excluded lines never raise it.
- **Generation** (per actor per source repo, shared by tiers 1–3): `gen(repo, actor_id)` = 1 + the number of **closure events**, where a closure event is one run (`run_id`) that wrote at least one line with `.repo == repo`, `.actor_id == actor_id`, `.action` in {`revoke`, `would-revoke`, `cancel-invite`, `would-cancel-invite`} **and a success result** — regardless of those lines' `dedup_key`. A `revoke` + `cancel-invite` pair from one sweep counts once; a failed revoke (`error-*`) closes nothing and is retried by the next sweep. The actor's next tier-1 event after a closure opens the next generation and is rewarded again.
- **Delivered, per action**: an action `X` ∈ {`invite`, `comment`, `supporters-append`} of tier N is delivered for (`dedup_key`, current `gen`) iff an earlier line exists with that `dedup_key`, that `gen`, `.action == X` (live lines) and a success result. Sibling actions never block each other: a run whose `comment` succeeded but whose `supporters-append` failed retries only `supporters-append` at the actor's next event of that tier. In `record-only` the same rule applies to `would-X` lines among themselves (so the rehearsal ledger is also idempotent).
- **Rehearsal lines never satisfy live delivery.** A `would-X` line does not count as `X` delivered once the caller is `live`; the supporter's next qualifying event is delivered for real. Tier 1 has no natural re-trigger (one cannot re-star without unstarring), so the record-only stargazers are handled by the **backfill** below, which is the only way a `would-invite` turns into an `invite` without a new event.
- **Transition table** (the normative summary of this section; prose must agree with it). "Line" = the most relevant earlier line for (`dedup_key`, current `gen`, action `X`):

  | Existing line for (`dedup_key`, `gen`, `X`) | Next qualifying event | Result for `X` |
  |---|---|---|
  | none | any (either mode) | deliver (`X` or `would-X`) |
  | `X` with success result | live | `skip`, `result: already-<tier>` |
  | `X` with `error-*` only | live | deliver again (retry) |
  | `would-X` only | live | **deliver** (rehearsal does not count) |
  | `would-X` only | record-only | `skip`, `result: already-<tier>` |
  | `would-invite` in the current (open) generation, actor still a stargazer, no live `invite` | authorized backfill run | `invite`, `result: ok-backfill` |
  | generation closed (closure event) | any tier-1 event | new generation; all actions deliverable again |
- **Backfill** (checkpoint #4, owner-authorized, one-off): a `sweep` variant enabled by a caller input that exists only for that run. For every `actor_id` whose current (open) generation contains a `would-invite` and no live `invite`, and who is **still a stargazer at backfill time** (checked against the exhaustive stargazer list by numeric id), `act` executes a live `invite` (ledgered `invite`, `result: ok-backfill`, `gen` = current). Checkpoint #4 MUST show the owner this exact list. Tier-2/3 `would-comment` / `would-supporters-append` lines are never backfilled — the moment has passed; the supporter's next Issue/PR is delivered by the "rehearsal does not count" row.
- Comment idempotency is additionally guarded on the GitHub side: before posting, `act` MUST search the target thread for a comment **authored by the workflow identity (`github-actions[bot]`)** containing the marker `<!-- supporter-loop:tier<N>:<actor_id> -->` — Issues/PRs via `GET /repos/{source}/issues/{n}/comments` **paginated to exhaustion** (`Link` header), Discussions via GraphQL `repository.discussion.comments` **and their `replies`** paginated to exhaustion (`pageInfo.hasNextPage`); the Issues comments API MUST NOT be used for `event=discussion`. Any fetch/parse error or truncation MUST abort **before** posting (fail closed). If the marker is found, ledger `action: comment`, `result: already-<tier>` (a success result → delivered) without posting. This covers a ledger append that failed after a comment was posted.
- Invitation idempotency is **not** assumed from the API. Before every `PUT /repos/{reward_repo}/collaborators/{login}`, `act` MUST (a) check `GET /repos/{reward_repo}/collaborators/{login}` (204 = already a collaborator → ledger `invite`, `result: already-1`, no PUT) and (b) list `GET /repos/{reward_repo}/invitations` to exhaustion and match `invitee.id == actor_id` (match → ledger `invite`, `result: already-1`, no PUT). Only then PUT with `{"permission":"pull"}`; 201 and 204 are `ok`. GitHub invitations **expire after 7 days**; an expired invitation is handled by the sweep (§11 step 3), not by re-inviting on the next event.
- Same-run re-delivery: a re-run of a workflow (`run_attempt > 1`) re-evaluates against the ledger like any other run; because live lines are written only after the API returned (§4.4), a crash between the API call and the append is recovered by the GitHub-side checks above (marker search; collaborator/invitation preflight).
---

## 8. Token and permission boundary [frozen]

### 8.1 The credentials (two, single-purpose)

| | `SUPPORTER_LEDGER_TOKEN` | `SUPPORTER_LOOP_TOKEN` |
|---|---|---|
| Purpose | ledger read/append, `SUPPORTERS.md` regeneration, ledger rotation | collaborator invitations, revokes, invitation cancellation |
| Used by | `decide` (both modes) and `act` | `act` **only** (never present in `record-only` runs) |
| Kind | GitHub **fine-grained personal access token** issued by the owner (`shojikumaru`), *or* an installation token of a GitHub App the family owns with the identical permission set. v1 expects PATs. | same |
| Resource owner | `caty-ai` | `caty-ai` |
| Repository access | **Only selected repositories: `caty-ai/ask-ai-widget`.** Nothing else. Adding a repo is a §8 bump + checkpoint #2 again. | same |
| Repository permissions | **Contents: Read and write** · **Metadata: Read** (implied) — nothing else | **Administration: Read and write** (`PUT/DELETE /repos/{r}/collaborators/{login}`, `GET/DELETE /repos/{r}/invitations`) · **Metadata: Read** (implied) — **no Contents write** |
| Organization / account permissions | none | none |
| Expiry | ≤ 366 days; dates recorded at checkpoint #2 as caller-repo *variables* (not secrets) `SUPPORTER_LEDGER_TOKEN_EXPIRES` / `SUPPORTER_LOOP_TOKEN_EXPIRES` = `YYYY-MM-DD`; the sweep warns (`::warning::` and, in live, Telegram) 14 days before either date. | same |
| When registered | checkpoint #2 (needed for the first record-only run) | may be issued at checkpoint #2 and registered then, or deferred to checkpoint #4. **Preflight**: the first step of `act` checks that the token is non-empty and passes §8.4's loop-token self-check; every other step of `act` (comments, `SUPPORTERS.md`, ledger, Telegram) depends on that step, so an empty or wrong token produces zero sends and a red run, never a partial delivery |

### 8.2 Where they are stored

Reusable workflows receive secrets only from their caller. Both tokens are therefore an **Actions secret of the caller repo `caty-ai/x-collector`** (Settings → Secrets and variables → Actions), exactly like `TELEGRAM_BOT_TOKEN` there today. It is *not* stored on `caty-ai/.github` (a secret there would be invisible to the caller). If a second source repo is added later, the secret is registered on that repo too, or promoted to an org secret restricted to the source repos — either way the permission set in §8.1 is unchanged.

> Note for EPIC #119 Done-when: the line "招待トークンは `caty-ai/.github` の Actions secret にのみ存在し" is not technically achievable for a reusable workflow. This contract fixes the storage as the caller repo's Actions secret; the EPIC wording is to be amended by the owner at checkpoint #2 (contract-level wording change → recorded, not silently edited).

### 8.3 What the tokens are never used for

- Never called against the source repo (`caty-ai/x-collector`) — comments, labels, and reads there use `GITHUB_TOKEN`.
- `SUPPORTER_LOOP_TOKEN` is never referenced in the `decide` job (§4.4 static check) and therefore never materializes in a `record-only` run.
- Never passed to Telegram, never written to the ledger, never printed. GitHub masks it in logs automatically; child #2 MUST additionally ensure no step echoes request bodies or headers (`curl -sS` without `-v`, `gh api` without `--verbose`).
- `SUPPORTER_LEDGER_TOKEN` is present in `decide` only for the ledger operations (read, append), each with step-level `env:`; it cannot invite (no Administration permission) even if misused.

### 8.4 Positive self-check (child #2, run at every `sweep`)

Ledger token: `GET /repos/{reward_repo}` (200) · `GET /repos/{reward_repo}/contents/ledger` (200) · `GET /repos/{reward_repo}/invitations` MUST be 403 (proves it has **no** Administration). Loop token (live runs only, inside `act`): `GET /repos/{reward_repo}/invitations` (200 — the endpoint that actually requires Administration read) · `GET /repos/{reward_repo}/contents/ledger` MUST be 403/404 (proves no Contents access). Over-scope probe for both tokens (read-shaped, so the probe itself can never change anything): `GET /repos/{source_repo}/invitations` (needs Administration on the source repo) MUST return 403/404, and `GET /repos/{reward_repo}` with the loop token MUST NOT expose `permissions.push == true`; any unexpected success is reported as `::error:: token over-scoped` (and, in live, Telegram'd) and the sweep performs no destructive action in that run. Implicit read access to public repos is a platform property of fine-grained PATs and is out of scope for the probe. As in the errmeter contract §8 (https://github.com/caty-ai/errmeter/blob/epic/1/docs/contract.md), a 403/404 is consistent with least privilege but not proof; the authoritative check is the owner looking at the token's permission page at checkpoint #2.

### 8.5 Residual blast radius (acknowledged)

`Administration: Read and write` is the platform minimum for collaborator and invitation management on a fine-grained PAT, and it also permits renaming, archiving, or deleting the reward repo. This is accepted for v1 because the repo is a low-stakes early-access shelf, the ledger and `SUPPORTERS.md` are small and reconstructible from GitHub's own stargazer/collaborator state, and no alternative permission exists. Mitigations the owner SHOULD apply at checkpoint #2: token expiry ≤ 366 days; the reward repo's default branch protected by a ruleset (the token's Contents write still passes through it for `ledger/` and `SUPPORTERS.md` because the ruleset targets force-push/deletion only); and a note in the token description naming this contract.

---

## 9. Owner notification (Telegram) [frozen]

- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — the existing names, passed explicitly by the caller (already present on `caty-ai/x-collector`).
- **Live only.** Sent from the `act` job, after its actions, one message per live ledger line except `result: already-*` and `result: tier-disabled` (those are noise). In `record-only` no Telegram is sent at all — the ledger is the owner's window, and failed runs reach the owner through GitHub's own workflow-failure notifications. In `live`, failures of `decide` or `act` are reported by the separate `alert` job (§4.4), which holds only the Telegram secrets and sends one message: `supporter-loop FAILED <repo> · <job> · <run URL>`. Message = `supporter-loop [<mode>] <repo> · <event> · @<actor> · tier <tier> · <action> · <result>` + `subject` URL if any. No titles/bodies, no token, no e-mail.
- Independent leg: Telegram failure never suppresses the ledger append, and a ledger failure never suppresses Telegram (`if: ${{ !cancelled() }}` pattern from `external-input-watch.yml`).
- Telegram secrets go only to `api.telegram.org` via `curl`.

---

## 10. Thank-you comment [frozen]

- Posted only in `live`, only by `act`, only on the actor's **own** Issue / Discussion (tier 2) or merged PR (tier 3), at most once per `dedup_key` per generation (§7).
- Body is a **fixed template** stored in `caty-ai/.github` next to the workflow (`supporter-loop/comment-tier2.md`, `comment-tier3.md`). The only substitutions are `{{login}}` (actor login) and `{{reward_repo_url}}`. No event text is ever interpolated.
- First line of the body MUST be the HTML marker `<!-- supporter-loop:tier<N>:<actor_id> -->` (idempotency, §7).
- Tone rule (§0-1): says thank you, tells the supporter what they now have access to and where `SUPPORTERS.md` is, and nothing else. It MUST NOT ask for a Star, a share, a follow, or a review. The exact wording (JA + EN in one comment) is approved by the owner at checkpoint #4 together with the switch to live; it is a template file, not contract text.
- Discussions: posted via GraphQL `addDiscussionComment` with the same marker in the body.

---

## 11. Weekly sweep [frozen]

Triggered by the caller's `schedule` (§4.3) with `sweep: true`.

**Fail-closed preconditions for any destructive step (2 and 3).** Before revoking or cancelling anything the sweep MUST establish, and fail loud + skip all destructive steps if any is false: (a) `GET /repos/{source_repo}/actions/runs?status=failure&created=>=<T>` filtered to the supporter-loop workflow returns **zero** runs, where `<T>` = `created_at` of the most recent *successful* scheduled sweep run (from the same runs API, `event=schedule&status=success`), or, if none exists yet, the `created_at` of the caller workflow's first run (the query is never issued with an empty timestamp) (a red run may have delivered a reward whose ledger line is missing; a human reconciles it first); (b) the stargazer list was paged to exhaustion; (c) the self-check (§8.4) passed; (d) **marker reconciliation** ran: for every actor about to be revoked, the sweep searched the source repo for the workflow's own `supporter-loop:tier2/3` markers (paginated, §7) and, if one exists without a ledger line, appended the missing `comment` line first — an actor with any tier-2/3 evidence is then out of scope for step 2 by definition. In order:

1. §8.4 self-check.
2. **Unstar cleanup** (tier-1 only, §2.2): for every `actor_id` whose achieved tier (§7) is exactly 1 and whose current generation is open, if that **numeric id** is absent from the full `GET /repos/{source_repo}/stargazers` list (matched on `.id`, never on login) → `revoke` (`DELETE /repos/{reward_repo}/collaborators/{current_login}`, where `current_login` is resolved from the id via `GET /user/{id}`) and, if a pending invitation for that id exists, `cancel-invite` (`DELETE /repos/{reward_repo}/invitations/{id}`). Record-only → `would-revoke` / `would-cancel-invite`. Each is one ledger line. A `revoke` whose `DELETE` finds neither a collaborator nor a pending invitation (the normal case after an invitation lapsed) is **still ledgered** (`result: noop`) and still closes the generation (`noop` is a success result, §7; an `error-*` revoke closes nothing and is retried next week). "Tier-1 actors" throughout this section = actors whose achieved tier (§7, success results only) is exactly 1.
3. **Expired / stale invitation cleanup**: GitHub repository invitations expire **7 days** after creation. For every tier-1 `actor_id` whose current generation is open and whose `invite` line is older than 7 days and who is neither a collaborator nor in the pending-invitation list → ledger `cancel-invite` (`result: expired`; no API call is needed because GitHub already removed it) — this closes the generation (§7) so the supporter's next star produces a fresh invitation. Pending invitations that are still listed but older than 7 days (should not happen; defensive) → `cancel-invite` via the API. Record-only → `would-cancel-invite` in both cases (and in record-only nothing was ever invited, so the case is normally empty).
4. **Ledger rotation** (§6.3) if needed.
5. **`SUPPORTERS.md` regeneration** (live only) if anything changed.
6. Token-expiry reminder (§8.1) if within 14 days.

Stargazer listing is paginated (`per_page=100`); the sweep MUST page to the end or fail loud — a truncated list MUST NOT cause revokes.

---

## 12. Early-access rotation [frozen]

The reward repo is an **early-access** shelf, not a permanent private product.

- When an item in the reward repo is published (made public elsewhere, or the reward repo itself is made public), the **next** early-access item MUST be placed in the reward repo in the same change, so supporters never look at an empty shelf. "Same change" = same PR or same day, recorded on EPIC #119 (or its successor Issue) with both URLs.
- Publishing an item never revokes anyone: access to the reward repo continues; `SUPPORTERS.md` is unaffected.
- Making the reward repo itself public is out of scope for EPIC #119 and is a separate Issue with its own human checkpoint (public exposure).
- Child #1 documents this rule in the reward repo's README so supporters can read it.

---

## 13. Security invariants (mirror in the workflow header, do not weaken) [frozen]

1. NEVER `actions/checkout` (or any code execution from the triggering ref) in the central workflow or the caller. `pull_request_target` runs with secrets and a write token; that is safe only because untrusted code is never checked out or executed.
2. Actor-controlled strings enter `run:` scripts only via `env:` or `$GITHUB_EVENT_PATH`.
3. Secrets are limited to the four declared in §4.2/§4.3; no `secrets: inherit`; each PAT at step-level `env:` only, and only in steps that call the reward repo. `SUPPORTER_LOOP_TOKEN` (Administration) is referenced **only in the `act` job** — enforced by child #2's static check (§4.4).
4. Both PATs go only to `api.github.com` for `{reward_repo}`; Telegram secrets go only to `api.telegram.org`. Secrets are never echoed, never ledgered, never in a Telegram body.
5. `record-only` cannot send: (i) the only credential loaded in a record-only run cannot invite (Contents-only, §8.1); (ii) the `act` job is gated by `if: inputs.mode == 'live'` (§4.4); (iii) every outbound call in `act` is additionally guarded by an explicit `[ "$MODE" = live ]` test in the script; (iv) Telegram is live-only (§9). All four must fail together for a supporter-facing record-only send, and (i) makes an invitation impossible regardless of the other three.
6. No third-party actions.
7. Supporter-facing output is limited to: one collaborator invitation to `{reward_repo}`, one comment on the actor's own thread per tier, `SUPPORTERS.md`. Anything else (e-mail, DM, mentions of third parties, comments on other people's threads) is out of contract.
8. Comment bodies are fixed templates with two substitutions (§10).

---

## 14. Failure behaviour [frozen]

| Situation | Behaviour |
|---|---|
| `mode` invalid | fail before any network call |
| Reward repo unreachable (token revoked/expired, repo renamed) | `decide` fails loud; in `live` the `alert` job (§4.4) sends Telegram, in `record-only` the red run is the alert; nothing is retried by the workflow (GitHub re-delivers nothing; the sweep will not backfill missed events — the ledger simply lacks the line, and the actor's next event of the same tier is a fresh chance) |
| Ledger CAS conflict | retry ×5 then fail loud (§6.4) |
| Invitation API 403/422 (e.g. user blocked the org, invitation limit) | ledger `result: error-<status>`; the tier-2/3 **comment of that run is skipped** (`action: skip`, `result: error-<status>` — the template asserts access that does not exist); other actors' actions continue; job ends red. The comment is delivered on the actor's next tier event once an invitation stands (the `error-*` line does not count as delivered, §7) |
| Comment posted but ledger append failed | next run finds the marker (§7, paginated) → ledgers `action: comment`, `result: already-<tier>` without posting; that line counts as delivered for every later event of the same key and generation |
| Ledger file reaches the Contents API 1 MB limit before rotation | append fails loud; next sweep rotates (§6.3) |
| Telegram down (live only) | ledger still written; job stays green if all GitHub legs succeeded (Telegram failure is `::warning::`) |
| A red supporter-loop run exists since the last successful sweep | sweep runs steps 1, 4, 6 only; steps 2/3/5 are skipped with `::error::`; the owner reconciles (re-run the red job or append the missing line by hand via PR) |
| Stargazers list truncated | no revokes (§11) |

---

## 15. Out of scope for v1 (explicit)

- X / SNS share detection and any x-collector DB table (strategy §3.1/§3.2 SNS rows) — later Epic.
- Follow detection.
- "Secret per person" reward pages.
- Organization team-based access (replacing per-repo invitations) — revisit when supporters > 100.
- Any change to the seven existing workflows in `caty-ai/.github`.

---

## Changelog

- v1.2 (2026-09-06, alpha) — design review r2 (delta) folded in: §7 rewritten around **success results**, an **achieved-tier** predicate (shared by §6.5/§11), per-action delivery (sibling actions never block each other), closure events counted once per run and only on success (a failed revoke closes nothing), and "rehearsal lines never satisfy live delivery" (a `would-comment` no longer suppresses the first live thank-you; tier-1 still goes through the owner-authorized backfill); `result` enum gains `ok-backfill` / `expired` (§6.2); `act` token preflight gates every other step (§4.4, §8.1); a live-only `alert` job carries failure Telegram (§4.4, §6.4, §9, §14); §5.3 audit scoped to checkpoint #4 + live sweeps with an explicit reduced form for record-only sweeps; §4.4 static check narrowed to write methods so reads for the audit/marker search are legal in `decide`; secret count and README token sentence corrected; §11 precondition (a) timestamp source defined.
- v1.1 (2026-09-06, alpha) — design review r1 folded in (5 seats, all NO-GO in r1; every CRITICAL/MAJOR addressed): **two single-purpose credentials** — `SUPPORTER_LEDGER_TOKEN` (Contents only, used in record-only) and `SUPPORTER_LOOP_TOKEN` (Administration, `act` only) — replacing the one-token invariant (§0-4, §4.2, §4.4, §8); Telegram is live-only (§5.1, §9); invitation permission is the REST enum `pull` and MUST be sent explicitly (§2); roster compare is case-insensitive (§3.2); caller YAML carries the `concurrency` block and is the single copy (§4.3); ledger cardinality = one line per action attempt (§6.2); §7 gained a normative transition table, `error-*` never counts as delivered, invitation preflight (collaborator + pending-invitation list by `invitee.id`), marker search restricted to the workflow identity and Discussion `replies`; sweep gained fail-closed preconditions (no red runs since last sweep, marker reconciliation) (§11); self-check proves Administration via `/invitations` and probes are read-shaped (§8.4); further: Actor = PR author on `pull_request_target` (§0); `excluded-member` via `author_association` (§3.2); `secrets:` block added to the frozen `workflow_call` interface (§4.2); ledger-line authorship table + static no-outbound check for `decide` (§4.4); GitHub-side audit clause added to the zero-send proof (§5.3); rotation at 900 KB because of the Contents API 1 MB limit (§6.3); `SUPPORTERS.md` keyed by `actor_id` (§6.5); generation formula keyed by `(repo, actor_id)` and counting `cancel-invite`, backfill exception made explicit, `already-*` counts as delivered, marker search paginated + GraphQL for Discussions (§7); residual blast radius note (§8.5); sweep matches stargazers by numeric id and invitation expiry is 7 days with record-only mapping (§11); recovery row fixed (§14).
- v1.0 (2026-09-06, alpha) — freeze candidate for design review (5 seats, E-6①).
