# Linux card importer work log

2026-10-04. Scope: ST v1/v2/v3 JSON/PNG, Risu CharX, original and unknown-resource preservation, safe immutable media. No card scripts executed and no remote resource fetches. This is a bounded Linux slice, not full source-platform behavior compatibility or cross-platform certification.

## Tests-first evidence

- Inspected fixed host parser in `tavern-plugin/lib/domain/card-preparation.js`, `file-resources.js`, `mobile-card-import.js`, and `client.js`. Existing PNG parsers return the first metadata block without CRC/conflict checks. The new bounded transport parser does not invoke the host's old mutation or script paths.
- `createCardPreparation().project` is reused directly for ST text, tags, greeting, and field projection after shape/complexity validation. Existing greeting positions, empty strings, and duplicates are retained.
- Synthetic import fixtures and the first ten regression groups were written before `src/importer.mjs`. Initial `node --test world-runtime/test/importer.test.mjs` failed with `ERR_MODULE_NOT_FOUND` as expected (exit 1). After implementation these groups passed; module, media, storage, and regression coverage expanded to 19 groups.
- Reproducible focused command from `host-source`: `node --test world-runtime/test/importer.test.mjs`. Node v24.19.0, 19 passed, 0 failed, exit 0. No full upstream suite run and no paid/model/network requests in tests.
- Installed fflate was inspected at version 0.8.3. Production code and committed importer tests have no fflate dependency: only Node built-ins and the existing host's pure card projection are used.
- One-off interoperability check generated a streaming `fflate.Zip` + `ZipDeflate(level:0)` archive, matching the pinned Risu writer's normal data-descriptor shape; the importer read `card.json` and its asset. This was an optional local probe, not a runtime dependency.

## API and persistence contract

- `importCard({filename,bytes,dataDir})` is async and returns `{card,report}`. `bytes` is a Uint8Array/Buffer.
- `listCards(dataDir)` returns normalized cards; `readCard(dataDir,id)` returns `{card,report}`; `assetPath(dataDir,id)` returns `{path,mime,size,sha256}` with a checked absolute server-local path.
- Card IDs and asset IDs are lowercase SHA256 hex. Unchanged source content deduplicates to a stable card even when imported concurrently. Changed content remains a separate card despite identical filename/name.
- `cards/<source-sha>/card.json`, `report.json`, `original`, and `resources/<resource-sha>` store normalized metadata, migration report, exact original upload bytes, and exact extracted/decoded resource bytes. Card metadata paths are relative to dataDir. Source filenames and archive filenames never become extraction destinations.
- `assets/<media-sha>` contains only byte-sniffed displayable raster/audio media. PNG display copies omit metadata and nonessential ancillary chunks; originals remain exact. Different source names can reference one immutable media hash.
- Whole input and resource validation precedes storage changes. Card files are fsynced in `.staging-<uuid>` then directory-renamed to register; incomplete staging directories are not listed. Immutable media are written and fsynced inside staging, then hard-linked atomically into the media store before card registration; interrupted writes cannot expose partially written media. I/O/crash failure can leave unreferenced safe media or hidden staging folders, never a registered half-card. Automatic garbage collection, progress streaming, and import cancellation are not implemented in this Linux slice.
- No-follow file opens, plain-file/directory checks, hash validation on served assets, and strict IDs protect storage lookup. The data directory must be controlled by the local user; this is not an interprocess adversarial filesystem sandbox.
- `readCard` never trusts imported original/asset paths for lookup. The HTTP integrator must use helper resolution and `nosniff`/appropriate CSP; retained nonmedia originals must be downloads, never executable inline content.

## Supported inputs and bounded behavior

