# Supporter Reward Loop — contract (v1) — FROZEN INTERFACES

Status: **freeze candidate v1.0** for caty-ai/x-collector#120 (child #0 of EPIC caty-ai/x-collector#119). Once the design review (five heterogeneous seats, E-6①) reaches GO and this file is merged into `epic/119`, every section marked **[frozen]** may change only through a new contract issue that bumps `contract_version` (and, where noted, the ledger `schema`). Changing a frozen section is a *contract-level deviation* and stops the Epic at human checkpoint #7 (EPIC #119, E-3).

Companions: EPIC caty-ai/x-collector#119 (why, tiers at a glance, human checkpoints) · child #1 caty-ai/ask-ai-widget#9 (reward repo) · child #2 caty-ai/.github#75 (central workflow) · child #3 caty-ai/x-collector#121 (caller + README) · child #4 caty-ai/x-collector#122 (awesome lists). Entry page: [README.md](README.md).

Wording: MUST / MUST NOT / SHOULD / MAY as in RFC 2119. "Source repo" = the public repo whose activity is rewarded (v1: `caty-ai/x-collector`). "Reward repo" = the private repo supporters are invited to (v1: `caty-ai/ask-ai-widget`). "Central workflow" = the reusable workflow in `caty-ai/.github`. "Caller" = the thin workflow in the source repo. "Actor" = the GitHub login that performed the triggering event.

---

## 0. Design invariants [frozen]

1. **Thanks, not solicitation.** Every message and artifact is a thank-you for something already done. Nothing asks for a Star, a share, or a follow. Copy that violates this is a contract violation, not a style issue.
2. **GitHub-native delivery only.** The only outbound channels are (a) a repository collaborator invitation to the reward repo and (b) a comment on the actor's own Issue / PR in the source repo. No e-mail, no DM, no third-party API is ever called with the actor as recipient. (Telegram is an *owner-side* notification, §9, never a supporter-facing channel.)
3. **Record-only first.** The central workflow ships and runs in `mode: record-only` (§5). Switching to `live` is human checkpoint #4 of EPIC #119 and requires an owner approval comment; the switch is a one-word change in the caller (§4.3) and nothing else.
4. **Least privilege, one boundary.** Exactly one long-lived credential exists (§8). It can act on the reward repo only. It never touches the source repo. Supporter-facing comments use the caller's `GITHUB_TOKEN`.
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
| **1** | `watch` (`action: started`) | Actor not excluded (§3) | **Invitation to the reward repo** (collaborator, permission `read`) + **`SUPPORTERS.md` entry** (login + tier + date) + the **Supporter badge** (an image in the reward repo the supporter may embed; delivered implicitly by repo access) | yes |
| **2** | `issues` (`action: opened`) or `discussion` (`action: created`) | Actor not excluded; Issue/Discussion is not closed as spam within the run (no such check in v1 — spam handling is the weekly sweep, §11) | Tier 1 + **one thank-you comment** on that Issue / Discussion (§10) + `SUPPORTERS.md` tier updated to 2 | yes |
| **3** | `pull_request_target` (`action: closed`, `merged == true`) | Actor = PR author, not excluded | Tier 1 + 2 (comment goes on the merged PR) + `SUPPORTERS.md` tier updated to 3 + listing in the source repo's **Contributors wall** and **release notes** (both produced by child #3's `release.yml` from git history, not by the central workflow) | yes |
| Fork | `fork` | — | **Nothing.** Not even a ledger line (the caller does not subscribe to `fork`). | yes (no reward) |

### 2.1 Items deferred to a later contract version (decided: **後回し / deferred**)

The strategy note (alpha-wiki `supporter-reward-loop-strategy.md` §7) listed "one more repo invitation" for tier 2 and a "contributor repo invitation" for tier 3. v1 **defers both** and delivers tier 2 and 3 as in the table above.

