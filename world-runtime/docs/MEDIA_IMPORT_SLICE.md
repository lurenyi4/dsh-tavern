# Linux local-media and import slice

Base: independently reviewed source `172a8df057cf2f716a867fa4f70fed3b2f400fd7`. Work is isolated on `feat/local-media-imports`; the reviewed publication candidate `58562fac0cd308028000404cc4e05a1ed45a6d54` is unchanged. This slice needs its own two independent reviews.

## Requirement and verified gap

The supplied development plan §13.1 requires a preview and acceptance before content registration; §13.2 includes images/backgrounds/expressions and common audio previews; §13.5 and T-09 require bounded imports, progress, cancellation, interruption recovery and unreferenced resource cleanup. CAP-08 covers content-package resource display. The prior Linux UI only displayed a first-image cover, used a 20 MiB FileReader/base64 upload, and immediately registered content. Backend staging existed, but the UI had no import cancellation or preview-accept boundary. The coverage audit explicitly kept T-09, CAP-08 and representative ecosystem samples open.

## Implemented slice

- A card's “素材” view presents all locally validated images and audio, filenames, MIME and sizes. Images lazy-load; audio uses explicit native controls with preload disabled. A decode failure in the gallery is reported. No remote resources are downloaded.
- The import UI sends the selected File as binary through XMLHttpRequest, showing real upload bytes. Parsing occurs in a Node worker, keeping the HTTP/UI server responsive. Parsing shows an indeterminate phase rather than invented percentage. The worker has a 30-second ceiling.
- Before registration, the user sees card name, opening, image/audio previews and the full compatibility report. “接受并导入” explicitly registers; Cancel, Escape or Close cancels. Reloaded tabs can cancel an abandoned task through the import button and choose the file again.
- One active import, maximum 64 MiB original and the existing 128 MiB expanded / 32 MiB per-entry / 512-entry bounds. Uploads go incrementally to an application-owned temporary file, without browser or HTTP base64 duplication. Parser output is still bounded in-memory data; this is not constant-memory archive decoding and is not an Android memory certification.
- Registration retains the original atomic directory-rename boundary and content hashes. Cancellation is checked between resource writes and before publication. Newly created asset links are removed on pre-publication failure; previously registered shared media are retained. Once atomic publication has occurred, the result is completed rather than falsely reported cancelled.
- Startup, under the existing exclusive data-directory server lock, records interrupted jobs, removes abandoned import staging and removes only content-addressed assets unreferenced by registered cards. Corrupt card metadata stops cleanup rather than guessing references. Re-upload is explicit; there is no promise of byte-offset upload resumption.
- The last 50 job records are retained. Legacy `/api/import` remains for existing API callers with its existing limits; the interactive UI uses the new preview/accept path.

## Evidence and limits

New tests cover exact-original preservation, preview/no-registration, cancellation, malformed and partial transfer, source/media preservation, 21 MiB CharX streaming in 256 KiB chunks, restart, actual child-process SIGKILL after preview, and asset cleanup retaining registered references. Live app.js DOM tests upload JSON/PNG/Risu-layout CharX, accept previews, close a preview before registration, request local image bytes, and request exact synthetic PCM WAV bytes through preview and registered media controls. These checks do not demonstrate a real browser decoding audio or visual layout.

The existing generated fixtures cover CCv1/v2/v3, PNG metadata variants, a fixed legacy Risu module layout, worldbook override, missing/blocked media, alternate openings, exact unknown bytes, backup/restore and world creation. New large/audio fixtures are authored synthetic data and carry no third-party card/media content. They are genuine format/IO tests, **not representative real community cards**. Broad ST/Risu compatibility remains open until appropriately licensed samples are available and tested; no unverified compatibility promise is added.

Still open: real Chromium visual/audio interaction (existing environment blocker), Android native implementation and device memory/content-URI tests, Windows/macOS devices, broad licensed card ecosystem, HTML/CSS interaction equivalence and real model quality/cost evaluation. This slice does not close the complete product gate.

## Review repair: shared backup budget and publication outcomes

The first two independent reviews rejected this slice (reports/logs retained in media-focus-review and media-full-review). Their 42–60 MiB accepted-CharX backup failure and post-publication directory-sync failure were reproduced before repair.

Original admission and backup/restore now share a 64 MiB per-file bound through storage-limits.mjs. The aggregate backup remains 128 MiB decoded and 2000 files; encoded JSON remains bounded. Preview admission, and again registration under the importer lock, accounts for exact original bytes, preserved resources, deduplicated display assets, metadata, previously registered content and the current SQLite database/WAL size. A package whose duplicates would exceed the aggregate budget is explicitly rejected before offering acceptance. This is a conservative current footprint check; future world/database growth can still exhaust the finite backup limit and then requires another data directory/export planning. It is not a promise of unlimited database storage or streaming JSON backup. No original or unknown resource is discarded to make backup succeed.

A successful card-directory rename is registration. If its subsequent directory fsync fails, the importer returns the registered card together with IMPORT_DURABILITY, including the underlying storage code. Jobs persist and expose that warning separately from completed; simultaneous cancel cannot relabel a published card as cancelled. Restart reconciles pending/old failed-or-cancelled publication records with the actual registered card and retains uncertainty rather than claiming confirmed power-loss durability. If a previously completed registration is absent on restart, the job reports IMPORT_PUBLICATION_MISSING. The UI presents the warning; backups independently validate the surviving card closure.

Ready-record persistence failures now clean the source upload even when metadata save fails. Failed cleanup is a separate visible warning, retryable through cancel, close and startup. Primary persistence errors are retained. Preview and registered galleries share one media renderer: name, MIME, size, once-only decoder-error feedback, plus pause/remove-src/load on dismissal, acceptance, replacement or unload. DOM tests instrument the missing jsdom media methods to assert these calls; they do not claim audible playback.

New regression evidence includes actual HTTP 42 MiB import/world/backup/new-directory restore, the independent original 60 MiB test passing unchanged, over-budget ordinary PCM-media duplication rejected before registration, post-publication EIO with/without cancel and restart reconciliation, transient persistence plus cleanup EIO recovery, and live-DOM decoder-error/close/replacement media-release assertions. Original open device/ecosystem/model gates remain open. This repaired candidate still needs two fresh independent reviews.

## Final independent decision — 2026-10-05

Both new independent reviews PASS on source9bc7960 (media-final-focused-review/REVIEW.md and media-final-full-review/REVIEW.md). No block/critic/major remains for this Linux slice. This decision supersedes the historical “new reviews pending” notes above for this source only. Local and independent full execution both report191unit/10HTTP+DOM passes.

Accepted non-blocking minor: when registration rename fails EIO and staging removal also fails EBUSY, the latter can replace the primary diagnostic and postpone staging/new unreferenced asset cleanup until startup. Cancellation alone does not own these leftover paths. Independent HTTP tests confirm no card published or registered card modified; after the fault is removed, another import, world creation and complete backup succeed, and restart clears the leftovers. No code change was made for this optional follow-up; see full-review F1. This is not a power-loss durability guarantee.

Publish this reviewed slice only on feat/local-media-imports; main remains the previously reviewed Linux baseline. The complete-product, Android/native, device, real-browser, licensed-ecosystem and model-quality/cost gates listed above remain open.
