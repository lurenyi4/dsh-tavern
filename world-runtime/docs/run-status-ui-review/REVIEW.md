# Independent ordinary functional review — e8a2402

Date: 2026-10-05 UTC
Target: `dsh-tavern-recovered/Story-Runtime-Linux-0.1.0`, branch `feat/local-media-imports`, HEAD `e8a24028145dea3de4c71ab7503726321a2227ab`.
Baseline: published media commit `e327359`.

## Verdict: CHANGES REQUESTED — one confirmed P2

This is a fresh independent ordinary code-quality/functional review, not an adoption of the maker's 215/10 results or a conversion of the interrupted bd9 full review into a PASS. Existing ordinary gates independently pass, but an additional isolated DOM contract fails. No source, staging area, ADR, remote branch, or published artifact was changed by this review.

### P2: cancelled snapshot warning disappears from the UI after reopening the world

- Location: `world-runtime/public/app.js:694–719`, especially line 716; related reattachment selection at lines 239–244.
- The server's `view()` overlays a queued cancellation's `persistenceWarning` and cancelled status on the durable run. This is appropriate and prevents the stale persisted status from being presented as retryable.
- `renderRuns()` consumes that snapshot but displays only `r.error?.message` or “这次草稿没有改变世界。” It never displays `r.persistenceWarning`. `loadWorld()` subscribes only to accepted/generating/draft runs, so this cancelled entry does not acquire the warning through a new SSE subscription.
- Consequently the current SSE recipient gets the new storage warning, but a fresh DOM/reopened world cannot see that its cancellation record remains unsaved even while the same server still has the diagnostic. The generic cancelled label is not itself a false statement about world commits; the defect is loss of the actionable persistence warning.
- Evidence: `dom-contract.test.mjs` extracts the actual current `renderRuns` and `watchRun` function declarations using Acorn and runs them with ordinary jsdom/function fixtures, without a network or storage fault experiment. Current cancelled SSE warning test PASS; snapshot-to-history warning test FAIL. Actual text: `已取消 · 9:00:00 AM这次草稿没有改变世界。ordinary draft`.
- Suggested repair: render the diagnostic from the existing snapshot in run history, keeping any distinct run error/draft information, and retain the existing disabled retry affordance. Add a DOM contract for reopening a cancelled warning-bearing snapshot. No new state store or polling layer is needed.
- Severity: P2, user-visible error-reporting/continuity defect; no demonstrated canonical-world mutation or data corruption. The isolated DOM test proves the rendering omission, not an end-to-end induced filesystem failure.

## Independent verification

| Check | Result | Evidence |
|---|---|---|
| `node --test world-runtime/test/*.test.mjs` | 215 passed, 0 failed, 0 skipped | `unit.log` |
| `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs` | 10 passed, 0 failed, 0 skipped | `http-dom.log` and generated DOM JSON records |
| Additional actual-function DOM contracts | 1 passed, 1 failed | `dom-contract.test.mjs`, `dom-contract.log` |
| `git diff --check` | exit 0 | final verification |
| Worktree check | clean at completion | final verification |

The ordinary DOM suite's three tracked evidence JSON files were captured before the run, fresh results copied to this external review directory, and original contents restored. Unit/HTTP/DOM gate evidence here is independently generated against this HEAD. The added test command itself exits 1 as expected from the unmet history-warning assertion; its log capture command subsequently printed the log.

## Scope and code-quality assessment

Read the complete production delta since e327359: ImportJobs admission/finalization/close, server request ownership/close/autonomy/deferred scheduling, the small queued-work helper and changed UI callback. Also inspected the unchanged importer publication, resource recovery, normalized content/backup closure and associated ordinary UI paths to assess integration. Read current `DEFERRED_RUN_OWNERSHIP.md`, `IMPORT_SERVICE_LIFECYCLE.md`, `CURRENT_VALIDATION.json`, `CONTRACTS.md`, `MEDIA_IMPORT_SLICE.md`, `NORMALIZED_CONTENT_CONTRACT.md`, repository AGENTS instructions and supplied development plan/KISS guidance. There is no `CURRENT_VALIDATION.md`; the current manifest is JSON.

