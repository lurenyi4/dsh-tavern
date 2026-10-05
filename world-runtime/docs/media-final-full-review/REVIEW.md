# Final independent full media-slice review B

Date: 2026-10-05 UTC
Candidate: `9bc7960ef9bf5c1165df11c908e7f58659911581`
Base: `172a8df057cf2f716a867fa4f70fed3b2f400fd7`
Branch: `feat/local-media-imports`

## Disposition

**PASS for this Linux media-import slice, with one non-blocking minor.**

Severity mapping used here is the requested **block / critic / major / minor**. No block, critic or major finding was established. F1 below is **minor**, optional follow-up under the stated acceptance rule, not a demand for another repair cycle. Spec axis passes within the explicitly scoped Linux slice; quality/KISS passes with F1 recorded. This is not a complete-product or device-release certification.

## F1 — minor: failed registration cleanup can replace its primary error and postpone orphan cleanup until startup

Locations: `world-runtime/src/importer.mjs:199,202`; propagation in `world-runtime/src/import-jobs.mjs:341–347`; terminal cancel at `353–359` only retries `.upload` cleanup via `cleanup` (`82–95`).

The importer uses one sequential `finally` cleanup: remove staging, then remove newly created asset links. If staging removal fails, that exception replaces an earlier registration failure and skips asset-link removal. The job's shared upload cleanup does not own these paths, so its `cleanupWarning` is absent. Cancel after the filesystem recovers cannot remove the staging directory or those links. Startup's existing `recoverImportStorage` does remove them.

New independent actual-HTTP probe `combined-faults.mjs` injects benign local filesystem failures against an ordinary 2460-byte synthetic CharX: registration rename fails EIO, then removal of the staging directory itself fails EBUSY. HTTP accept returns `status: failed`, `stage: registering`, `error.code: EBUSY`, no `cleanupWarning`. One staging directory and two unreferenced assets remain. After restoring filesystem methods, HTTP cancel still leaves them. Evidence: `combined-faults.log`.

**Impact and why minor:** primary diagnostic is lost, cleanup visibility/retry is incomplete, and disk space is retained until restart. No card was published, no registered card was modified, and startup clears these leftovers. The probe explicitly checks that, before restarting, another legacy import, world creation, and complete backup all succeed after the faults are removed. This is a double storage-fault scenario with a working recovery boundary, not evidence of normal-flow unbounded growth, persistent cross-restart leak, core unavailability, or accepted-card data corruption. Repeated storage failures could retain more temporary data until restart, but no claim of normal-flow major impact is supported.

Optional repair direction: preserve the first registration error; attempt staging and each newly-created asset cleanup independently; retain enough cleanup information or clearly report restart-needed cleanup. Reuse small helpers and the existing recovery boundary rather than add a general workflow engine. Do not delete shared existing assets.

## Full scope inspected

Read the complete production diff since the base, not just latest failJob: importer/format validation, shared normalized limits/domain initialization, backup/restore closure, worker/jobs lifecycle, server routes, actual app media/import UI and CSS. Read `MEDIA_IMPORT_SLICE.md`, `NORMALIZED_CONTENT_CONTRACT.md`, `CURRENT_VALIDATION.json`, both `media-091-*` reports, reference plan §13.1–13.5/CAP-08, and T-09.