- JSON: v1 root card; v2/v3 spec wrapper. Missing name, nontext critical fields, invalid UTF-8/JSON, dangerous object keys, nonfinite parsed numbers, and excessive complexity reject the import.
- PNG: validates signature, all chunk bounds and CRCs, mandatory header/end, pixel dimensions, bounded IDAT inflation and row filters; reads base64 chara/ccv3 in tEXt/zTXt/iTXt. All discovered card metadata is checked. Compatible v2/v3 fields select ccv3; conflicting shared fields or duplicate keyword records fail explicitly. The exact PNG retains all metadata.
- CharX: normal ZIP with root `card.json`, optional `module.risum`, and arbitrary resources. Stored/deflate methods, UTF-8 names, and standard streaming data descriptors are supported. Full central/local/descriptor consistency, CRC, overlap, path, flag, size, count, and ratio checks run before extraction.
- Unsupported ZIP64, split archives, JPEG+ZIP prefix packaging, unsupported codecs, encrypted entries, symlinks/special files, duplicate/case/NFC-confusable names, absolute/drive/backslash/traversal/percent-encoded paths, or corrupted critical card data fail atomically. This conservative subset is reported rather than silently repaired.
- Limits: raw upload 64 MiB; cumulative archive/module-expanded bytes 128 MiB; single entry/media 32 MiB; JSON 8 MiB; ZIP entries 512; compressed ratio 100; path depth 12; path length 512 bytes; JSON depth 64/nodes 100,000; PNG chunks 4,096 and metadata chunks 16; image dimension 16,384 and pixels 40 Mi. PNG pixel rows are additionally capped by the 128 MiB expansion limit.
- Media whitelist: PNG, JPEG, GIF, WebP, WAV, Ogg Vorbis/Opus, FLAC, and MPEG audio with signatures/structural header checks. PNG pixels/rows are decoded for bounds validation, not rasterized. Other image/audio codecs and active formats including SVG/HTML/JS/Lua/wasm/PDF are retained but not served as media. Audio is never played automatically by this module. These checks do not claim a complete third-party multimedia-codec security audit.
- Remote/file/data/javascript asset references are never fetched or evaluated. Missing packaged references are explicitly reported. Unknown fields, extensions, unsupported bytes, and source references remain in original and normalized preservation metadata.

## Risu module source pin and migration

Read-only official GitHub Contents API resolved these files at commit `9f3b589b6e74230401a431a00fd977986d212870` after the public web cache did not resolve the fixed raw URLs:

- [process/modules.ts](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/modules.ts), Git blob `8dd9356e606a8c26ba87e9334dd57137e545d09c`
- [process/processzip.ts](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/processzip.ts), Git blob `8d00acf964055dea07a0e40c2f956b1aca2accd6`
- [rpack/rpack_js.js](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/rpack/rpack_js.js), Git blob `5a99f0471148230bd8480d50462da9a4c8a57d1e`
- [rpack/rpack_map.bin](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/rpack/rpack_map.bin), Git blob `18e10e23907af0b8b15f26aae1cffc4cc4d269f5`
- [characterCards.ts](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/characterCards.ts), especially CharX import's overrideLorebook and exportModuleLegacy call

`import-risu.mjs` independently implements the observed legacy wire format with explicit bounds: magic 111, version 0, little-endian payload length, RPack byte-substituted JSON, zero or more marker-1 asset records, marker-0 end. It uses the fixed 256-byte decode table; tests have the corresponding frozen encode table. Unsupported/future/malformed module payloads retain exact bytes and a specific unsupported report. Limit violations still reject the whole upload.

Decoded module metadata and embedded media are saved; module lorebook replaces the card-worldbook duplicate exactly as the pinned Risu import does, while preserving both copies. Module unknown fields remain available. Regex, triggers, cjs/Lua, MCP/low-level access, styling, defaultVariables templates, and source-platform execution APIs remain disabled or explicitly unsupported. Native `extensions.story_runtime` is retained as declarative data and must be validated by the core when creating a world or committing an action. Ordinary source `extensions.variables` are preserved and are not silently promoted into trusted state.

Worldbook normalization supplies `keys`, `secondaryKeys`, `content`, `enabled`, `constant`, `selective`, `order`, `position`, and `comment`, retaining `raw` and unknown original fields. Regex/decorator entries are disabled. Only the context compiler's documented literal-key/budget behavior is usable; no arbitrary regex or advanced source-platform activation is claimed.

### Licensing notice

The RPack byte table is sourced from RisuAI at the pin above. Its [RPack LICENSE notice](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/rpack/LICENSE) requires AGPL-3.0 for use outside RisuAI. This host is already distributed under AGPL-3.0, with the full license at `host-source/LICENSE`. The importer source and fixtures preserve table attribution and this AGPL boundary; no MIT-only claim is made. The rest of the decoding implementation was written here; no Risu UI/network/script runtime is bundled or executed.

## Synthetic files for browser verification

- `fixtures/import-card-v2.json`: unknown fields/extensions, greetings, worldbook, variables and a declarative action
- `fixtures/import-card-v2.png`: identical synthetic card in PNG metadata
- `fixtures/import-card-v3.charx`: successful legacy module decoding, lorebook override, safe duplicate raster resource, unknown resource preservation
- `fixtures/import-card-unsupported-module.charx`: unsupported module, blocked active resources, missing resource and blocked remote reference reports
- Fixtures contain no third-party character-card text or user data. `fixtures/import-fixtures.mjs` provides reproducible encoders; no legacy scripts are executed in any test.

## Remaining evidence boundary

Focused importer checks are green. Browser upload/rendering, original download/export, restoration, source-backed context activation, and native action commits are integration-owner checks. No Android/macOS/Windows result or complete arbitrary Risu/SillyTavern plugin compatibility is implied.
