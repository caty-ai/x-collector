# Community sources

The community source list makes useful public X accounts discoverable. It never subscribes your deployment, changes the collector, or imports rows into the database. Adding a source remains an explicit, per-source operator decision.

## Schema

Entries live in `data/community-sources/` as UTF-8 JSON without a BOM. Each decoded file is at most 2 KiB and contains exactly these fields:

```json
{
  "schema_version": 1,
  "platform": "x",
  "identifier": "OpenAI",
  "topic": "AI lab announcements",
  "language": "en",
  "submitted_by": "github-login",
  "first_seen": "2026-08-02"
}
```

- `schema_version` is `1`, and `platform` is `x`. RSS is not accepted in v1.
- `identifier` is an X handle of 1–15 ASCII letters, digits, or underscores. Reserved X routes and two-letter locale routes are rejected after lower-casing.
- `topic` is a single line of 3–80 Unicode letters/digits, spaces, and limited punctuation. URLs, control characters, zero-width characters, and bidi controls are rejected.
- `language` is `xx` or `xx-YY`.
- `submitted_by` is a GitHub login and must match the pull-request author case-insensitively.
- `first_seen` is a real date from `2006-01-01` through today in UTC. It is public metadata and is never used for rate limiting.
- The filename is derived from the content: `x--<lowercased-identifier>.json`.

Run `npm run validate:community` to validate the complete catalog, or:

```sh
npx ts-node src/scripts/community/validate-community-source.ts --file path/to/source.json --against data/community-sources
```

## Contribution helper

Set your GitHub login locally and use direct mode:

```sh
export COMMUNITY_SUBMITTED_BY=your-github-login
npm run contribute:source -- --handle ExampleHandle --topic "AI engineering" --language en
```

With `COMMUNITY_CONTRIBUTE_PROMPT=on`, running `npm run contribute:source` without arguments scans for active sources that have been kept for at least 14 days. Declined handles are recorded only in the gitignored `.community-source-declines.json` file.

The helper has no non-interactive consent flag. It validates locally, prints the exact public JSON and destination, explains permanence, and requires a per-source lowercase `y` before any fork, clone, fetch, push, or PR action.

## Manual pull-request path

If you do not use the helper:

1. Fork `caty-ai/x-collector` and branch from the current upstream `main`.
2. Add exactly one new `data/community-sources/x--<lowercased-handle>.json` file; do not change any other path.
3. Set `submitted_by` to the pull-request author's GitHub login and run the validator with `--against data/community-sources`.
4. Open a pull request to upstream `main`. The gate validates the exact base and head SHAs and never executes code from the pull request.

<a id="checks"></a>
## Checks

Gate comments contain only these fixed IDs and validated templates; raw filenames, topics, and validator diagnostics never cross into the write-token job.

| ID | Meaning |
| --- | --- |
| `E1` | Event preconditions failed: expected upstream `main`, a valid PR number, full base/head SHAs, and a valid author login. |
| `E2` | The pinned compare snapshot failed or was incomplete/truncated. Errors never become a neutral result. |
| `E3` | The privileged action received an invalid structured contract. |
| `C1` | Every changed path must match the anchored one-segment community JSON path rule. |
| `C2` | The PR must add exactly one file. |
| `C3` | The entry must be a regular `100644` blob whose compare, tree, and contents SHAs agree. |
| `C4` | The pinned blob must be valid UTF-8 JSON, at most 2 KiB, strict-schema, and correctly named. |
| `C5` | The X handle must match the handle rule and not match a reserved route after lower-casing. |
| `C6` | The lower-cased handle must not already exist at the pinned base SHA. |
| `C7` | The topic must satisfy the single-line length and character policy. |
| `C8` | `submitted_by` must equal the PR author case-insensitively. |
| `C9` | The author account must meet the configured age floor; invalid configuration or lookup failure rejects. |
| `C10` | The author must be below three merged entries in the preceding 30 days, counted from repository commit timestamps, never `first_seen`. |

