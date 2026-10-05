# B04 backup dependency-closure repair

Date: 2026-10-04. Scope: Linux application backup creation and new-directory restore. No external network, paid model, cloud task or Codex CLI was used.

## Confirmed defect and tests-first evidence

The old restore verified the size and SHA256 of each file present in the supplied manifest, opened the SQLite database, reset projection receipts, and published the directory. It never established which card/resource files had to be present. Removing only a PNG card's `assets/<sha256>` manifest record therefore passed the remaining checksums and published a broken save.

Before implementation, `node --test world-runtime/test/backup-closure.test.mjs` ran the first 29 tests: 1 passed, 28 failed. The failures included the reviewer's exact missing-PNG-asset case, omitted original/report/card/resource files, standalone-card registration loss, changed normalized identities and paths despite recalculated manifest hashes, dangling world-card references, and backup creation from incomplete storage. The original successful complete roundtrip remained green.

## Repair

- The manifest now contains an explicit, bounded, unique `cardIds` registration roster, including imported cards not currently used by any world. Every listed registration must have `card.json`, `report.json`, and its original upload. Files under unregistered card IDs are rejected. Empty live registrations are also rejected during backup creation.
- Each original's SHA256 must equal the registration ID and its normalized original identity/path. The exact original is passed through the existing bounded, non-executing importer in a temporary validation directory. Its derived normalized card and migration report must deeply equal the archived metadata. This establishes expected resources independently of the manifest, so deleting declarations as well as members does not hide missing original content.
- Every derived preserved-resource and display-media declaration must resolve to an included member with the correct SHA256 and size. All unknown/unsupported raw bytes, decoded Risu resources, and migration reports remain preserved. Missing, blocked and remote references explicitly reported by the importer remain valid source data; validation never fetches them.
- All asset filenames must equal the actual content hash; bytes must be accepted by the media allowlist and already equal the sanitized media bytes. Unreferenced safe immutable media left by an interrupted import may be retained. Unregistered raw resource members, active content masquerading as media, and unsanitized PNG metadata are refused.
- Every world's card must resolve to a registered card and retain the same normalized content, original identity, assets, and resources. The one supported server override, selecting a first message from the registered alternate greetings (including an empty greeting), is accepted.
- Backup creation validates against its SQLite online snapshot, not a later live snapshot. Restore validates the known database schema and the complete dependency closure before publishing its staging directory. Failure removes staging; the original save is never used to fill missing members. Existing target directories/files and dangling target symlinks are rejected. Symlinked input or parent paths are rejected.
- Derived host logs and credentials remain excluded. Hidden unfinished import staging is skipped. After successful validation, restored projection receipts are explicitly reset to `pending` for the existing host reconstruction flow.
- Strict manifest/member key checks, canonical Base64, lowercase SHA256, 2,000-member/128 MiB total/40 MiB per-member limits, source importer limits, and fixed path allowlists are retained/enforced.

## Compatibility and limits

This is the unreleased version-1 backup format. Earlier incomplete manifests without `cardIds` now fail closed with `BACKUP_FORMAT`; they are not silently upgraded. Export again with the repaired application. The parser/report representation must match the supported importer: a future importer normalization change requires an explicit backup-format compatibility decision rather than silent migration.

A direct `WorldStore.createWorld` test fixture with only a minimal name and no imported content-hash registration is valid for core store tests, but is intentionally rejected by the application backup API with `BACKUP_CLOSURE`. The normal server world-creation path imports/registers a real card first. SQLite's lower-level `WorldStore.backup` API is unchanged.

The data directory is assumed to be controlled by the local user, as for the importer. This is not an interprocess adversarial filesystem sandbox. Manifest hashes establish integrity/closure, not authenticity against an actor who can replace an entire self-consistent backup. Format-1 has no signature/authentication mechanism.

## Final focused verification

Node v24.19.0. Commands run from `host-source`:

```sh
node --test world-runtime/test/backup-closure.test.mjs
STORY_DSH_RUNTIME_DIR="$PWD/../dsh-pinned" node --test \
  world-runtime/test/backup-closure.test.mjs \
  world-runtime/test/importer.test.mjs \
  world-runtime/test/store.test.mjs \
  world-runtime/test/store-recovery.test.mjs \
  world-runtime/test/server.test.mjs
```

- Backup closure suite: 32 passed, 0 failed, exit 0
- Focused importer/core-store/recovery/HTTP-server plus backup suite: 81 passed, 0 failed, exit 0
- Includes real PNG and CharX imports, supported/unsupported Risu resources, standalone cards, empty stores, alternate greetings, exact raw-byte preservation, safe media access after restore, branches/scenes, receipt reset, and HTTP restore plus explicit host reconstruction
- An additional concurrent run including `e2e-api.mjs` passed 79/81 tests at that point. Its two failures occurred before backup in player-visible NPC-location/autonomy assertions after concurrent privacy-projection changes. They were reported to the parent integrator; this scoped repair does not edit that test or projection code. Do not present that run as a complete API E2E pass.
- No full unrelated upstream test suite was run
