# Linux WorldMode — independent help-fix and final regression review

Review date: **2026-10-04 UTC, 17:39–17:44**

## Decision

**Linux source/code candidate: PASS. Critical: 0; Major: 0; remaining Minor: 0 found in this review.**

- **Spec: PASS** for the documented Linux implementation and exercised contracts
- **Quality: PASS** for that source candidate; Q04 is independently closed
- **Actual Chromium / visual / complete product acceptance: BLOCKED, NOT PASSED**

This is a new independent review after the Q04 correction. The earlier `BACKEND_REVIEW.md` and `FINAL_RELEASE_REVIEW.md` remain as-found FAIL records. `FINAL_RELEASE_REVIEW_AFTER_FIX.md` remains the preceding complete review, including its then-open Q04. This pass permits accurately labeled source-candidate delivery; it does not turn a DOM test into real-browser or visual acceptance.

## Scope and method

First read the previous failed reviews, the subsequent two-axis pass, Linux scope/contracts and README, and the original reference plan's requirements, invariants, recovery and release gates. Focused inspection covered both changed entry points, the new regression and its recorded red/green evidence. Then rechecked the complete Linux candidate's storage/reducer, host projection, importer/media/module handling, model/context, HTTP/run lifecycle, backup/restore and actual UI source, with the full quick and API/DOM regression suites. Reviewed the installer, package scripts/locks, source exclusions and the complete/compact packaging scripts.

The functional change is limited to `world-runtime/cli.mjs`, `start-story-runtime-linux.sh`, and the new help test. Core server/model/store/host/backup/app source hashes still match the preceding independent pass; no upstream large CLI change was found. Documentation updates occurred in parallel as expected. All **38** monitored code, UI, test, fixture, entry-point, package and lock files stayed unchanged throughout this review.

Checks used synthetic local stories, disposable temporary data, real HTTP/SSE, SQLite and installed DSH. Model tests used loopback protocol fixtures, with no paid provider calls. No Codex CLI, independent cloud task, user-computer operation, external publication or retry around a denied browser route was performed. This report is the reviewer's only repository write; runtime logs and DOM evidence were redirected to temporary reviewer storage.

## Q04 disposition

**Closed.** The CLI recognizes `help`, `--help` and `-h` before resolving data paths or dynamically importing server/backup/runtime modules. The launcher detects help before its optional dependency-install branch. Its existing Node availability/version check is retained. Non-help startup remains on the existing serve path.

The new test copies only the two entry points into a temporary installation with no application modules, installer or runtime. It exercises five forms against both direct CLI and shell launcher: `help`, `--help`, `-h`, `serve --help`, and `--port 0 -h`. It supplies a data path, installs a test-only listener guard, requires successful usage output without a server URL, and checks that no data/runtime directory or additional root entry appears. All ten invocations pass in the independent aggregate run.

The recorded red test fails at an attempted server import, while the green test returns usage. This appropriately catches the broader side-effect problem as well as the originally observed `--help` server launch. The usage text still includes the restore command. No server, dependency installation or user-state write is needed for help.

## Independently executed evidence

| Check | Result |
|---|---|
| `npm run test:world` | **104 passed, 0 failed, 0 skipped**, exit 0; includes the help guard and genuine live-SSE child-process crash recovery |
| API plus actual-app DOM integration | **6 passed, 0 failed, 0 skipped**, exit 0; actual served app.js with real HTTP/SSE, SQLite and DSH |
| Official upstream focused runner: host-projection-replay-native, session-stable-prefix, story-ledger, story-timeline | **34 passed, 0 failed, 0 skipped**, exit 0; explicit installed rc.2 `DSH_BOOT_MODULE` |
| `npm run check:client` | Exit 0; original Tavern client artifact current |
| `node --check` on every WorldMode source/test, app, CLI and installer; `bash -n` on launcher | Exit 0; syntax evidence only |
| Real documented launcher from another cwd, Unicode/space data path, no runtime override | Health/config passed; created a real demo world with zero initial scenes; no installer invoked; no model configured; SIGTERM exit 0 and application lock removed |
| Runtime and locks | Four required installed DSH packages each **0.1.5-rc.2**; all three baseline lock hashes match |
| Frozen source check | **38/38** files unchanged |
| Actual Chromium / visual journey | **Not rerun and not passed**; existing access/environment blockers retained |

The normal integration command is:

```sh
node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs
```

