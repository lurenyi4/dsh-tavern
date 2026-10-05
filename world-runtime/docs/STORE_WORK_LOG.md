# Linux WorldMode storage implementation log

## Scope and storage contract

Implemented on Linux with Node v24.19.0 and the built-in `node:sqlite` driver. No dependency install, remote/model call, Codex CLI, separate cloud task, or upstream full-suite run was used. Existing Tavern source was not changed by this storage work.

- Authority: `<dataDir>/world.sqlite`; parent directories created with private permissions, symbolic-link storage paths refused
- Explicit format/version metadata, `PRAGMA user_version=1`, strict schema fingerprint checking, integrity/reference checks on open; unrecognized and older schemas require an explicit supported migration and are refused
- SQLite WAL, synchronous FULL, foreign keys, bounded busy timeout, short `BEGIN IMMEDIATE` writes, consistent read transactions
- Immutable canonical scene text, per-operation event provenance, after-state snapshots, head/source guards, usage on commit, and projection outbox share the same transaction
- Run deduplication is scoped to `(worldId, branchId, runId)`. Same payload returns the original commit; changed payload conflicts. Different worlds/branches may independently use the same run key
- Fact locks require the trusted `author` argument, never a model-supplied operation field. Beliefs remain separate from facts; descriptions/backstory create no past scenes
- Characters use stable IDs, including `card-main` and `player`; matching display names are independent characters. Location is singular, directed relations are multivalued
- Fork state and complete ancestor scenes stop exactly at the selected reachable immutable commit. The parent's later future and sibling future are excluded
- A new branch has its own pending outbox receipts for inherited scenes. Explicit `markProjected(worldId, branchId, commitId)` acknowledges only that scoped projection
- Schedules execute by `(at, id)` in a bounded batch with deterministic run IDs. Preconditions and effects are revalidated, invalidated events cancel, explicit cancellations stay cancelled, and no-op time advancement creates no phantom event. If due work remains after a budget limit, time does not jump past it
- Online backup uses the official SQLite backup API to a newly reserved file. Existing targets are refused. An active backup blocks `close()` until it completes

## Coordinator-approved API additions

The coordinator owns `CONTRACTS.md`; the following additions were explicitly agreed during integration:

- `saveRun({worldId,branchId,runId,expectedHead,sourceRevision,userText,mode,status,draft,operations?,error?})`: durable noncanonical draft/run state; original request identity and preconditions stay fixed
- `getRun(worldId,branchId,runId)` and `listRuns(worldId,branchId)`; snapshots include the 50 most recent local runs
- Run modes: `demo`, `openai`; statuses: `accepted`, `generating`, `draft`, `committed`, `failed`, `cancelled`, `interrupted`
- A canonical commit atomically marks its matching saved run committed. Cancelled runs cannot resume or commit via a late callback. Failed/interrupted drafts are retained for explicit retry; the server owns startup interruption marking
- `recordAttempt({worldId,branchId,runId,attemptId,mode,inputTokens?,cachedInputTokens?,outputTokens?,status,error?})`: unknown token counts stay null. `attemptId` is a global request identity; `started` can progress to `completed`, `failed`, or `cancelled`; terminal data is idempotent and immutable
- Commit `usage`, when supplied, contains the attempt fields without world/branch/run IDs; the enclosing commit determines their scope
- `resetProjectionReceipts() -> {reset}`: trusted restore-only operation, resets delivered receipts to pending without changing state, narrative, runs, or usage
- `revise({worldId,branchId,commitId,name,narrative,operations}) -> snapshot`: atomically forks immediately before the reachable target scene and commits a replacement with the original user text, `author:true`, and source `author-revision`. The original timeline stays immutable; every failure rolls the fork and active-branch update back
- `advance.executed` and `advance.cancelled` are arrays of schedule IDs

Initial safe declarations are `card.extensions.story_runtime.characters` (`id`, `name`, optional `description`/`location`), `variables` (bounded scalar map), and `schedules` (schedule fields without `op`/`id`). Generated fact/goal/plot/schedule IDs are internal UUIDs. An optional operation `id` updates an existing reachable object; omit it to create a new object. Unknown scripts are preserved as card data, never executed.