- Binary XHR upload has real byte progress and a separate indeterminate worker parsing phase. Explicit ready/accept is maintained; dismissal/cancel does not register. Original bytes are spooled and bounded. Worker timeout and single active slot keep the design small.
- Preview and registered galleries share local image/audio rendering and release behavior. Unsupported/unknown resources remain exact original/preserved data rather than being executed or silently discarded. No remote fetch functionality was introduced.
- Source and normalized budgets are distinct: source 8 MiB/depth64/100k nodes; normalized 5 MiB/depth32/250k nodes and finite strings/arrays/name. `initialState` is reused at admission and by consumers; stored card and backup/restore parse paths share `parseCardMetadata`. Generic operation limits remain unchanged. No fixture-specific 5000-entry exception was introduced.
- 64 MiB original/file and 128 MiB/2000-file closure admission use shared constants. Registration repeats the budget check under the importer lock. Finite admission is current-footprint accounting, not unlimited future database growth. Exact original/resource closure is validated by backup/restore.
- Atomic card-directory rename defines publication. A following fsync failure is completed plus a durability warning; cancellation cannot pretend published content was cancelled. Reopen reconciliation retains uncertainty and clears stale error on recovered completed records.
- Receive/worker/ready-save failure finalization now shares the small failJob helper. Existing primary errors are retained with separate close, cleanup and persistence diagnostics. The new combined worker test below verifies simultaneous secondary faults, not only individual faults.
- KISS: one queue slot, a worker, bounded file spooling, shared constants/validator and the existing atomic boundary; no unnecessary new storage service or generalized job engine. The remaining importer cleanup asymmetry is a local issue, not a reason to expand architecture.

## Executed evidence

All paths below are in this repository-external review directory. Product source and tracked artifacts were not edited.

1. `unit.log`: `node --test world-runtime/test/*.test.mjs` — **191/191 pass**, no skips/failures. Includes 42 MiB backup closure; normalized exact boundaries and ordinary 5000-entry / nested / Unicode-array HTTP world→backup→restore→reopen; over-budget media duplication rejection; restart/SIGKILL; publication/cancel; cleanup history responsibility; original/resource preservation.
2. `http-dom.log`, `dom.mjs`, `dom-evidence/`: copied external-output harness against actual current app.js plus `e2e-api.mjs` — **10/10 pass**. Exercises actual HTTP and SQLite/DSH, image/audio resource bytes, accept/cancel, media error feedback and release calls. This is jsdom, not a real browser or audible decoder validation.
3. `60m.mjs`, `60m.log`: rerun prior independent closure probe against this exact candidate. Small and **62,917,280-byte** ordinary synthetic CharX both ready→completed→world201→backup200→new-directory restore→server reopen. Exact originals and preserved resource bytes compare equal. The large archive contains two 30 MiB opaque resources and synthetic audio; no licensed community content claim.
4. `publication.mjs`, `publication.log`: independently rerun actual HTTP Unicode name boundary (512 accepted by legacy/binary, 513 rejected), unknown extension preservation, and post-rename fsync EIO → completed + IMPORT_DURABILITY, usable world/backup, reopened completed without stale error.
5. **New** `combined-faults.mjs`, `combined-faults.log`: actual HTTP malformed JSON worker failure with **simultaneous** persistent upload rm EBUSY and failed-state journal write EIO. GET retains INVALID_JSON, cleanupWarning EBUSY, persistenceWarning EIO. Restore writes/cleanup, cancel, close/reopen retains INVALID_JSON. The second part establishes F1 and verifies recovery/continued usability as above. The script asserts supported expected behavior and logs the residual minor; its exit 0 is not a claim that F1 does not exist.
6. `source-sha256.txt`: source fingerprints. Candidate/status checked before and after review; git working tree and index were clean.

The existing 105,029-normalized-node regression was genuinely rerun within the full suite, not accepted based on CURRENT_VALIDATION. The new failure probe is separate from those existing regression tests.

## Remaining gates / limits

No Android native/content-URI/device-memory test, Windows/macOS device test, real Chromium visual or audible-decoding test, representative licensed community-card compatibility, HTML/CSS interaction equivalence, or real model quality/cost gate was completed. Existing browser startup blockage was not re-diagnosed in this review; this review supplies no new real-browser evidence. Neither jsdom nor synthetic media closes those gates.

No claim of power-loss durability after an injected fsync failure. Budget accounting remains finite and can be exhausted by later world/database growth. Old published main `58562fac` CI is not evidence for this candidate's publication or remote CI.

No source/staged/ADR edits, push, Codex CLI, or independent cloud task. Local filesystem fault injection is confined to isolated temporary server data and restored in finally blocks. Broader full-product status remains open.
