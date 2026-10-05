# Independent ordinary quality and functional review

- Candidate: `b7a25cdb5e5343eefa60fd5a706c9c146b2d34c7`
- Branch: `feat/local-media-imports`
- Reviewed 2026-10-05 UTC. Repository worktree clean before and after review.
- Decision: **PASS for the current Linux ordinary-function / code-quality review scope, with known non-blocking limitations below.** No new block, critical or major issue established. This is not an unrestricted product, platform, fault-domain or publication approval.

## Findings / retained limitations

### F1 — P2 / minor, known adjacent cancellation diagnostic limitation (static only)

`world-runtime/src/server.mjs:408–413,428–444` retains the older already-started launch failure path: a failed terminal save overwrites `run.error`; cancelled notification supplies `{}`; no `persistenceWarning` is set, so settled live cleanup can remove that diagnostic. Consequently the queued-start guarantee and new formatter do not establish equivalent persistence-warning reporting for an already-running cancellation. The code and `RUN_STATUS_UI.md` / `DEFERRED_RUN_OWNERSHIP.md` explicitly delimit that guarantee.

This is not a newly introduced formatter regression. It is assessed as a diagnostic/recovery-visibility limitation, not demonstrated world corruption or failed cancellation, and is non-blocking for this bounded UI/queued-start repair. No new dynamic failure experiment was performed. A separate authorized defensive repair should eventually unify cancellation outcome handling and retain original and save diagnostics separately.

### F2 — P2 / minor, previously accepted import cleanup limitation (static carry-forward)

`world-runtime/src/importer.mjs:199–202`: failure of the staging cleanup in `finally` can replace an earlier registration failure and prevent subsequent newly-created-asset cleanup in that same sequence. The lock-release nested `finally` remains intact; startup owns removal of unreferenced leftovers (`recoverImportStorage`). Existing slice documentation explicitly accepts this limitation. No new injected-failure experiment was performed in this review, and prior reproduction claims are not counted as new evidence.

## Independent execution evidence

1. `node --test world-runtime/test/*.test.mjs`: **220 passed; 0 failed/cancelled/skipped** (`unit.log`). Includes current five SSE/history/re-entry function/DOM contracts, queued ownership, import finalization and service lifecycle contracts, import/backup/media/normalization/store/domain regressions.
2. Existing ordinary `e2e-api.mjs` and `e2e-dom.mjs`: **10 passed; 0 failed/cancelled/skipped** (`http-dom.log`). These exercise ordinary real local HTTP/SSE, SQLite and installed DSH runtime with jsdom: import/preview/accept/cancel, original/media bytes, idempotency, world generation, reload/reconnect/cancel, saved-draft settlement retry, schedules/autonomy, privacy/view switching, entities/knowledge, branches, backup and ACK recovery. These are not Chromium or visual/audio-device tests.
3. Independent supplemental `normal-ui.test.mjs`: **2 passed** (`normal-ui.log`): failed/interrupted/draft/cancelled history retains separate diagnostics and draft; normal terminal histories have no false warning; supplied eligible retry buttons remain; committed records are excluded; pending views clear old history; an old cancelled event does not finish a newer active run.
4. `node --check world-runtime/public/app.js` and every `world-runtime/src/*.mjs`: passed.
5. `git diff --check`: passed. `git status --short`: empty after review; no production source, ADR, repository tests or staged content changed.

For ordinary HTTP/DOM execution, copies of the existing scripts live beside this report. Only module/fixture/runtime resolution and the generated evidence destination were rebased so they execute the candidate source while keeping generated JSON outside the repository. Assertions and behavior were unchanged. No packages were installed. `e2e-evidence/` contains this run's generated DOM observations.

## Static scope

Reviewed current `origin/main..HEAD` world-runtime production changes and relevant surrounding logic: UI binary import progress and preview/accept/dismiss flow, local image/audio gallery lifetime, bounded normalization and metadata reads, shared backup/admission ceilings, importer publication/cleanup, worker preparation and finalization, ImportJobs admission/eviction/cancel/close ownership, server admission and shutdown ownership, queued turn/retry registration, cancellation outcome overlay, reconnect response, snapshot retry presentation, and SSE/history formatter continuity. Older unchanged product subsystems were covered by the ordinary world-runtime regression suite rather than claimed line-by-line re-audit.

The latest source-only patch was checked beyond string formatting: `app.js:693–749` shares the status message between cancelled live events and history, displays unsaved status in the collapsed summary, retains separate error and draft, and does not create a warning for normal saved cancellations. `app.js:1186–1192` preserves active-run ownership before finishing. Existing `loadWorld` terminal handling plus its real extracted-function tests establish that re-entry renders the snapshot and does not require a cancelled SSE reconnect. Server `view` overlays unresolved queued warnings and withholds the UI retry affordance; queued ownership remains registered before dispatch and through cancellation notification.

## Explicit exclusions / release interpretation

- Did not read or execute the blocked `http-drain-full` dynamic reproduction, or retry it by another route. No new network fault, disconnect, intrusion, attack-style or exploitation experiment was added.
- The earlier interrupted bd9a050 full review remains **incomplete, not PASS**. This review does not erase that history or certify its untested special fault domains.
- Already-running cancellation persistence failure was static-only, as recorded above. Existing authorized unit tests were run; no expansion of special failure experiments was undertaken.
- No real browser launch/visual/audio certification, Windows/macOS device run, Android native/device test, licensed community-card corpus, external model call or model-cost/quality evaluation. No remote CI run or remote-state verification.
- This review supports the bounded ordinary review gate for this exact candidate. Publishing, ADR changes, platform completion and whole-product acceptance require their own authority/gates. No push or Codex CLI/cloud task was performed.
