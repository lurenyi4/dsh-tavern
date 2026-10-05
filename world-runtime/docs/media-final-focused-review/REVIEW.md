# Worker primary-error ownership: independent focused review

Date: 2026-10-05 UTC
Candidate: `9bc7960ef9bf5c1165df11c908e7f58659911581`
Parent: `091ee8fc052fc53b0c08e5efb3c2b9552d34a312`
Branch: `feat/local-media-imports`

## Disposition

**PASS for this narrow Linux media correction. No new blocking or non-blocking correctness finding identified in the reviewed change.** The old full-review P2 (INVALID_JSON replaced by cleanup/storage error) is closed by independent RED → GREEN reproduction. Spec and quality/KISS axes both pass at this scope. This is not a fresh full-product audit or publication approval.

## Independent evidence

1. Original full-review actual HTTP reproduction copied without changing its assertions: `red-original-http.mjs` / `.log` on parent reports EBUSY instead of expected INVALID_JSON and exits 1; `green-original-http.mjs` / `.log` on candidate retains INVALID_JSON with independent EBUSY cleanupWarning and exits 0. Cancel after releasing the fault removes cleanupWarning and retains primary. Parent source and its required plugin library were exported with git archive to the external `parent` directory; candidate runtime assets were reused. An initial incomplete export could not resolve a library; that setup issue was fixed before the recorded RED, which is specifically the primary-error assertion failure.
2. Newly authored `independent-http-fault-matrix.mjs` / `.log`: seven actual HTTP scenarios inject filesystem failures rather than mocking the job save method: one-shot and persistent upload rm EBUSY, one-shot and persistent journal writeFile ENOSPC, one-shot and persistent journal rename EIO, and combined persistent rm+write failure. All pass. Every case retains INVALID_JSON, failed status, no preview, rejects accept, and creates no cards. Persistent rm retains exact original upload bytes until cleanup succeeds. Persistent save failures make cancel return HTTP400, but GET still exposes accurate primary plus persistenceWarning. Once storage recovers, cancel or close-only retry persists the failed record; server reopen retains INVALID_JSON, clears cleanupWarning and confirms upload deletion. Historical persistenceWarning remains, as specified.
3. Existing relevant tests independently executed: **21/21 pass**, `focused-tests.log`. Files: worker-error-cleanup, worker-error-persistence, import-jobs, upload-error-combinations, upload-storage-fault, storage-fault-lifecycle, media-publication. This includes receive write/sync/close failures, ready-result persistence failure, cleanup-history retention, cancelled/incomplete upload, preview SIGKILL recovery, publication and shared-resource boundaries.
4. Previous independent HTTP publication probe rerun against candidate: `publication.mjs` / `.log`, exit 0. Both routes retain 512/513-character boundary behavior. Actual accept with cards-directory fsync EIO remains completed with IMPORT_DURABILITY warning; world creation and backup succeed; server reopen remains completed without stale error.

Maker's 191 unit and 10 HTTP/DOM results are background only; this reviewer does not represent them as independently rerun full suites.

## Implementation and contract assessment

All line references below are candidate `world-runtime/src/import-jobs.mjs`.

- Lines 92–114: shared failJob records failed/primary before any fallible cleanup, preserves an existing primary via `??=`, drops prepared preview, and separates close, cleanup and persistence diagnostics. Cancelled/interrupted state remains protected. The helper is small and directly unifies the existing two error paths; no generalized job framework or unrelated state redesign.
- Lines 286–293: worker rejection now calls failJob directly instead of raw rm followed by save. Ready-result save errors use the same path. Lines 310–312: receive still throws the original transport/storage error after best-effort failure bookkeeping.
- Lines 132 and 155: historical persistenceWarning is represented both in journal and API. Lines 380–384 retry terminal persistence on close even when the upload cleanup was already successful. The seven-case matrix specifically checks this useful close-only recovery.
- Lines 78–89, 205–213, 353–359: cleanup warning and retry responsibility remain intact; failed cleanup is retained rather than causing old upload responsibility to be discarded. Existing lifecycle regression independently passes.
- Lines 315–349 and startup lines 40–57: accept's publication-aware path and startup completed/error correction are unchanged. The new helper is used for receive/preparation errors, not substituted into the post-publication import path. Actual HTTP durability-warning regression passes.
- NORMALIZED_CONTENT_CONTRACT explicitly describes persistenceWarning as a previous failed write. Its presence after successful retry is therefore historical, not evidence the current save is still failing. Exact crash survival of a never-persisted error is correctly not promised. Tests restore persistence before asserting reopen primary preservation.

## Change ownership and limits

Production diff from parent changes only import-jobs.mjs; two regression test files and review/validation documentation accompany it (`non-doc-diff.txt`). Reviewer wrote only this external review directory and temporary test data; no product source, staged files, ADR, tracked documents or repository artifacts were changed. Git status was clean before and after (`status-after.txt` is empty); reviewed source checksum is recorded in `source-sha256.txt`. No push, Codex CLI invocation or separate cloud task was performed.

This candidate remains a distinct, unpublished Linux media slice, separate from already-published main `58562fac`. No APK, Android/device, real-browser visual/audio decoding or full-product acceptance claim is made. Native real-device and representative licensed-card gates remain open. This review does not infer physical power-loss durability from an injected fsync failure.