C10 fails closed if any relevant historical blob cannot be inspected. One malformed or unavailable
blob therefore blocks every new submission until it can be inspected again. A transient GitHub API
failure is indistinguishable from a permanent historical-data failure; rerun after a transient error,
but do not bypass C10 or treat the missing inspection as zero submissions.

## Subscribe manually

Review a catalog entry as a suggestion, then open `/settings` in your own X Collector deployment and add that one handle. Confirm its topic and ownership yourself. Repeat individually for any other source you want. There is deliberately no bulk community-list import command.

### What the `no-auto-subscribe` suite does and does not guarantee

**What this suite is for.** It guards against this project's own future changes accidentally wiring
the community catalog into the subscription table. It is not a defence against a maintainer who
deliberately sets out to defeat it — anyone with commit access to this repository can change anything,
and no test in the repository can prevent that. The suite is built to catch code a maintainer could
plausibly write during ordinary work. A contributor who deliberately chooses an unusual spelling to
avoid the recognised shapes can succeed. Direct `Reflect.apply` on a delegate and direct
`fs.openAsBlob` are caught by the general rules, not by dedicated regression cases. The in-suite
self-regressions cover the supported path bindings and path idioms, lexical constant shadowing,
descriptor-first filesystem APIs, repository-data writes, type-only imports, and dynamic module
acquisition. Reflective/wrapper variants, paths assembled from opaque fragments, and harness detection
are outside the coverage promise.

**What it cannot reach.** A community contribution can never introduce any of this: check C1 rejects
any pull request that touches a path outside `data/community-sources/`. Every construction the suite
does not catch requires a human-authored change to this repository's own source.

The **static** legs are load-bearing within that bound. A direct call shaped like
`<anything>.<schema delegate>.<write method>` is treated as a database write without first proving the
receiver is a Prisma client. A delegate-shaped write-method reference that is not directly invoked is
rejected, and inline Prisma relation `create`, `update`, `connectOrCreate`, and `upsert` objects are
walked for nested writes. Raw-method calls are tracked in direct, bracket, destructured, aliased,
`Reflect.get`, and bound forms; each allow-listed call includes a hash of its normalized SQL body, and
non-allow-listed DML is rejected. Values used by these recognised shapes fail closed when unresolved.

The filesystem-write rule scans every loadable source file in the repository. A write that can land
under `data/` is rejected unless its exact file, API, and resolved target are in `ALLOWED_DATA_WRITES`;
that allow-list is empty today. An unresolvable write path also fails closed. If such a file both reads
the catalog and writes under `data/`, both accesses are reported. This repository-wide write set is
deliberately broader than the read set: reads under `data/` are checked for every recorded Prisma or
raw-SQL writer and its downward local import closure, with the single exception of
`import-x-handles` reading `data/x-handles.json`. The constant resolver follows lexical scope, so a
same-named binding in another function or block cannot supply the value. Files that write `source` or
`alertSource` have their downward local import closure checked for network targets. Bare and
`globalThis` fetches are inspected; runtime network-module acquisition, including dynamic import, is
allow-listed; and calls through an acquired namespace or function alias are inspected. Type-only
imports are not runtime acquisitions. Statically resolved targets must use an allow-listed HTTPS
origin, while each legitimate dynamic target has an exact allow-list entry.

The repository walk covers Next's effective page extensions plus Node's JS/TS module extensions and
fails if a `next.config.js` `pageExtensions` override declares an extension the analyzer does not
cover. It is not limited to `src/`. Thus “writer plus imports” describes only the data-read and literal
tripwire set; it does not describe the repository-wide filesystem-write set.

The filesystem guard follows `fs`/`fs/promises` acquisition, including dynamic import, and inspects
every namespace call. Known APIs use their read/write path positions; descriptor-first APIs such as
`writeSync`, `fsyncSync`, and `closeSync` are not treated as path calls, and definitely numeric
arguments are not path candidates. Supported static paths include resolvable template expressions,
`path.posix`/`path.win32`, destructured path methods, and path-method rebinding. Calls rooted at
`os.tmpdir()` or `os.homedir()` resolve outside the repository and are safe, while a path that can land
under `data/` is rejected. The package script map and both dependency maps are snapshotted, so a new
execution path or database/network client is a visible test change.

