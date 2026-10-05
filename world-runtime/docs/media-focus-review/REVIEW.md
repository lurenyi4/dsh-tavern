# Linux media/import slice: independent focused review

Reviewed 2026-10-05 UTC. Frozen commit `f26cc35b52a43b7217c9085be12f404015b08da6`, branch `feat/local-media-imports`, parent `172a8df057cf2f716a867fa4f70fed3b2f400fd7`. Review-only: no implementation, ADR, commit, remote, CI, or publication changes. The older published candidate `58562fac` and its CI are not evidence for this slice.

## Verdict

**Changes required: 1 Major, 2 Minor.** The implementation substantially closes the former cover-only/base64/immediate-registration UI gaps. It does not yet close the complete media/import acceptance gate, because an ordinary supported large import prevents a complete backup. The findings below are based on this frozen checkout, independently executed tests and source inspection, not on treating the maker's report as verification.

## Findings

### MF-01 — Major: supported large imports break the whole-directory backup path

- Locations: `public/app.js:359` (64 MiB admission), `src/import-formats.mjs:3` (64 MiB raw / 32 MiB entry limits); `src/backup.mjs:10,30-35,98,132` (40 MiB per-file backup/restore ceiling).
- Independent normal-input test builds a standard CharX with two ordinary 30 MiB unknown binary resources and small local image/audio fixtures. The original is approximately 60 MiB, below the raw limit, and each resource is below the entry limit. Binary chunk upload, preview with no registration, explicit acceptance, exact original and both unknown resources all succeed.
- `createBackup` then fails with `BACKUP_LIMIT: 备份文件超出安全大小限制` while reading the registered original. It cannot produce the whole-directory backup, including otherwise healthy worlds/cards. This is not corruption, hostile content, or a boundary-bypass test.
- Evidence: `independent-media.test.mjs` first test; `independent-media.log` and repeated `independent-media-complete.log`. By contrast, the added 21 MiB resource test completes backup and restore with exact original/resource bytes.
- The 40 MiB ceiling predates this commit, but the new browser path expands the supported input range from 20 MiB to 64 MiB and exposes that inconsistency through normal UI usage. It remains an acceptance blocker for the advertised slice.
- Minimum repair: reconcile **both** backup creation and restore validation with the admitted original-file bound, while retaining explicit bounded aggregate memory/size limits. Add an end-to-end supported-large-input backup/restore regression. Also account for original + retained resource + display asset duplication in the aggregate budget; blindly making limits unbounded is not a fix. If bounded backup cannot cover a supported package, disclose and enforce that constraint before acceptance or provide a bounded complete export alternative.

### MF-02 — Minor: ready-record persistence failure leaves source staging until restart

- Location: `src/import-jobs.mjs:203-218`, terminal early exits in `cancel` and `close`.
- Independent fault injection replaces only the instance's `save` method for one call: a normal `EIO` while saving the `ready` record. It does not edit production source or simulate hostile input. The worker completion catch sets `failed` and deletes the in-memory prepared bundle, but does not remove the `.upload` file or persist the terminal failure.
- Calling cancel and close afterward still leaves the original upload because both skip terminal jobs. Evidence: final test in `independent-media.test.mjs`; `independent-media-complete.log` records both `.json` and `.upload` after failure/cancel/close.
- Impact: no card is registered, but the documented failure cleanup promise is incomplete and disk remains occupied for the rest of the process. Startup's existing record-based cleanup should recover this case; this review did not run a second process for this injected failure. Severity is Minor because no committed data loss or partial registration was observed and a restart has an explicit cleanup path.
- Minimum repair: put upload cleanup in the worker completion failure path regardless of record-save success, preserve the original error, and make terminal cleanup retryable when earlier cleanup failed. Test both transient persistence failure and cleanup failure without deleting existing card media.

### MF-03 — Minor: acceptance preview lacks media size/type and decoder-error feedback

