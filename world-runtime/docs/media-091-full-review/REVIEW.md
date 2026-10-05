# Independent full media-slice review

Candidate: `091ee8fc052fc53b0c08e5efb3c2b9552d34a312`
Base: `172a8df057cf2f716a867fa4f70fed3b2f400fd7`
Branch: `feat/local-media-imports`
Review date: 2026-10-05 UTC
Disposition: **Request changes: one P2 correctness finding**. No P0/P1 found in this review. The earlier large-backup, publication-status, normalized-node, receive-error and history-cleanup repairs pass the checks below. This is a full review of the media slice, not a patch-only approval and not full-product certification.

## Finding F1 — P2: worker failure is replaced by a subsequent cleanup error

Location: `world-runtime/src/import-jobs.mjs:260-269` (specifically direct `await rm` on line 263 and unconditional replacement of `j.error` on line 269).

The worker failure path stores the parser's primary error, then deletes the upload using raw `rm`. If deleting the file fails, the outer catch overwrites the parser failure with the cleanup failure. The next `cleanup` can add a warning, but the primary reason for rejecting the card is already lost, and successful later cancellation does not restore it. A journal save failure at line 265 can similarly overwrite an existing parser error. The repaired `receive` path correctly separates these responsibilities; the worker-completion path does not.

Reproduction is a new independent real HTTP test against an isolated temporary server/data directory, using a harmless incomplete JSON card and an injected local filesystem cleanup error. Run `node worker-error-cleanup.mjs` from this directory (or its absolute path). Expected primary `INVALID_JSON`; actual HTTP GET result:

```
status: failed
error: {code: EBUSY, message: Independent cleanup EBUSY}
cleanupWarning: {code: EBUSY, ...}
```

After faults are removed, POST cancel clears cleanupWarning and deletes the temporary file, but `error.code` is still EBUSY. The assertion fails exactly because INVALID_JSON was replaced. Evidence: `worker-error-cleanup.mjs`, `worker-error-cleanup.log`.

Impact: misdiagnosed rejected imports, loss of their original failure cause across cleanup retries/journal persistence, and an incomplete error-ownership contract. This does not register malformed data or corrupt existing cards. It warrants a narrow repair, not another admission-limit increase or new job framework.

Suggested repair direction: preserve an already-recorded worker error; make cleanup best-effort through the same cleanup helper, with independent warning; do not let a following cleanup/save error replace the primary parser/timeout/worker failure. Add a worker-failure plus cleanup/persistence-fault test alongside the existing receive-fault combinations.

## Scope and independent examination

Reviewed the complete functional diff since the base, including import jobs/worker, importer and format parsing, normalized admission and consumers, backup/restore, HTTP routes, app media/import lifecycle, CSS and updated requirements. Read the supplied development plan §13.1–13.5 and CAP-08 against `MEDIA_IMPORT_SLICE.md` and `NORMALIZED_CONTENT_CONTRACT.md`.

The design remains appropriately small: one serialized import slot; binary spooled upload; a worker for parsing; explicit ready/accept boundary; existing atomic card-directory publication; content-addressed preserved/display resources; shared finite constants and common normalized validation. No unnecessary new service, generalized workflow engine or unlimited acceptance policy was added. Reusing `initialState` at normalized admission is reasonable here: it validates the same native initialization that world creation will consume.

Checked policy distinctions: original/source/archive limits remain separate from normalized limits; source JSON remains 8 MiB/depth64/100k nodes; normalized card is 5 MiB/depth32/250k nodes plus bounded strings/arrays/name; generic operations still default to 100k. `prepareCard` and registration call the normalized/world validator, stored card reads use `parseCardMetadata`, and backup/restore route metadata through the same parser and exact-original reconstruction. Unknown data/resources remain preserved or the whole over-budget card is rejected; no trimming was introduced to force admission.

The binary UI uses real XHR byte progress and an indeterminate parsing state; acceptance is explicit; dismissed/cancelled previews do not register. Preview and registered gallery share media rendering and audio release. Local image/audio bytes, decoder-error messaging and pause/remove-src/load lifecycle have executable coverage. Legacy base64 route remains supported with its existing smaller bound, while sharing normalized validation.

## Executed evidence

- `unit.log`: current runtime suite **186/186 passing**, including import/archive/resource contracts, jobs and restart/SIGKILL behavior, 5000-entry ordinary metadata closure, exact normalized boundary checks, invalid native initialization, publication errors, upload write/sync/close primary-error ownership, and retained cleanup/history responsibility.
- `http-dom.log`: current HTTP plus copied external-output live-app DOM harness **10/10 passing**. Harness imports actual current source and serves actual app.js. DOM artifacts are outside the repository. This is jsdom, not Chromium.
- `large-backup-restore.log`: reran the previous independent ordinary image/audio/unknown-resource closure probe against this candidate. Small and **44,042,912-byte** CharX both reach preview/accept/world/backup/new-directory restore/reopen. Original and preserved resource bytes are compared exactly.
- `60m-backup-restore.mjs` and `.log`: same independent closure scenario with two 30 MiB ordinary opaque resources, exercising the previously broken 60 MiB class.
- `http-contract-publication.mjs` and `.log`: new actual HTTP tests show Unicode 512-character name accepted by both legacy and binary routes; 513 rejected (legacy HTTP400, binary failed before acceptance). Unknown extension values remain unchanged. A real accept request with injected post-rename directory-sync EIO returns completed plus IMPORT_DURABILITY/storageCode EIO; world creation and backup succeed; server reopen retains completed/warning without stale error.
- `worker-error-cleanup.mjs` and `.log`: new failing actual HTTP probe establishing F1.
- `source-sha256.txt`: reviewed source hashes.

The existing ordinary-metadata test was rerun, not merely trusted: source 40,005 nodes becomes 105,029 normalized nodes and passes ready → completed → world HTTP201 → backup HTTP200 → exact-original restore → reopened world list. Nested metadata and Unicode/10,000-element ordinary-array examples also pass.

## Boundaries and limitations

No source, staged ADR, tracked docs or repository artifacts were edited by this reviewer; no push, CLI task or independent cloud task was created. Tests use temporary storage and benign synthetic content. The candidate remains distinct from the already-published Linux main `58562fac` release.

Finite backup admission is explicitly a current-footprint guarantee, not indefinite capacity after future world/database growth. Conservative database/WAL accounting may reject earlier than strictly necessary but does not silently drop data.

Real Chromium visual/audio decoding, Android/native/content-URI/device-memory testing, Windows/macOS devices, licensed representative ST/Risu community cards, HTML/CSS interactive equivalence and real model quality/cost remain open. Passing HTTP/DOM tests does not close those gates or establish power-loss durability after an injected fsync failure.
