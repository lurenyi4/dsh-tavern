# Independent full completion/lifecycle review

Candidate: `12655703471d0d509396a10960820f0359e094b4`, branch `feat/local-media-imports`.
Decision: **REQUEST_CHANGES** (2 major, 1 minor). No source, staged ADR, commit, push, Codex CLI or cloud task modification performed.

## Scope and method

Reviewed the entire ImportJobs state machine, serialized save implementation, recovery, receive/worker producers, acceptance/publication, cancellation, history pruning, close, server shutdown caller and importer publication/cleanup boundary. Compared MEDIA_IMPORT_SLICE.md, NORMALIZED_CONTENT_CONTRACT.md and reference-plan DEVELOPMENT_PLAN §13, §21.4, T-09/CAP-08 related requirements. This is a fresh review of this completion change and adjacent lifecycle, not reopening the already accepted importer.finally compound-failure minor.

KISS: the small completion helper and cached cancellation/close operations are sensible and reuse existing promises. However, snapshot joining is not an ownership boundary, and active registering still bypasses the new rejection-handling helper. Additional lifecycle ownership is warranted rather than more terminal-status checks.

## F1 — major: registering close bypasses rejection handling and leaves a live server after transient final journal failure

Locations: world-runtime/src/import-jobs.mjs:350-361, 402-404, 418-420; caller world-runtime/src/server.mjs:1076-1086.

When close sees registering, it aborts and directly awaits j.work. A rejection from acceptance's final save escapes, unlike the terminal branch's awaitFinalization. Therefore neither retry persistence nor later shutdown disposal runs. closeWork caches that rejection. Server close has already set stopped=true, so another server.close returns successfully without closing its listener, projection/store or server lock.

Reproduced in a real HTTP server with actual successful card-directory rename and exactly one subsequent completed-job journal rename EIO. No combined cleanup fault is required:

- close rejected EIO
- accept returned HTTP 400
- registeredCards=1 (publication survived; not mislabeled cancelled in memory)
- serverStillListening=true
- .server-lock still present
- second app.close returned while serverStillListening remained true

Evidence: server-rejection.mjs and server-rejection.log. A second isolated probe reproduces the pre-publication abort variant, leaving memory cancelled but the journal registering, and repeated ImportJobs.close returns the same rejected promise (probes.mjs / probes.log).

Required fix: make active registration finalization use the same failure ownership/retry policy as terminal completion, ensure publication stays completed, and ensure a journal failure cannot silently strand server disposal. Preserve primary error/secondary persistence diagnostics. Add both published and cancelled active-close regressions with one-shot final journal failure.

## F2 — major: in-flight history create is not part of close completion

Locations: world-runtime/src/import-jobs.mjs:213-235, 406-431.

create inserts the new record before awaiting old-job finalization/cleanup. close observes that new record as created, interrupts and saves it, and may resolve while the earlier create is still waiting on old-record cleanup. When that create resumes it performs another journal write at line235 after close has resolved. The added completion barrier does not account for this producer.

Deterministic reproduction uses 49 existing terminal jobs, gates the oldest cleanup inside create, then calls close. close resolves before create; releasing create produces one post-close journal write and returns status interrupted. There is no storage fault and no source mocking beyond delaying the real cleanup call.

Evidence: probes.mjs / probes.log: CLOSE_RESOLVED_WITH_CREATE_PENDING=true; JOURNAL_WRITES_AFTER_CLOSE=1.

Impact: an ImportJobs consumer can dispose its data directory after an apparently completed close while history creation still accesses it, the same resource-lifetime class as the CI shutdown race. This specific probe is the ImportJobs contract; the HTTP server's later server.close can additionally wait for request completion, so this finding does not claim that the full server necessarily resolves before that request.

Required fix: track/join creation/history producer completion, or introduce an equivalent explicit ownership barrier. Simply checking closed only at create entry is insufficient. Add create/prune versus close regression with a cleanup gate and assert zero filesystem work after close settles.

## F3 — minor: a new terminal cancel can outlive history eviction and recreate its journal

Locations: world-runtime/src/import-jobs.mjs:220-226, 366-385.

History joins cancellation already present at its snapshot, but admits a new cancel while pruning cleanup is running. That cancel can reach a gated save; history deletes the old journal and Map entry; cancel then recreates the old journal and fails get(id) with IMPORT_NOT_FOUND. The supposedly evicted journal returns on restart. No registered card damage was observed; severity is minor for history retention/API consistency.

Evidence: probes.mjs / probes.log: HISTORY_CANCEL_RACE rejected IMPORT_NOT_FOUND, inMap=false, journalRecreated=true. Reproduction uses real cleanup/save operations delayed at deterministic points.

Suggested fix: mark/reserve a job for eviction before yielding, reject or join subsequent cancellation consistently, and guarantee no writer remains before removal. This can share the lifecycle ownership mechanism used for F2 rather than adding ad hoc polling.

## Positive branch findings

- Terminal close/cancel/history now join the original failed worker journal, addressing the published CI race.
- uploadWork is awaited before capturing work/save; receive failure remains the primary diagnostic.
- cancel's internal terminal helper excludes cancelWork, avoiding direct self-await; close/history can join existing cancellation safely.
- Repeated successful close calls share one completion promise; cancellation after closed is rejected.
- Preparing/ready cancellation aborts, destroys the stream, terminates worker, joins work and removes preview/upload.
- Actual publication remains completed after late cancellation; recovery reconciles card registration and warns about uncertain durability. F1 concerns final persistence/shutdown ownership, not lost card bytes.
- Existing resource/normalized-content budget and exact-original tests still pass; no new format/budget divergence found.

## Independent execution

Node v24.19.0 (matches workflow). Existing installed dependencies/runtime used; no package reinstall claimed.

- Exact workflow test command npm run test:world: 195/195 pass, 0 failures (unit.log)
- Exact workflow node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs: 10/10 pass (http-dom.log)
- New four finalization regressions repeated 20 runs: 80/80 pass (stress.log)
- Additional independent deterministic probes: all three findings reproduced (probes.mjs / probes.log)
- Actual HTTP published-card shutdown failure reproduced (server-rejection.mjs / server-rejection.log)

The built-in HTTP/DOM tests update these generated tracked evidence files: docs/e2e-evidence/dom-report.json, release-ui-regressions-r02.json, release-ui-regressions-r04.json. Parent notified; reviewer did not overwrite shared changes or stage them.

No Android/native, Windows/macOS device, real Chromium visual/audio, licensed community ecosystem or real model-quality/cost acceptance is asserted. The previous accepted importer.finally compound cleanup diagnostic limitation remains unchanged and was not escalated.