### Lifecycle and publication

- Public import mutations use admission ownership, and worker completion is independently tracked. New work is refused once close starts. Close aborts producers before joining admitted promises and performing final cleanup; status labels no longer substitute for completion ownership.
- Upload preparation rechecks abort after asynchronous journal save, before worker creation. Worker completion preserves cancelled/interrupted decisions and remains owned through ordinary finalization.
- History eviction reserves the old job, waits admitted old operations, and retains retryable cleanup ownership on failure. Cancel does not join its own public promise. Failed create becomes terminal instead of retaining an invisible busy slot.
- Acceptance preserves completed publication separately from final journal failure; close collects unresolved persistence/cleanup warnings and coalesces repeated calls. Original preview→accept→atomic-publication and cancel-before/after-publication boundaries remain in place.
- Startup recovery remains under the exclusive server lock. Import journals remain staging/audit metadata, not canonical cards or backup contents. Exact originals, normalized metadata, resource/media hashes and backup closure limits are unchanged.

### Server and deferred work

- Request handler promises, rather than socket close, own admitted asynchronous business operations for the shared route wrapper. Shutdown closes admission, stops incomplete-body waiting, joins handlers and background work, then closes remaining transports and attempts every disposer.
- Deferred turn and settlement-retry work enters the existing jobs set before `setImmediate`. Successful, rejected and cancelled-start callbacks all settle ownership. Both continuations are installed to avoid an unobserved derived `finally` rejection.
- `cancelQueuedRun` separately reports cancelled status and save outcome, calls the notifier after ordinary save rejection, preserves a generic storage warning, and clears it after a successful subsequent helper save. Function tests verify notification rejection remains observable.
- The server preserves queued cancellation warnings in live records, snapshot/reconnect/cancel responses and close warnings. Ordinary successful work continues to be evicted. The confirmed gap is specifically the snapshot consumer's history rendering.

### Spec, standards and KISS

The changes use standard ESM, promises, sets/maps and the existing SQLite/content-addressed storage architecture. No second canonical store, global task engine, harness, provider registry or unconditional retry service was introduced. Added complexity directly expresses admission, producer completion, disposal and diagnostic ownership; the small queue helper is justified reuse for two launch sites. The substantial new test/evidence volume is not itself a reason to remove necessary coverage. Boundary documentation explicitly separates publication from persistence and local normal checks from platform/product acceptance. The UI omission prevents the full error-visibility contract from being met.

## Important limits / adjacent static observations

- The new helper covers cancelled starts. The older already-started `launch()` catch (`server.mjs:398–444`, present before this delta) still catches a cancellation `saveRun` error into `run.error`, sends a cancelled event with `{}`, and allows ordinary terminal cleanup. It has not been unified with the new warning path. This is a static adjacent error-propagation limitation, not an independently reproduced new regression; no dynamic fault experiment was performed. Do not advertise the current patch as proving persistence-warning visibility for every possible running cancellation.
- No new network-triggered fault experiment was created or run. The previously blocked `http-drain-full` reproduction was neither read nor executed, and the safety interruption was not worked around. Only the repository's existing ordinary gates plus a pure DOM/function contract were executed.
- No real Chromium/browser visual/audio PASS, Android/native bridge acceptance, macOS/Windows run, hardware power-loss claim, representative licensed ecosystem sample evaluation, paid model quality/cost evaluation, full original Tavern suite, or full original product completion is asserted.
- No publish/push/Codex CLI/new cloud task was performed. Existing remote failed CI is historical context, not repaired or rerun by this review.

## Required next step

Fix the confirmed history-warning P2 with the existing snapshot field, rerun the new DOM contract and ordinary gates against the resulting commit, and obtain independent review for that updated source. This review is not publication approval.