- Why: the owner decided on 2026-09-05 that no new repository is created for this Epic and that the reward repo is `caty-ai/ask-ai-widget` only. A second private repo does not exist, so a second invitation has nothing to point at. Defining it now would freeze an interface to an artifact nobody owns.
- Exit trigger (re-opens this item as a contract bump, not silently): the owner names a second reward repo *or* the first early-access item rotates out (§12) and a second private repo becomes the natural place for the next one. Until then tier 2 and 3 add **recognition** (comment, tier label, wall, release notes), not further access.
- Consequence for §8: the token's repository access stays a single repo. If the deferral is lifted, §8 is bumped and human checkpoint #2 (token issuance) is repeated for the new scope.

### 2.2 Downgrade

Tiers never decrease. Unstarring after tier 2 or 3 is reached does not revoke anything. Unstarring at tier 1 is handled by the weekly sweep (§11).

---

## 3. Eligibility and exclusions [frozen]

### 3.1 Included

- Any GitHub user account (`type == "User"`) that performs a tier trigger on a source repo listed in the caller.

### 3.2 Excluded (no reward, no `SUPPORTERS.md` entry; ledger line with `action: skip`, `result: excluded-<reason>`)

| Reason code | Rule |
|---|---|
| `excluded-family` | Login is in the **family roster**. The roster is the single string already maintained in `caty-ai/.github` `external-input-watch.yml` (`fam_roster`, measured 2026-08-29). Child #2 MUST read the same list (copy is acceptable in v1 provided a comment in both files names the other as the twin; a shared file is preferred if it exists by then). |
| `excluded-bot` | `type == "Bot"` or login ends with `[bot]`. |
| `excluded-self` | Actor equals the repository owner org's login or the workflow's own identity. |
| `excluded-org` | `type == "Organization"`. |

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
```

Rules:

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
  issues: write
  pull-requests: write
  discussions: write
jobs:
  loop:
    uses: caty-ai/.github/.github/workflows/supporter-loop-reusable.yml@main
    with:
      mode: record-only          # <- the ONLY line that changes at checkpoint #4
      sweep: ${{ github.event_name == 'schedule' }}
    secrets:
      SUPPORTER_LOOP_TOKEN: ${{ secrets.SUPPORTER_LOOP_TOKEN }}
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- `secrets: inherit` is **forbidden** in the caller (same rule as `external-input-caller.yml`).
- `contents: none` is load-bearing under `pull_request_target` and MUST NOT be removed. The caller never checks out code.
- `discussions: write` is present only for the tier-2 thank-you comment on a Discussion (GraphQL `addDiscussionComment`). Repos without Discussions leave the `discussion` trigger as a no-op.
- The `@main` pin follows the org precedent (`external-input-caller.yml`): `caty-ai/.github` `main` is merge-only via reviewed PR.

### 4.4 Central workflow — jobs and permissions [frozen]

The central workflow MUST be split into two jobs so that *record-only cannot send* by construction:

| Job | Runs when | `permissions` | May use |
|---|---|---|---|
| `decide` | always | `contents: none`, `issues: read`, `pull-requests: read`, `discussions: read` | `GITHUB_TOKEN` (read) · `SUPPORTER_LOOP_TOKEN` **only** for reading the ledger and, in both modes, appending to it (§6) · Telegram secrets (§9) |
| `act` | `needs: decide` **and** `inputs.mode == 'live'` **and** `decide` produced at least one live action | `contents: none`, `issues: write`, `pull-requests: write`, `discussions: write` | `GITHUB_TOKEN` (write, source repo comments) · `SUPPORTER_LOOP_TOKEN` (reward repo invitations, `SUPPORTERS.md`) |

- In `record-only`, the `act` job is **skipped by its `if:`**; the run log therefore shows `act` as skipped for every record-only run. That log line plus the ledger (§5.3) is the proof required by EPIC #119 Done-when.
- `SUPPORTER_LOOP_TOKEN` MUST NOT be exported as a job-level or workflow-level `env:`. It is passed to exactly the steps that call the reward repo, as a step-level `env:`.
- No `actions/checkout`, no third-party actions, in either job. Only `gh`, `jq`, `curl`, `git` preinstalled on `ubuntu-latest`.
- `timeout-minutes` MUST be set on both jobs (≤ 10).
- `concurrency: { group: supporter-loop-${{ github.repository }}, cancel-in-progress: false }` MUST be declared on the caller job so ledger appends from one source repo serialize. (Cross-repo races are handled by §6.4.)

---

## 5. Modes [frozen]

### 5.1 `record-only`

The workflow performs the full decision (§2, §3, §7) and writes one ledger line per event with the **would-** vocabulary. It MUST NOT: create an invitation, post a comment, edit `SUPPORTERS.md`, remove a collaborator, or cancel an invitation. It MAY: read the reward repo (collaborators, invitations, stargazers), append to the ledger, send the owner Telegram notice.

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

### 5.4 Switching

`record-only → live` = human checkpoint #4 (EPIC #119). Preconditions the requester MUST show: the §5.3 check = 0 over the whole record-only period; the full ledger; the exact comment text (§10); the list of logins that would be invited. The switch is the one-line change in §4.3 merged via PR to the source repo's default branch. `live → record-only` (rollback) is the same one-line change and needs no checkpoint.

---

## 6. NDJSON ledger [frozen] (`schema: 1`)

### 6.1 Location

- Repo: the **reward repo** (`inputs.reward_repo`, v1 `caty-ai/ask-ai-widget`), default branch.
- Path: `ledger/<source_owner>--<source_repo>.ndjson` (v1: `ledger/caty-ai--x-collector.ndjson`). One file per source repo.
- Written only via the GitHub Contents API (`PUT /repos/{reward_repo}/contents/{path}` with `sha` of the previous blob) using `SUPPORTER_LOOP_TOKEN`; commit message `supporter-loop: <event> <actor> <action>`; committer identity `supporter-loop[bot] <supporter-loop@caty-ai.noreply>` (a label; not an account).
- The ledger lives in a private repo. It is **not** published; derived artifacts (`SUPPORTERS.md`) are.

### 6.2 Line schema

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
| `result` | string | `ok` \| `already-<tier>` \| `excluded-<reason>` \| `tier-disabled` \| `error-<http-status\|code>` \| `noop` |
| `dedup_key` | string | §7 |
| `gen` | int | generation counter for this `dedup_key` (§7), starts at `1` |

Forbidden content: Issue/PR/Discussion titles or bodies, e-mail addresses, display names, any token, any URL other than `subject`. Child #2 MUST build every line with `jq -n --arg …` from an allowlist of fields; free text from the event payload never reaches the ledger.

### 6.3 Append-only

Lines are only ever appended. Corrections are new lines (e.g. a later `revoke`). Rewriting history of the ledger file is a contract violation. The weekly sweep MAY rotate the file when it exceeds 5 MB: rename to `ledger/<name>.<YYYY-MM>.ndjson` and start a new file; readers MUST glob `ledger/<name>*.ndjson`.

### 6.4 Concurrency

Appends use the Contents API compare-and-swap (`sha`). On `409` / `422 sha mismatch` the writer MUST re-read and retry up to 5 times with jitter; after that the job fails loud (`::error::`) and Telegram (§9) is still sent. A lost append is a *failed run*, never a silent drop — the run being red is the signal.

### 6.5 `SUPPORTERS.md` (derived; format owned by child #1)

`SUPPORTERS.md` in the reward repo is regenerated (whole file) from the ledger by the `act` job after every live `invite` / tier upgrade / `revoke`. Contract-level rules only: one line per login; content = login (as `@login`), highest tier, first-seen date; sorted by first-seen date; family/bot logins never appear; regeneration is a normal commit on the default branch. The header text, badge markup, and translations are child #1's.

---

## 7. Deduplication and idempotency [frozen]

- `dedup_key` = `"<repo>:<tier>:<actor_id>"` for tier events (e.g. `caty-ai/x-collector:1:184229851`); `"<repo>:sweep:<actor_id>"` for sweep lines.
- A tier-N reward is **delivered** (or would-be-delivered) only if no earlier ledger line exists with the same `dedup_key` and an action in {`invite`,`comment`,`supporters-append`,`would-invite`,`would-comment`,`would-supporters-append`} whose `gen` equals the current generation.
- Current generation for a key = 1 + the number of earlier `revoke` / `would-revoke` lines for `<repo>:1:<actor_id>` (a revoke closes the generation; a re-star opens the next one and is rewarded again). Tier 2 and 3 keys share the generation of tier 1 for the same actor.
- Record-only and live lines count **equally** for dedup. Consequence, stated on purpose: a supporter who was `would-invite`d during record-only is **not** invited automatically at the switch to live. Checkpoint #4 MUST include the list of such logins; the owner decides whether child #2 runs a one-off *backfill* (a `sweep` variant that re-emits tier-1 for keys whose only lines are `would-*`, ledgered as `invite` with `result: ok` and `gen` unchanged). The backfill is opt-in, ledgered, and idempotent like everything else.
- Comment idempotency is additionally guarded on the GitHub side: before posting, `act` MUST search the target Issue/PR/Discussion for a comment containing the marker `<!-- supporter-loop:tier<N>:<actor_id> -->` (§10) and skip with `result: already-<tier>` if found. This covers a ledger append that failed after a comment was posted.
- Invitation idempotency on the GitHub side: `PUT /repos/{reward_repo}/collaborators/{login}` is itself idempotent (204 if already a collaborator / 201 with a pending invitation). `act` MUST treat 201 and 204 as `ok`.

---

## 8. Token and permission boundary [frozen]

### 8.1 The credential

| | |
|---|---|
| Secret name | `SUPPORTER_LOOP_TOKEN` |
| Kind | GitHub **fine-grained personal access token** issued by the owner (`shojikumaru`), *or* an installation token of a GitHub App the family owns with the identical permission set. v1 expects the PAT. |
| Resource owner | `caty-ai` |
| Repository access | **Only selected repositories: `caty-ai/ask-ai-widget`.** Nothing else. Adding a repo is a §8 bump + checkpoint #2 again. |
| Repository permissions | **Administration: Read and write** (needed for `PUT/DELETE /repos/{r}/collaborators/{login}` and `DELETE /repos/{r}/invitations/{id}`) · **Contents: Read and write** (ledger, `SUPPORTERS.md`) · **Metadata: Read** (mandatory, implied) |
| Organization permissions | **none** |
| Account permissions | **none** |
| Expiry | ≤ 366 days; the owner records the expiry date on EPIC #119 checkpoint #2; child #2's sweep posts a Telegram reminder 14 days before (`gh api /user` with the token exposes no expiry, so the date is a config constant `SUPPORTER_LOOP_TOKEN_EXPIRES=YYYY-MM-DD` set as a *variable*, not a secret, on the caller repo). |

### 8.2 Where it is stored

Reusable workflows receive secrets only from their caller. The token is therefore an **Actions secret of the caller repo `caty-ai/x-collector`** (Settings → Secrets and variables → Actions), exactly like `TELEGRAM_BOT_TOKEN` there today. It is *not* stored on `caty-ai/.github` (a secret there would be invisible to the caller). If a second source repo is added later, the secret is registered on that repo too, or promoted to an org secret restricted to the source repos — either way the permission set in §8.1 is unchanged.

> Note for EPIC #119 Done-when: the line "招待トークンは `caty-ai/.github` の Actions secret にのみ存在し" is not technically achievable for a reusable workflow. This contract fixes the storage as the caller repo's Actions secret; the EPIC wording is to be amended by the owner at checkpoint #2 (contract-level wording change → recorded, not silently edited).

### 8.3 What the token is never used for

- Never called against the source repo (`caty-ai/x-collector`) — comments, labels, and reads there use `GITHUB_TOKEN`.
- Never passed to Telegram, never written to the ledger, never printed. GitHub masks it in logs automatically; child #2 MUST additionally ensure no step echoes request bodies or headers (`curl -sS` without `-v`, `gh api` without `--verbose`).
- Never present in the `decide` job except for the two ledger operations (read, append), each with step-level `env:`.

### 8.4 Positive self-check (child #2, run at every `sweep`)

`GET /repos/{reward_repo}` (expects 200) · `GET /repos/{reward_repo}/collaborators?per_page=1` (expects 200 — proves Administration read) · `GET /repos/{reward_repo}/contents/ledger` (expects 200). Over-scope probe: `GET /repos/{source_repo}/collaborators?per_page=1` with the token MUST return 401/403/404; a 200 is reported as `::error:: token over-scoped` and Telegram'd. As in errmeter §8, a 403/404 is consistent with least privilege but not proof; the authoritative check is the owner looking at the token's permission page at checkpoint #2.

---

## 9. Owner notification (Telegram) [frozen]

- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — the existing names, passed explicitly by the caller (already present on `caty-ai/x-collector`).
- Sent from the `decide` job for every ledgered line except `result: already-*` and `result: tier-disabled` (those are noise). Message = `supporter-loop [<mode>] <repo> · <event> · @<actor> · tier <tier> · <action> · <result>` + `subject` URL if any. No titles/bodies, no token, no e-mail.
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

Triggered by the caller's `schedule` (§4.3) with `sweep: true`. In order:

1. §8.4 self-check.
2. **Unstar cleanup** (tier-1 only, §2.2): for every actor whose highest ledgered tier is 1 and whose current generation is open, if the actor is no longer in `GET /repos/{source_repo}/stargazers` → `revoke` (`DELETE /repos/{reward_repo}/collaborators/{login}`) and, if a pending invitation exists, `cancel-invite` (`DELETE /repos/{reward_repo}/invitations/{id}`). Record-only → `would-revoke` / `would-cancel-invite`. Each is one ledger line.
3. **Stale invitation cleanup**: pending invitations older than 30 days for tier-1 actors → `cancel-invite` (they can re-star to get a fresh one; the generation is closed by this line exactly like a revoke).
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
3. Secrets are limited to the three declared in §4.3; no `secrets: inherit`; `SUPPORTER_LOOP_TOKEN` at step-level `env:` only, and only in steps that call the reward repo.
4. `SUPPORTER_LOOP_TOKEN` goes only to `api.github.com` for `{reward_repo}`; Telegram secrets go only to `api.telegram.org`. Secrets are never echoed, never ledgered, never in a Telegram body.
5. `record-only` cannot send: the `act` job is gated by `if: inputs.mode == 'live'` (§4.4) *and* every outbound call in `act` is additionally guarded by an explicit `[ "$MODE" = live ]` test in the script (defense in depth: two independent checks must both fail for a record-only send).
6. No third-party actions.
7. Supporter-facing output is limited to: one collaborator invitation to `{reward_repo}`, one comment on the actor's own thread per tier, `SUPPORTERS.md`. Anything else (e-mail, DM, mentions of third parties, comments on other people's threads) is out of contract.
8. Comment bodies are fixed templates with two substitutions (§10).

---

## 14. Failure behaviour [frozen]

| Situation | Behaviour |
|---|---|
| `mode` invalid | fail before any network call |
| Reward repo unreachable (token revoked/expired, repo renamed) | `decide` fails loud; Telegram sent; nothing is retried by the workflow (GitHub re-delivers nothing; the sweep will not backfill missed events — the ledger simply lacks the line, and the actor's next event of the same tier is a fresh chance) |
| Ledger CAS conflict | retry ×5 then fail loud (§6.4) |
| Invitation API 403/422 (e.g. user blocked the org, invitation limit) | ledger `result: error-<status>`, continue with the remaining actions, job ends red |
| Comment posted but ledger append failed | next run finds the marker (§7) → `skip already-<tier>`; ledger gets its line then |
| Telegram down | ledger still written; job stays green if all GitHub legs succeeded (Telegram failure is `::warning::`) |
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

- v1.0 (2026-09-06, alpha) — freeze candidate for design review (5 seats, E-6①).