- Location: `public/app.js:442-454`, compared with registered-card `cardMedia` at lines 150-193.
- The acceptance preview renders only each asset name. It has no `error` listener, MIME, or size. The later registered gallery does include all three. A supported/sniffed media file that the device cannot decode can therefore fail silently before the user decides whether to accept.
- Source-inspection finding, not a claim that a real browser decoder was tested. Existing live-HTTP/jsdom tests confirm controls and bytes, not decoder success.
- Minimum repair: reuse one preview/gallery renderer that includes name, MIME, size, and a once-only decode-failure explanation. Stop/release audio when the import preview is replaced or dismissed. Add DOM error-event tests and retain a real-device playback gate.

## Independent evidence and coverage

Commands and full output are retained here:

1. `node --test world-runtime/test/import-jobs.test.mjs world-runtime/test/importer.test.mjs world-runtime/test/backup-closure.test.mjs` — **59 passed, 0 failed**, `focused-existing.log`. Includes exact originals, format/resource validation, 21 MiB transfer, malformed/partial upload, cancellation, pre-publication cleanup, real SIGKILL after preview, startup recovery, backup closure and restore.
2. Review-local copy of existing DOM suite, changing only module/evidence paths, with `--test-name-pattern='media import previews|supplemental jsdom'` — **2 passed**, `existing-dom.log`. It executes actual app.js with real local HTTP/SSE/SQLite/DSH, covers JSON/PNG/CharX preview/accept, preview close, malformed import, full local image gallery, audio controls and exact WAV responses. `existing-dom-isolated.mjs` and `dom-evidence/dom-report.json` are retained. This is jsdom, not Chromium or visual/audio QA.
3. Independently authored `independent-media.test.mjs` — **3 passed, 2 failed**, `independent-media-complete.log`: approximately 60 MiB normal CharX accepted and preserved but backup fails; 25 MiB preparing cancellation cleans and frees the slot; accept immediately followed by cancel leaves no card/assets and a subsequent retry succeeds; 21 MiB backup/restore is exact; one ready-record disk-write failure leaves source staging. Initial three-test run and its failure log are also retained, not rewritten green.

Input media are authored synthetic PNG/PCM WAV/ordinary binary bytes. No third-party cards, attack payloads, external service requests, or exploit workflows were used. Storage tests use isolated disposable temporary directories.

## Requirement reconciliation and remaining gates

Read original `dsh-tavern-inputs/extracted/story-runtime-dev-plan/DEVELOPMENT_PLAN_FULL.md` §13.1–13.5 and CAP-08, plus `docs/MEDIA_IMPORT_SLICE.md` and `docs/WORK_LOG.md`.

- **Substantially covered:** all accepted local image/audio entries exposed rather than just the cover; names/sizes/MIME in registered gallery; missing/blocked/unsupported reports; binary XHR upload progress; worker parsing with indeterminate UI rather than fabricated parse percentage; explicit preview/accept; cancellation during upload/preparing/before publication; retry without duplicate registration; exact unknown resources; preview SIGKILL recovery and ordinary orphan cleanup.
- **Blocked in supported large range:** backup/restore closure, MF-01. The 21 MiB case passing cannot prove all admitted 64 MiB inputs have a supported backup path.
- **Failure cleanup gap:** MF-02. Atomic publication plus a later directory-sync failure is also worth an explicit regression: source currently marks an import failed after any thrown `importCard` error, whereas rename may already have published the card. This review did not inject that post-rename filesystem failure and does not count it as another reproduced finding.
- **Still unverified:** real Chromium layout, keyboard/modal timing and audio decoding; Android native/content-URI/device peak memory; Windows/macOS devices; licensed representative ST/Risu community samples; HTML/CSS/script interaction equivalence; hardware power-loss durability. None are closed by this review.
- The worker still materializes bounded packages and structured-clones parsed resources. A passing Linux 60 MiB input is not constant-memory streaming or mobile memory certification. Progress is real upload-byte progress, not a measured parse or registration percentage.
- Synthetic CharX/legacy Risu layouts establish format/IO behavior only; they do not establish broad ecosystem compatibility.

## Scope integrity

Only files under this `media-focus-review` directory were written by this reviewer. Concurrent review-generated updates elsewhere in `docs/e2e-evidence` and the separate `media-full-review` directory were observed and not reverted. Source hashes are retained in `source-sha256.txt`; no source changes or pushes were made.