The **behavioural** legs — the `Source` set-equality run and the filesystem and subprocess trace — are
a convenience check on the ordinary executed path, not a guarantee. The filesystem patch does not
reach `worker_threads` isolates; a writer that spawns a subprocess is rejected outright.

If an ordinary non-Prisma object happens to have a delegate-shaped call, add its exact callee expression
to `ALLOWED_NON_PRISMA_DELEGATE_SHAPES` after review. If a legitimate network target cannot be resolved
statically, add the exact expression or reported call hash to `ALLOWED_UNRESOLVED_NETWORK_TARGETS`.
If a legitimate filesystem read cannot be resolved statically, add an exact, shape-checked entry to
`SAFE_COMPUTED_FS_READS`; each entry must identify the file, binding, expected filename, and initializer
shape. Legitimate computed writes use the equally narrow `SAFE_COMPUTED_FS_WRITES` path, while an
intentional write under repository `data/` requires an exact `ALLOWED_DATA_WRITES` entry. These are
narrow false-positive responses, not instructions to weaken the general rule.

To regenerate raw-SQL body hashes after deliberately editing a legitimate query, run:

```sh
npx ts-node src/scripts/community/no-auto-subscribe.test.ts --print-raw-sql-snapshot
```

Review the normalized query and any DML warning, then update `EXPECTED_RAW_SQL_CALLS` and, only when the
DML itself is intended, the exact `ALLOWED_RAW_DML_CALLS` entry. The command prints candidates; it does
not modify or auto-approve the snapshot.

## Remove an entry

A maintainer removes an entry by opening a same-repository pull request that deletes its JSON file. Trusted same-repository maintainer PRs are classified as informational regardless of file shape, so the gate does not block this revocation path and never auto-merges it.

Deletion removes the entry from the current tree only. A merged entry is permanent in public git history and cannot be taken back from existing clones. Do not contribute `first_seen` or any other field unless you accept that permanence.

## Auto-merge deployment checklist

`AUTO_MERGE` is parsed only as `process.env.AUTO_MERGE === "true"`; the string `"false"` must never be treated as truthy.

If owner decision #1 remains `"false"`:

1. Keep `AUTO_MERGE: "false"` in `.github/workflows/community-sources.yml`.
2. Require the exact check `Act on community source contract` for `main`. Do not require `Validate community source contract`; it always exits 0.
3. Confirm `synchronize` runs clear the stale `community-source:validated` label before applying the new verdict.
4. Maintainers merge only after the exact current head has a passing `Act on community source contract` check.

The `act` job uses `if: ${{ !cancelled() }}`. `validate` normally exits 0 after emitting a contract,
while a job failure or missing/malformed output makes `act` fail during strict contract parsing instead
of being skipped. Cancellation does not start a stale privileged job. For a malformed event with
`pr_number: 0`, `act` cannot safely select an issue for a sticky comment and returns failure before
commenting; this is fail-closed, not a reachable comment path.

If owner decision #1 becomes `"true"`:

1. Enable repository settings that allow GitHub Actions to merge and retain squash merges.
2. If `main` gains branch protection, keep the exact required check name `Act on community source contract` and add only the narrowly required `github-actions[bot]` carve-out without weakening contributor restrictions.
3. Change only the workflow value to `AUTO_MERGE: "true"`; do not add an Actions-expression truthiness condition.
4. Verify the action re-asserts the PR head SHA, checks the dedup key against the latest `main` tree, and supplies explicit squash `commit_title` and `commit_message`.
5. Exercise both a changed-head rejection and a duplicate-race rejection before enabling it as unattended policy.

The squash commit author identity remains contributor-controlled Git metadata because GitHub's merge API cannot override it. The title and message are gate-controlled and contain only validated fields.