To preserve the sole-report-write boundary, the independent run used a temporary copy of the DOM test. Only its import locations, installed-runtime location and evidence destination were adjusted to absolute paths. Assertions, application source, served HTML, backend responses and protocol handling were unchanged. The run included the active-generation reload/cancel and delayed author/player response regressions, not only the basic happy path. jsdom is not Chromium.

## Whole-candidate conclusions and delivery boundaries

- **Authority/recovery:** SQLite remains the sole world authority. Formal narrative, events, state, run completion and outbox share the transaction. Explicit scope/head/source guards, immutable ancestry, cancellation, idempotency and atomic revision remain intact. Safe narrative is checkpointed before publication; crash/restart does not generate again
- **Projection:** the minimal native Session/JSONL path, ordered persistent identities, durable-read verification and explicit recovery boundaries are unchanged. The relevant full API and native upstream regression checks passed again
- **Visibility/context:** private audit operations, unplanted plans and NPC intent remain excluded from player/model projections. Scheduled fact observation uses exact identity/holder plus explicit public visibility. Selected rendered openings enter context without becoming initial canon. The actual-app reload and view-race regressions passed again
- **Import/actions/autonomy:** data-only bounded imports preserve originals and unsupported resources, without executing legacy behavior. Declarative actions remain validated, card actions cannot acquire author lock override, and bounded due events use no model request. Autonomy starts off after restart
- **Backup/restore:** the official SQLite online-backup path, per-file hashes and reconstructed card/resource reference closure are retained. The complete closure suite and API roundtrip passed. Restore is staged into a fresh directory; damaged/incomplete bundles and existing targets fail rather than overwriting saves. Server model credentials and derived host logs are excluded
- **Installation:** README and launcher require Node >=24.19.0; the installer copies the pinned runtime lock, uses `npm ci --ignore-scripts` against the official registry and checks required package versions. This review used and verified the existing exact installation and read the earlier clean-install log; it did **not** perform another fresh network installation
- **Packaging:** the full source packager copies tracked files and verifies archived hashes; its explicit exclusions protect runtime/dependency/private-data directories. The compact packager removes only six upstream documentation/media prefixes and retains WorldMode code, locks, tests, reviews, README and licensing. Because packaging uses `git ls-files`, new test/review files must be tracked before creation. The owner confirmed that step and final extracted-archive smoke checks are still to be performed. This report does **not** attest a not-yet-produced final ZIP
- **No broadened claim:** real-provider billing/cache/quality, hardware power-loss durability, signed distribution and Android/macOS/Windows qualification remain outside this pass. The root package's old Tavern identity is retained; the Linux runtime is a separate documented entry point

The preceding B01–B05/Q01 and R01–R05/Q02–Q03 closures show no regression in this candidate. Q04 is now closed. No new Major was found.

## Remaining release gate

The existing real-browser evidence shows Chromium failing before page load because `ProcessSingleton socket()` is denied. Supported cloud-browser access to the local application was separately denied; the integration owner confirmed no supported preview route. Neither route was retried here.

Before claiming complete browser/product acceptance, run the shipped Playwright journey on an authorized Linux environment where Chromium starts, and inspect real desktop/mobile rendering, screenshots, downloads, console/page errors and interactions. Existing DOM success and a syntax-valid browser script cannot close this gate. Preserve all failed reviews and the explicit blocker in both source packages.

## Reviewed source identity

Baseline upstream: `403df2d1e4080e4846627a58572c6347e3eefc02`. Local pre-packaging HEAD: `2f3dc8ac2987f3288fff56c6cb3fd5c8e8a1206e`, plus the inspected help patch/test and documentation. Node **v24.19.0**, npm **11.9.0**.

| File | SHA256 |
|---|---|
| `world-runtime/cli.mjs` | `2497dc76c307ade4c9fbc4f99662b212e12bb18fadfd2613972a070292677564` |
| `start-story-runtime-linux.sh` | `6a5d909a4d57bc6a076c33c8a3f32f4e0d8f569448fcb92efb8005550397dc20` |
| `world-runtime/test/cli-help.test.mjs` | `afaf30059eff49cd59b6e90bbb8cf7efc7bfc84bb898d195c88c1cb202e94558` |

The 38-file source-checksum list digest is `5b28f1546bbdbca02e051568d1d5f1fdc05d77776ab004f66de1162101206725`. Packaging/documentation changes may follow without changing the code verdict only if the packaged source matches this candidate. Any further functional source change requires affected verification and review again.