## Verification history

Commands run from the fixed `host-source` checkout:

1. `node --test world-runtime/test/store.test.mjs`: exit 1 before implementation, expected missing store module (test-first baseline)
2. Initial implementation run: exit 1, SQL placeholder counts incorrect; corrected counts
3. `node --test world-runtime/test/store.test.mjs`: exit 0, 6/6
4. Added durable run/attempt, rollback, stale writer, schema/path, and negative tests: exit 1, late cancelled-run commit was initially accepted; added terminal cancellation guard
5. `node --test world-runtime/test/store*.mjs`: exit 0, 16/16
6. Whitespace cleanup exposed incorrect template whitespace in schedule run IDs: exit 1, corrected template literals; repeat exit 0, 16/16
7. Added branch-scoped same-key runs, restore receipts, initial declarations, and no-op clock cases: exit 0, 20/20
8. Added atomic scene revision rollback and exact-schema refusal: exit 0, 22/22
9. Final syntax and focused suite commands recorded below

Coverage includes transaction fault injection after scene insertion, after state update, and immediately before commit; a fresh database reader verifies no residual events. The injection helper only activates in the built-in Node test runner. Other tests cover immutable fork history, cross-scope IDs/ACKs, many relations, same-name entities, private/locked facts, all operation categories, malformed/unknown/prototype keys, finite safe integer requirements, inventory underflow, recursive schedule refusal, false/invalidation cancellation, usage unknowns/idempotency, restart persistence, two independent database connections, schema migration refusal, symlink rejection, online backup restore and integrity, and closed-store checks.

These storage checks are not a claim that the integrated server, DSH projection, browser UI, or non-Linux platforms have passed. The coordinator owns their separate integration acceptance. No commit was created by this worker.

Final: `node --check` on all three storage modules: exit 0; `node --test world-runtime/test/store*.mjs`: exit 0, 22/22 tests (2026-10-04 UTC).

## Native numeric variable increment extension (2026-10-04 UTC)

Added the coordinator-requested declarative operation `{op:'increment_variable',key,amount}`. The variable must already exist as a number; missing variables and strings/booleans are rejected without coercion. `amount` and the resulting value must be finite with absolute value at most `Number.MAX_SAFE_INTEGER`. Fractions follow the existing `set_variable` bounded-number semantics. Unknown fields, prototype keys, NaN, Infinity, and out-of-range sums are rejected. The operation uses the existing atomic commit, branch scope, idempotency, and trusted-author rules; a failed later locked-fact update rolls the increment back.

A scheduled increment is revalidated at execution. If the numeric target has become nonnumeric or the sum is no longer valid, the schedule is cancelled through the existing invalidated-event path instead of stopping the whole advance transaction.

Verification:
- Added two increment tests before implementation; `node --test --test-name-pattern='increment_variable' world-runtime/test/store-recovery.test.mjs`: exit 1, 0/2, unknown operation (expected red)
- Implemented the allowlist/reducer operation; same focused command: exit 0, 2/2
- Added scheduled-target invalidation test before the scheduler integration change; `node --test --test-name-pattern='scheduled increments' world-runtime/test/store-recovery.test.mjs`: exit 1, 0/1 (`INVALID_VARIABLE`, expected red)
- Added `INVALID_VARIABLE` to due-event effect invalidation handling
- `node --test world-runtime/test/store*.mjs`: exit 0, 25/25, all original 22 tests preserved
- `node --check world-runtime/src/store.mjs && node --check world-runtime/src/domain-state.mjs`: exit 0

Increment tests cover positive/negative/fractional amounts, preview-without-commit immutability, repeated same-run settlement without double increment, branch isolation, missing/nonnumeric targets, unsafe numbers and results, unknown/prototype fields, atomic rollback, locked-fact isolation, and scheduled invalidation. No other module, schema, or dependency was changed.
