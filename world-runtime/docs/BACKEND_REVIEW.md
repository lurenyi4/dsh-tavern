# Linux WorldMode backend independent review

Review date: 2026-10-04 UTC, first pass 16:24–16:34

## Decision

**Initial review: FAIL. Critical: 0; Major: 5; Minor: 1.**

This is the as-found independent backend Spec/Quality review. Fixes were being made concurrently after findings were reported; implementer reports of fixes are not an independent final pass. A fresh review and regression run against the completed implementation are required. UI and final Linux-product acceptance are outside this decision.

The Linux-first scope is authorized. Missing Android/macOS/Windows qualification is not a reason to block this Linux implementation, and this review does not mark those platforms supported.

## Scope and method

Read `LINUX_SCOPE.md`, `CONTRACTS.md`, `ADR-LINUX.md`; the original development plan's invariants, single-authority/atomic commit, import, branch/revision, context/visibility, cancellation, usage and backup sections; all backend `src/*.mjs`; CLI/install entry points; model, HTTP, import, store and store-recovery tests; and `test/e2e-api.mjs`. Inspected the reused upstream card projector and pinned native Session/surface/persistence contracts where needed.

The actual backend uses Node 24.19.0, SQLite, HTTP/SSE and the pinned DSH 0.1.5-rc.2 runtime at `../dsh-pinned`. All additional exercises used temporary, reviewer-owned local data and benign sentinel strings. No remote model calls, paid requests, full Tavern tool profile, publication, independent cloud task or Codex CLI were used. Product source files were not changed by this reviewer; this report is the sole repository write.

The checkout was not frozen: initial source reads and tests preceded the implementer's B01–B05 corrections, and server integration edits were visible during review. Line numbers below identify the **as-found version**, not a promise that later files retain those lines.

## Independently executed checks

- `node --test world-runtime/test/*.test.mjs`: **55 passed, 0 failed**, initial source
- `node world-runtime/test/e2e-api.mjs`: **3 passed, 0 failed**, initial source
- Additional private-fact update, nested schedule and planned-plot sentinel checks: exposed B01/B02 despite the green existing suite
- Real local mock OpenAI SSE with an incomplete partial narrative: exposed B03
- Real PNG import → world → backup → omitted referenced asset → restore: exposed B04
- Real HTTP action without `branchId`: exposed B05
- Long valid card description plus current locked fact and variable: exposed Q01
- Native projection durability failure after scene A was persisted but before ACK: explicit retry produced exactly A then B, once each, and both receipts became delivered
- Native projection surface replacement during awaited persistence: valid native replacement caused `HOST_SURFACE_CHANGED`; receipt remained pending

Passing the existing suites was not treated as semantic proof. The additional checks deliberately exercised cases absent from the existing assertions.

## Major findings

### B01 — Private values leak through scene operations

**Severity:** Major, Spec/Quality

**As-found location:** `src/model.mjs:4,10–11`; reducer preservation semantics in `src/domain-state.mjs` `set_fact`/`set_goal`

The player filter checks each raw operation's own `visibility`, without resolving the resulting entity's visibility or recursively checking nested operations. The reducer correctly preserves old visibility when an update omits it. Consequently, state can remain private while the raw mutation exposes its value to the player.

Benign reproduction:

1. Author-commit a fact with `holderId: 'card-main'`, `visibility: 'private'`, value `PRIVATE_OLD`
2. Update that fact by ID with value `PRIVATE_UPDATED`, omitting visibility and holder
3. Read `visibleSnapshot(snapshot)`
4. The fact is absent from `state.facts`, but `PRIVATE_UPDATED` remains in `scenes[].operations`
5. An author-created schedule containing a nested private fact operation similarly exposes `PRIVATE_SCHEDULED` through the scene's schedule operation

Observed: `updatedPrivateLeaked=true`, `nestedPrivateLeaked=true`. Existing tests only covered top-level operations that repeated private visibility explicitly.

Required outcome: player serialization must not release private mutation payloads, including ID-based updates and nested schedule payloads. Keep author audit detail available and retain public provenance without returning the unfiltered proposal.

### B02 — Planned-only plot material is exposed as public state

**Severity:** Major, Spec

**As-found location:** `src/model.mjs:7–10,38–39`

`visibleSnapshot` leaves all plot threads intact, and `compileContext` serializes them under “本轮公开状态”. A thread with status `planned` is therefore visible before it has been planted as evidence. The state label does not create a sufficient visibility boundary.

Benign reproduction: commit a `set_plot_thread` with label `PRIVATE_UNPLANTED_PLAN`, status `planned`. The sentinel is present in both player snapshot JSON and compiled model messages.

This conflicts with Linux scope's exclusion of secrets/future plans from public canon, the original plan's separate planned hints versus planted evidence, and I-09. Required outcome: planned-only author material must be excluded from player/model-visible state and audit payloads; public planted evidence may remain available.

### B03 — Failed/interrupted OpenAI narrative drafts disappear from player/replay views

**Severity:** Major, Spec/Quality

**As-found location:** `src/model.mjs:16`; `src/server.mjs` `launch` OpenAI `onRaw`/`onDraft` callbacks and run event replay

The streaming callback replaces `run.draft` with an already-parsed narrative string. After failure/cancellation/interruption, `publicDraft` assumes it is raw structured JSON and calls `parseModelReply`. A plain narrative fails that parse and becomes an empty string. Saved data and public replay disagree.

Local protocol reproduction:

1. Configure a local HTTP mock only
2. Return a valid SSE delta beginning a JSON narrative with text `Visible partial narrative `, then EOF without a finish marker
3. The run ends with `MODEL_INCOMPLETE`
4. Author snapshot contains the saved partial narrative; player snapshot draft is empty
5. Replayed SSE returns `draft {text:""}` and an error claiming the draft was retained

