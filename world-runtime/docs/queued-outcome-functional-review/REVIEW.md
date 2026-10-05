# Ordinary functional and code-quality review

Reviewed candidate: `2a9d6ad1ae869fbb81b18ba151daa58b19912b58` on `feat/local-media-imports`.
Base: published `e327359`; reviewed cumulative changes in `1265570`, `1732191`, `bd9a050`, and `2a9d6ad`.
Date: 2026-10-05 UTC.

## Decision

**Changes requested for one ordinary error-reporting defect (F1, medium/P2).** The reviewed normal success/cancel/close paths and executed regression tests pass. No additional major defect was identified within this review's permitted scope. This is an independent static and ordinary-functional assessment, not a completed security or interrupted-network assessment, and not a publication approval.

### F1 — Deferred-start cancellation loses its outcome when saving the cancellation fails

Location: `world-runtime/src/server.mjs:439–455`, especially `443–446`; supporting ownership behavior: `world-runtime/src/queued-work.mjs:8–18`; shutdown settlement at `server.mjs:1158–1165`.

The newly introduced cancellation callback changes the in-memory status to `cancelled`, then synchronously calls `store.saveRun`, then calls `notify`. `saveRun` performs a database transaction and can throw. On that ordinary storage-error path, `notify` is skipped. The helper rejects its owned Promise, but its rejection continuation removes that Promise from `jobs`. `queueLaunch` also removes the now-terminal run from `live`; neither route that calls `queueLaunch` observes its returned Promise. During close, `Promise.allSettled` also does not propagate the rejected job into the close diagnostics.

Consequently the previously accepted/draft record can remain persisted in its old state while the in-process run disappears without a terminal notification or surfaced storage diagnostic. An existing subscription, if present, is not ended by that callback. A later lookup uses the old saved record; shutdown can return without exposing the failed cancellation persistence. This is inconsistent with the regular `launch` error path, which catches save errors and still emits a terminal event.

This finding is based on source control flow. **No new storage/network fault reproduction was created or executed for it.** Client-observable timing and concrete storage-failure behavior remain unverified. The ownership boundary itself still waits until the callback settles; the defect is outcome handling, not demonstrated post-close activity.

Suggested bounded correction: use the existing terminal error-handling conventions for cancelled startup; ensure notification/cleanup remains reachable even when persistence fails, retain/surface the persistence error, and make close aware of relevant rejected deferred finalization. Add ordinary function-level callback-error coverage at the queueLaunch integration boundary. Do not introduce a second run registry or a general scheduler.

## Static coverage and positive conclusions

Read the complete production diff and surrounding call sites in `import-jobs.mjs`, `server.mjs`, and `queued-work.mjs`; read `IMPORT_SERVICE_LIFECYCLE.md`, `DEFERRED_RUN_OWNERSHIP.md`, `CURRENT_VALIDATION.json`, `MEDIA_IMPORT_SLICE.md`, and changed normalized-content lifecycle notes.

- Import admission/ownership: create/upload/accept/cancel are rejected once closing begins; admitted operations are tracked until settlement; parsing-worker completion has independent ownership. Upload checks cancellation again after preparing persistence and before worker launch.
- Finalization/history: terminal states are not used as completion promises; cancellation excludes itself from joining; history reserves the old record before awaiting existing work. Reservations clear on failure. Failed create is finalized rather than silently leaving a live busy job.
- Publication/persistence: successful import publication remains completed when final journal persistence fails. Manager close retries persistence and returns unresolved warnings; repeated close shares the same outcome rather than restarting work after resource release.
- HTTP business work: the common wrapper registers all admitted handlers, with completion independent of response transport lifetime. Read, write, legacy import, world creation and backup routes share this boundary. This was statically reviewed only for interrupted transport cases.
- Shutdown: admission stops before draining, import manager and HTTP business work settle before background draining, autonomy ticks belong to the existing job set, and disposal attempts aggregate errors. Store/projection/lock disposal follows owned business work. New deferred turn and retry work is owned at queue time, and startup checks shutdown/abort before model or settlement work.
- Progress/preview/import/backup: no production changes to importer format processing, backup limits, preview UI or media renderer in this cumulative diff. Existing ownership changes preserve preview acceptance, exact-original retention and cancellation/publication distinctions in the exercised tests.
- Simplicity: the changes reuse the existing sets/maps and Promise completion boundaries. `queueOwnedWork` is a small helper, not a new runtime or persistent state machine. Deferred wrapper plus launched job are nested ownership, not duplicate execution. F1 is where promise cleanup and truthful business completion currently diverge.
- Existing accepted importer registration/cleanup double-fault minor is unchanged. This review does not silently close it or reopen the product's device/ecosystem gates.

## Independently executed checks

1. `node --test` with these existing files: queued-work, import-jobs, import-finalization, import-service-lifecycle, media-publication, media-backup, backup-closure, content-contract, server: **75/75 passed**, zero failed/skipped/cancelled. See `normal-regression.log`.
   - Includes normal turn, cancel, idempotency, restart, local model-protocol mock, backup/restore, media publication, preview imports, manager finalization and existing local persistence/disposal contract checks.
   - Existing import-service tests include storage-error coverage using normal local HTTP; no new network-fault test was authored.
2. Existing `world-runtime/test/e2e-api.mjs`: **3/3 passed**, zero failed/skipped/cancelled. See `http-api.log`.
   - Covers end-to-end imports, cancellation, schedules, fork, backup, durable draft retry without a new model call, and bounded autonomy.
3. `git diff --check e327359..HEAD -- world-runtime/src world-runtime/test`: passed; `source-diff-check.log` is empty as expected.
4. Whole cumulative `git diff --check` reports only trailing whitespace in captured historical text logs (published-media-ci-failure and service-lifecycle-focused-review/red). No source-format failure found. These historical evidence lines were not changed.
5. HEAD and branch reconfirmed; working tree remained clean after these checks. No source, staged ADR, commit, branch, or remote was changed.

## Explicit limitations and evidence boundaries

- The earlier bd9a050 full review was interrupted by platform safety checking and remains incomplete/not PASS. This report does not replace that fact with a full-review approval.
- Did not read or execute the prohibited `http-drain-full` new reproduction scripts, retry previously blocked work, or add network-fault/attack-style experiments. Did not run the disconnected-handler lifecycle file in this pass. Its production ownership changes were statically reviewed.
- No new dynamic reproduction for F1. The report separates a demonstrable code-flow gap from unverified timing/storage consequences.
- The maker's 212 unit / 10 HTTP+DOM results are recorded in CURRENT_VALIDATION, not independently claimed here. This pass independently executed 78 existing tests across the selections above.
- DOM tests were reviewed for coverage but not rerun in this pass; they rewrite tracked evidence files. Actual browser visual/audio behavior was not validated. No remote CI, paid model requests, Windows/macOS, Android/native, real-device, licensed-community-content or model-quality testing was performed.
- No Codex CLI, separate cloud task, push, network reproduction scripts, or repository source modification was used.
