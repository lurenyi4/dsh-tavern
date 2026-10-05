# Independent focused import/service shutdown review

Candidate: `17321915ae85740f74fbeb4da4890a0b8590bdd4`, parent `12655703471d0d509396a10960820f0359e094b4`, branch `feat/local-media-imports`.

## Decision

**PASS for this lifecycle repair scope. New major: 0. New minor: 0.** The previous full-review two majors and history-cancellation minor were independently reproduced on the parent and verified resolved on the candidate. This is not overall product acceptance or remote CI completion.

## Independent evidence

Read `world-runtime/docs/IMPORT_SERVICE_LIFECYCLE.md`, `CURRENT_VALIDATION.json`, source changes and the prior external `ci-close-full/REVIEW.md`, `probes.mjs`, and `server-rejection.mjs`. Wrote fresh probes outside the repository. The same `probes.mjs` ran against candidate and parent source snapshots. Parent snapshot copies unchanged current source dependencies and replaces only the two changed product modules with `git show 1265570` versions; runtime and dependency installations are shared, not reinstalled.

| Scenario | Parent RED (`red.log`) | Candidate GREEN (`green.log`) |
|---|---|---|
| Pre-publication registration, close, one-shot cancelled-journal EIO | accept/close reject; disk remains registering | both fulfill; memory and disk cancelled; same close promise |
| History create held in real cleanup during close | close resolves early, one post-close save | close waits; zero post-close saves |
| New cancel during history cleanup reservation | IMPORT_NOT_FOUND after eviction, journal recreated | IMPORT_RETIRED before writer admission; entry/journal absent |
| Actual HTTP card publication then one-shot completed-journal rename EIO | close rejects EIO, HTTP400, listener and lock remain; second close false success | HTTP200 completed with EIO warning, close succeeds, no listener/lock, same close promise, no unresolved warnings |
| Actual HTTP publication with persistent completed-journal EIO | same stranded server | two failed save attempts, completed remains truthful, one structured unresolved warning, listener/lock gone, repeated close same promise/result |

For both HTTP candidate fault cases, removing the injected fault and starting a fresh server on the same data directory succeeded; HTTP card list contained exactly one published card and recovered job status was completed. Baseline reopen evidence follows explicit reviewer cleanup of its leaked listener/store/lock; it does not imply the old close released those resources.

Faults affect actual `fs.rename` of job journals after successful card-directory rename, via `syncBuiltinESMExports`; history gates delay existing real cleanup/save operations. They are not simulated HTTP responses. Probe fault and result details are preserved in the logs.

## Additional independent assertions

`extra.test.mjs` / `extra.log`: **4/4 pass**:

- Two disposal failures (projection EIO plus store EBUSY, each thrown after its real close) are both retained in SHUTDOWN_FAILED; repeated close returns the same promise and same rejection object. Listener is false, a fresh HTTP fetch fails, lock is absent, fresh startup returns HTTP200.
- Normal successful publication, repeat accept, concurrent repeat cancel, 50 subsequent history jobs, eviction and repeat close retain the published card directory and reopen with the bounded 49 job records.
- Close during preparing-journal persistence joins the accepted receive operation; no late worker is spawned, active set drains to zero, final status interrupted.
- Real history journal unlink EIO releases the eviction reservation; create failure is finalized, cancel remains usable, and another create succeeds instead of leaving an invisible permanent busy slot.

Candidate runs on Node v24.19.0:

- `npm run test:world`: **201/201 pass**, 0 failures (`unit.log`)
- Import service lifecycle, finalization, and jobs test files together: **20/20 pass** (`related.log`)
- Fresh external probes: all recorded expected candidate outcomes (`green.log`); matching old regressions independently RED (`red.log`)

The 10 HTTP/DOM suite pass is documented background from CURRENT_VALIDATION, not rerun by this focused reviewer. Actual HTTP fault and reopen cases above were independently run.

## Spec and quality / KISS

The repair establishes an ownership boundary rather than adding terminal-state exceptions: admission closes first; accepted public operations and spawned producers remain tracked; close drains the active set before final persistence. Per-job eviction reservation is acquired before yielding and released in finally, so a new cancel cannot revive a deleted record. Cancellation excludes its own operation from producer joining. Acceptance separates successful publication from journal durability, and close returns unresolved persistence diagnostics without resuming writes on repeated calls. Server shutdown coalesces completion, starts listener closure first, waits accepted HTTP/background work, and attempts every remaining disposer despite errors.

The active set plus per-job reservation is proportional to the demonstrated races. No new global serialized task engine, alternate canonical state, or format/budget redesign is introduced. Existing source hashes exactly match CURRENT_VALIDATION for the two reviewed product modules. No additional actionable major/minor was found in this focused review.

## Limits and repository hygiene

No source edits, staging, ADR changes, commits, pushes, Codex CLI, or new cloud tasks. Repository status remained clean at completion. All new reviewer files are in external `lifecycle-focus/`.

The accepted importer.finally compound publication/cleanup diagnostic minor is unchanged and was not reopened. No real hardware power-loss proof, real browser visual/audio, Android/native bridge, Windows/macOS device, licensed ecosystem, or real model-quality/cost acceptance is claimed. Remote CI was not run or repaired by this reviewer.
