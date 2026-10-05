# Independent focused review: import finalization CI repair

## Decision

PASS for the Linux finalization-race repair at commit `12655703471d0d509396a10960820f0359e094b4`, compared with `e327359eac0e21a575e47d9d3f5d0f68d356b8da`.

No blocker, critical, or major issue found in this scoped review. No source, staged file, ADR, or repository documentation was changed. No push, Codex CLI, or new cloud task was performed. Repository status was clean at the end of testing.

## Evidence reviewed

- The exact product diff: only `world-runtime/src/import-jobs.mjs` changed production behavior.
- `CURRENT_VALIDATION.json`, `MEDIA_IMPORT_SLICE.md`, `NORMALIZED_CONTENT_CONTRACT.md`, and `WORK_LOG.md`.
- Saved exact-SHA CI log `published-media-ci-failure.txt`: 190 passed / 1 failed, malformed-upload teardown failed with `.import-jobs` ENOTEMPTY. This is a real failed CI run, not evidence of successful remote validation.
- Four delayed-finalization regression tests, plus nearby worker, upload, publication, and lifecycle tests.

## Independent execution

Test copies are outside the repository. The parent copy differs from the reviewed head copy only by restoring the parent `import-jobs.mjs`; both run the new regression file. External module dependencies are linked read-only in practice to the existing dependency tree.

| Check | Result | Log |
| --- | --- | --- |
| Four new delayed-save tests against parent | 0 passed / 4 failed, expected premature return assertions | `red.txt` |
| Same four against reviewed commit | 4 passed / 0 failed | `green.txt` |
| Existing import jobs, worker persistence, upload error combinations, media publication suites | 18 passed / 0 failed | `related.txt` |
| Reviewer-authored extra checks | 8 passed / 0 failed | `extra.txt` |

Reviewer-owned `extra.test.mjs` checks:

1. Delayed successful publication journal: close waits, repeated close returns identical promise, cancellation after close starts rejects, published card and completed journal survive reopen.
2. Same publication delay with overlapping terminal cancellation requests: cancellation waits and card identity survives.
3. Same publication delay with history reclamation: reclamation waits, the old journal is removed, and the published card remains available after reopen.
4. Upload/receive failure with delayed failure journal: close waits and retains IMPORT_INCOMPLETE.
5. Same upload failure with overlapping cancellation requests: both complete only after finalization.
6. In-flight upload cancellation, duplicate cancellation, and close together settle without self-await deadlock or publication.
7. A delayed worker failure journal throws transient EIO: close retries persistence and preserves INVALID_JSON with the secondary EIO warning.
8. Sixty independent malformed-worker shutdown/removal cycles: no late writer or ENOTEMPTY failure.

## Code/spec/quality assessment

The central distinction is correct: terminal status is observable before asynchronous finalization finishes. Waiting on upload completion before taking the worker/save snapshot covers receive-owned failure and worker setup; joining worker work then covers delayed final journal production. Close and history also join an already-running cancellation. Cancellation itself excludes its own work from the helper, preventing a cycle. The closed guard prevents new cancellation from appearing after shutdown's wait snapshot. Repeated close shares the same completion promise.

The patch retains publication ownership: terminal cancellation does not convert completed jobs to cancelled, and published content is not removed during journal reclamation. Primary upload/worker errors stay intact when finalization storage fails. The implementation adds one small helper plus cancellation/close promise ownership rather than changing storage architecture, limits, or normalized content behavior. This is proportionate and KISS for the reproduced race.

## Limits

This is independent focused Linux review, not a new full-product approval. The maker's 195 unit / 10 HTTP+DOM totals were read but are not counted as this reviewer's own executions. The new commit's remote CI still needs exact-SHA verification after authorized publication. Android/native bridge, real browser decoding/visuals, macOS/Windows, licensed ecosystem sampling, and model-quality/cost gates remain unverified here. The previously accepted registration EIO plus staging EBUSY diagnostic/cleanup limitation is outside this repair and remains open.
