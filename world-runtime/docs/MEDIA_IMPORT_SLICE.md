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