Observed author draft: `Visible partial narrative `; player draft: empty. This also affects normal parsed narratives saved before settlement failure or restart, not just malformed raw responses.

Required outcome: use one unambiguous persisted/public draft representation or separate raw provider data from safe narrative. Failed, cancelled and interrupted public narrative drafts must remain visible after refresh/replay without exposing raw private operation proposals.

### B04 — Restore accepts a bundle missing required referenced resources

**Severity:** Major, Spec/Quality

**As-found location:** `src/backup.mjs:22–29`

Restore verifies hashes of files that happen to be listed and validates SQLite structure. It does not validate the closure of registered-card/world-card references: required card records, original source, preserved resources and display assets can be omitted without failing restoration. The new directory is published as successfully restored even though content is missing.

Benign reproduction:

1. Import a valid fixture PNG, create its world, and create a normal backup
2. Remove only that card's `assets/<hash>` file record from the bundle, retaining all remaining hashes unchanged
3. Restore to a new directory
4. Restore succeeds with `projection: pending-explicit-rebuild`
5. Reading the referenced asset fails with `ASSET_NOT_FOUND`

Observed bundle went from 6 files to 5; restore accepted. Checking only each included file's hash cannot detect this omission.

Required outcome: verify reference closure, identity, expected hashes/sizes and required artifacts before publishing the restore directory. A rejected bundle must not create a usable partial target. Apply equivalent consistency checks when creating a backup from a damaged source. Restore must remain new-directory-only and must not include model credentials or derived host logs.

### B05 — Missing branch scope silently selects the active branch for mutations

**Severity:** Major, Spec

**As-found location:** `src/server.mjs:79` and subsequent world POST handlers

`store.snapshot(w, b.branchId)` accepts omitted/null branch IDs and returns the active branch. POST handling then substitutes that branch into authoritative operations. An incomplete request can consequently mutate a different branch after another tab selects a branch, rather than failing closed.

Benign reproduction: POST `/api/worlds/<world>/actions` with a narrative and `set_variable(scope_check,true)`, but no branch ID. Observed HTTP 200 and committed `state.variables.scope_check=true` on the active branch.

This violates ADR-LINUX #5 and the explicit scope in the POST contract. Affected handling includes turn, actions, advance, fork, revise and autonomy. The contract's default active branch for read-only snapshots is a separate, intentional convenience.

Required outcome: require a nonempty valid `branchId` on every branch-mutating world POST before resolving state. Verify unknown and foreign-world branches also fail without mutation. Scoped run tokens may continue to supply their already-fixed scope for cancel/retry.

## Minor finding

### Q01 — Character description can consume the entire current-state context budget

**Severity:** Minor, Quality

**As-found location:** `src/model.mjs:38–39`

`JSON.stringify(state).slice(0,18000)` can cut JSON in the middle of a character description. Because descriptions precede facts, inventory and variables, a valid long card causes all those current values to disappear from the request. Card descriptions are also already supplied separately, so this is redundant budget consumption.

Benign reproduction: create a card with a 22,000-character description, then commit a current locked fact and a current variable. Neither sentinel was present in compiled messages; the state block ended in the middle of the repeated description.

Recommendation: serialize a bounded structured projection, limit character state to useful identity/location fields, budget collections deliberately and indicate omissions. Do not truncate the serialized JSON arbitrarily. Add a long-card regression ensuring current locked facts and recent relevant state remain usable.

## Positive findings / bounded conclusions

- SQLite is the sole world authority. Body, operations/events, after-state, outbox and run completion share the commit transaction. Existing fault seams exercise rollback after body, after state and before commit
- Store-level write paths enforce world/branch relationships, expected head/source revision, immutable commit ancestry and scoped run idempotency. Same run/different payload rejects; fork/revise excludes sibling future and invalid revision rolls back its branch creation
- Facts/character knowledge are separate collections; single location, directed multivalue relationships, strict operation allowlist, safe integer inventory and author-only locked-fact changes are enforced by the reducer
- Scheduled actions are bounded and deterministic; invalid conditions/inventory cancel safely; empty unchanged time does not create fake NPC events; autonomy uses no model calls and starts disabled after restart
- The model request has no tools, shell, SQL or file capability. The protocol path makes one request, uses bounded response/output sizes and does not automatically repeat paid requests. Unknown usage is null rather than zero
- Native projection queues are scoped and inspect durable persisted history before ACK. Independent F01-style failure retry and F02-style asynchronous surface replacement checks did not reproduce the prior regression
- Import parsing is data-only. Original bytes, unknown fields, module bytes and resource hashes are preserved; unsupported script behaviors are explicitly reported rather than executed. Archive count/size/ratio/depth/name/type checks and safe media serving were exercised by the independently rerun tests
- Backup uses the official SQLite online backup API and excludes derived host directories and server environment credentials. Restore is staged in a fresh directory and resets projection receipts for explicit reconstruction. B04 still blocks a full integrity claim

These are scoped conclusions, not blanket security or compatibility certification. No real provider billing/cache behavior, arbitrary legacy scripts, old full-Tavern migration, other operating systems or final browser UI were qualified here.

## Remediation state when this report was written

The integration owner reported B01/B02/B03 fixes and passing focused tests while this review continued. B04 was assigned for a reference-closure correction; B05 was being corrected. Those reports are recorded for coordination only. **This initial review remains FAIL until the final code is independently rechecked.**

Final acceptance should include the five reproductions above, Q01 if corrected, the existing aggregate suites, real native projection recovery tests, and a separate actual browser/product review after UI integration. Any further source changes invalidate earlier acceptance of affected behavior.
