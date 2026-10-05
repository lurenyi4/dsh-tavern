# Independent full import/service lifecycle review

Candidate: `17321915ae85740f74fbeb4da4890a0b8590bdd4`, branch `feat/local-media-imports`; complete follow-up since published `e327359eac0e21a575e47d9d3f5d0f68d356b8da` (1265570 + 1732191).

## Decision: REQUEST_CHANGES

One major remains. No additional blocker/critical/major found in the ImportJobs boundary. This is a fresh full review, not an extension of the previous focused PASS. The prior full review's three findings are fixed in their tested paths, but the new claim that service close joins all accepted HTTP work is incomplete.

## F1 — major: disconnected HTTP handlers outlive successful service close and released server lock

Locations: `world-runtime/src/server.mjs:467-473` (unowned async request callback), `561-578` (legacy import), `1104-1121` (listener close treated as request completion before disposal).

`server.close()` waits for connections, not the asynchronous handlers previously invoked on those connections. A client can disconnect while its already accepted legacy import is awaiting filesystem work. The listener then closes even though the handler is still running. That import is neither in ImportJobs.active nor the server jobs set. app.close returns `{warnings:[]}`, closes projection/store and removes `.server-lock`; the accepted import subsequently publishes its card and performs directory sync after close has reported completion.

Independent real HTTP reproduction in `http-disconnect.mjs` / `http-disconnect.log`:

1. Start a real server and POST a valid legacy JSON import over Node HTTP.
2. Delay the real card staging-directory rename before it executes. This is a scheduling gate, not an injected storage failure or mocked import result.
3. Destroy the client request after the import reaches that gate.
4. Call app.close while the handler is still waiting.
5. Observe close fulfilled, listener false and `.server-lock` absent.
6. Release the original rename; observe one card publication after close fulfilled.

Observed output:

    {"closeBeforeAdmittedImportSettled":true,"result":{"warnings":[]},"listener":false,"lockExists":false}
    {"cardPublicationAfterClose":1,"cards":["780fad55d976c30276b7ed2b3822f2415febb2bdad8d9ec7317a1e586212947d"]}

Impact: a new process/owner can obtain the directory while the old service still mutates it, or the caller can remove the directory while an accepted producer is running. The tested effect is a post-close publication and early lock release; this review does not claim reproduced card corruption. Other async handlers may share the same lifetime gap. This is a missing service-lifecycle guarantee in the current repair, not a claim that this defect was newly introduced by the diff.

Required repair: own admitted HTTP-handler promises independently of socket lifetime and drain them before disposing store/projection/releasing the lock. Preserve manager admission closure and background-work draining; ensure handlers that can launch background work cannot escape the drain. Add a real HTTP regression with ordinary disconnect during delayed filesystem work and assert that close remains pending and the directory lock stays held until the handler settles, with no filesystem activity after close.

## Full code/spec/quality assessment

Read the complete changed production files and diff from e327359, IMPORT_SERVICE_LIFECYCLE.md, NORMALIZED_CONTENT_CONTRACT.md, MEDIA_IMPORT_SLICE.md, CURRENT_VALIDATION.json, new test files, saved validation, both original1265570 review decisions/probes, and relevant reference-plan §13 and §21.4 requirements. Checked adjacent importer atomic publication, resource ownership, recovery, normalized admission and backup consumers.

Positive findings:

- The active-operation set and eviction reservation are proportionate/KISS. No new storage architecture or duplicate canonical state is introduced.
- Public create/upload/accept/cancel admission is closed synchronously. Accepted create/history work and spawned worker finalization are drained. Receive rechecks abortion after preparing persistence.
- History reserves the old record before yielding and waits admitted operations. Cancel excludes its own public promise from finalization waits. Failed create becomes terminal; eviction failure releases its reservation.
- Acceptance's final journal error no longer falsifies a successful card publication. Persistence diagnostics remain separate from card directory-fsync uncertainty; permanent journal failures yield shutdown warnings. Repeated close returns its original settled result without post-lock retry writes.
- Server disposal errors are aggregated after all listed disposers are attempted; repeated close reports the same rejection. Persistent import journal failure no longer strands the listener.
- Normalized/raw/media admission and backup limits are unchanged, and the independently rerun unit suite includes the actual HTTP large-media/ordinary-metadata world→backup→restore/reopen closures and exact originals. No dropping of unknown resources or metadata to satisfy budgets was found.
- Source/base CI and unverified platform/browser gates are stated honestly in docs. The published e327359 CI failure is retained as failure, not retroactively relabeled green.

Remaining limitation accepted previously: importer.finally compound rename EIO plus cleanup EBUSY may replace the primary diagnostic and retain staging/unreferenced assets until restart. It is unchanged and is not the cause of F1. No unrelated scope expansion is requested.

## Independent execution and evidence

Node v24.19.0. Candidate source archived from the exact HEAD into this report's `candidate/`; existing runtime, plugin and dependency trees were linked. No source, staged file, ADR, repository doc, commit, push, Codex CLI or independent cloud task was changed. Repository status remained clean. Tests run in the external copy so generated DOM evidence does not alter the review target.

- `npm run test:world`: 201 passed, 0 failed (`unit.log`)
- `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs`: 10 passed, 0 failed (`http-dom.log`)
- Reviewer-authored `node --test extra.test.mjs`: 3 passed, 0 failed (`extra.log`):
  1. Initial create journal EIO releases the busy slot, another actual upload/accept works, exact original bytes survive and completed status survives reopening.
  2. Thirty in-flight stream + duplicate cancellation + close cycles settle without self-await, empty the active set, and permit immediate directory removal without later recreation.
  3. Real history journal deletion failure releases the eviction reservation, cancellation can retry, and a subsequent create successfully evicts the old record.
- Reviewer-authored real HTTP disconnect probe reproduces F1 (`http-disconnect.mjs`, `http-disconnect.log`).

Harness preparation note: the initial external-copy test attempts lacked a linked tavern-plugin tree and later the two top-level wrapper scripts. After supplying those exact existing dependencies/tracked scripts, the complete rerun above passed. Those setup failures were not product findings.

This is Linux local-service review only. No Android/native/device, real Chromium rendering/audio, Windows/macOS device, licensed-community ecosystem or real model-quality/cost acceptance is asserted. Remote exact-SHA CI was not run by this reviewer. A green 201/10 baseline does not override F1.
