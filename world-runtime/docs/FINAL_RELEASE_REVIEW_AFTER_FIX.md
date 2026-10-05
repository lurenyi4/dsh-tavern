# Linux WorldMode — independent final review after fixes

Review date: **2026-10-04 UTC, 17:25–17:33**

## Decision and release boundary

**Linux code candidate: PASS. Critical: 0; Major: 0; Minor: 1.**

- **Spec: PASS for the documented Linux implementation**, with no remaining Major found in the reviewed code and independently exercised contracts
- **Quality: PASS for that code candidate**, with the non-blocking CLI help defect Q04 below
- **Actual Chromium / visual / complete product release acceptance: BLOCKED, NOT PASSED**

This is a fresh two-stage independent review of the finished, frozen candidate, not an amendment that turns either earlier failed review into a pass. `BACKEND_REVIEW.md` and `FINAL_RELEASE_REVIEW.md` remain valid as-found FAIL records. This decision permits delivery of the accurately labeled Linux source candidate; it does **not** close the outstanding real-browser requirement or certify a fully accepted release.

The user's Linux-first scope is honored. Android, macOS and Windows remain deferred and unvalidated; their absence is not a Major against this Linux candidate. Real paid-provider quality/billing/cache behavior, hardware power-loss durability, signed installers and external publication are also outside this pass.

## Scope and method

**Stage 1, focused review:** read both previous failed reviews in full; traced and rechecked B01–B05/Q01 and R01–R05/Q02–Q03, including new paths introduced by draft checkpointing, live-run attachment and view-request invalidation. Rechecked authority, idempotency, actor visibility, source/head guards, cancellation, branches, native projection ordering/ACK, and backup reference closure.

**Stage 2, entire Linux implementation:** read all WorldMode `src/*.mjs`, the actual `public/app.js`, HTML, styles and icon; CLI, installer, launcher and package scripts; all WorldMode unit, recovery, API, DOM and browser test implementations and fixture helpers. Checked the reused upstream card projector and relevant installed native Session, surface and JSONL persistence contracts. Reviewed the Linux README, scope/contracts/ADR, build baseline, execution/import/storage/backup/E2E logs, review index, original confirmed requirements/traceability/start instructions and the reference plan's invariants, commit/retry, visibility, imports, branches, scheduling and release gates.

Baseline independently checked: upstream **403df2d1e4080e4846627a58572c6347e3eefc02**, Node **v24.19.0**, npm **11.9.0**, installed DSH **0.1.5-rc.2** in `world-runtime/.runtime`. The three lockfile hashes match `BUILD_BASELINE.json`. This is a local source addition to that pinned baseline, not a published upstream version.

All exercises used disposable local data and synthetic story content. Model protocol tests used local HTTP mocks only. The genuine crash test killed only its own child application. No paid provider, user credential, full Tavern tool profile, Codex CLI, separate cloud task, external publication, security-setting change or denied browser-route retry was used. This report is the reviewer's only repository write; source remained frozen.

## Independently executed evidence

| Check | Result |
|---|---|
| `npm run test:world` | **103 passed, 0 failed, 0 skipped**; includes the genuine live-SSE child-server SIGKILL recovery test |
| API plus actual-app DOM integration | **6 passed, 0 failed, 0 skipped**; real HTTP/SSE, SQLite and native DSH; DOM is not Chromium |
| Official upstream focused runner: story-ledger, story-timeline, session-stable-prefix, host-projection-replay-native | **34 passed, 0 failed, 0 skipped**, with `DSH_BOOT_MODULE` pointing explicitly at the installed rc.2 boot module |
| Three additional independent production-module exercises | **3 passed**: post-durability failure/order/idempotency; valid asynchronous native surface replacement; exact fact identity/holder visibility with explicit-public positive case |
| `npm run check:client` | Exit 0; original Tavern client artifact remains current |
| `node --check` on every WorldMode source/test, app, CLI and installer; `bash -n` on launcher | Exit 0; syntax evidence only |
| Documented launcher from another working directory, Unicode/space data path, no runtime override | Real server health/config passed using installed runtime; no model configured; SIGTERM exit 0 and application lock removed |
| `node world-runtime/cli.mjs help` | Exit 0, prints usage |
| Frozen-source checksum comparison | All **37** monitored source, UI, test, fixture, entry-point, package and lock files unchanged |
| Real-browser execution | **Not rerun**: prior confirmed access/environment blockers remain; no browser/visual pass claimed |

The normal integration command is:

```sh
node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs
```

To honor the sole-report-write restriction, this review ran an otherwise identical temporary copy of the DOM test with imports resolved to the same repository files and its evidence directory redirected outside the repository. It still fetched the actual served HTML/app.js and used the actual backend; no assertions or application responses were replaced. An initial temporary-loader attempt incorrectly resolved Playwright's CommonJS entry and failed before executing the DOM suite. Resolving its normal ESM entry corrected that review harness; the complete rerun passed all six tests. The first additional surface fixture was likewise rejected by DSH for missing native system-message fields; it was corrected to the actual native format before the successful surface-replacement assertion. Neither harness error was counted as a product failure or a passing check.

The installer itself was source-reviewed against its exact lock, installed versions and existing clean-install log. It was **not reinstalled** during this review; the documented runtime was already present and used by the independent tests and launcher.

## Previous finding disposition

| Finding | Independent final result |
|---|---|
| B01 — private operation updates/nested plans | **Closed.** Player scenes return no raw operations; author audit remains available. ID-based private updates, nested proposals and NPC intentions are omitted from player/model projections |
| B02 — unplanted plot exposure | **Closed.** Player/model state includes planted, partially resolved and resolved threads, excluding planned/abandoned material |
| B03 — safe draft representation/replay | **Closed.** Persisted/public draft is plain narrative, not re-parsed as provider JSON. Failed, cancelled and interrupted narrative remains visible; raw operation proposals stay out of public replay |
| B04 — incomplete backup closure | **Closed.** Re-imported exact originals establish required card/report/raw-resource/media closure. Omission, altered declarations/identities, missing registrations and damaged source exports fail before restore publication; complete multi-card/branch roundtrips pass |
| B05 — missing branch silently targets active branch | **Closed.** Every world-scoped POST requires explicit nonempty branch before state resolution; the store validates world/branch membership. The separate read-only active-branch convenience remains intentional |
| Q01 — arbitrary JSON context truncation | **Closed.** Structured per-collection budgets preserve valid JSON and current state despite long character descriptions |
| R01 — visible draft lost at genuine process death | **Closed.** Both demo delta and model narrative callbacks synchronously save the safe draft before SSE publication. The actual child-server test observed the live draft, SIGKILLed the child, restarted the same data and retained that exact draft with zero scenes; attempt became failed with unknown tokens and mock-provider calls remained **1** |
| R02 — reload loses active generation/cancel controls | **Closed.** Fresh actual app.js DOM restores remembered world/branch even with a newer decoy world and changed server active branch, attaches once to the existing run, receives continued text and cancels it. Reload submitted **0** turns; run/attempt counts remained **1/1**, state unchanged |
| R03 — same-key private scheduled update becomes public | **Closed.** Scheduled public narration requires an explicitly public operation and exact ID or key/holder resolution to a public fact. Independent real-store cases covered both ID and key/holder private updates plus a positive public result. Later declassification does not promote an earlier implicitly private update |
| R04 — stale author response leaks in player mode | **Closed.** Each toggle requests a new ticket/view and clears private panels immediately. Delayed real HTTP response tests confirm older author data is discarded; tab changes cannot restore cached author content while player response is pending; observer recorded **0** transient leaks |
| R05 — selected opening missing from model input | **Closed.** Default/alternate opening uses the same pure template preview surface for UI and context. Captured actual local-provider requests contain the selected rendered opening, exclude the unselected opening and retain noncanonical imported-material labeling; no initial scene/state side effect |
| Q02 — unit/HTTP runtime defaults to research sibling | **Closed.** `server.test.mjs` now defaults to installed `.runtime`; the documented aggregate test passed without that override |
| Q03 — Chromium variable differs between docs/code | **Closed.** Both use `STORY_CHROMIUM_PATH`; this is a configuration correction, not browser execution evidence |

## Whole-implementation Spec / Quality conclusions

- **Single authority and recovery:** SQLite WAL/FULL is the world authority. Formal body, validated operations/events, after-state, run completion and outbox are one transaction. Fault tests at all three commit seams leave no partial canon. Model requests occur outside transactions; each displayed narrative checkpoint remains noncanonical until commit. Unknown or unsupported database schemas are refused rather than silently migrated
- **Native DSH boundary:** the actual host boot configuration contains only Session and JSONL persistence modules. Persistent message identity includes world, branch, commit and payload digest; native persisted history and current surface are checked before ACK. Independently injected failure after the first scene's native durable flush left receipts pending; retry preserved that exact first message, appended the second in order, and repeated drain added nothing. A valid native surface replacement during the awaited flush yielded `HOST_SURFACE_CHANGED` and no ACK. Historical outbox reset/restore tests do not regenerate a model response
- **Branch/author semantics:** immutable ancestry stops at the fork point; sibling future is rejected. Revision forks before the target and replaces within one transaction, with rollback of branch creation on invalid replacement. Head/source revision, scoped run fingerprints, terminal cancellation and trusted-author fact locks are enforced. Imported native card actions do not acquire author override
- **Visibility/context:** fact truth, player beliefs and NPC locations are separated. Private mutations, NPC schedules and unplanted plans do not enter player/model projections. Selected opening and example dialogue are identified as imported/style material. Context is deterministic and bounded; these controls do not guarantee narrative causality or complete long-story recall
- **Imports/native capabilities:** ST v1/v2/v3 JSON/PNG, ordinary CharX and bounded legacy Risu module decoding preserve originals, unknown fields and raw resources. Limits, archive consistency checks, staged publication and hash-addressed media are exercised. Source scripts/HTML/CSS and arbitrary tool/network capabilities are not executed. Unsupported semantics are reported; no full legacy-plugin compatibility is implied
- **Backup/export:** official SQLite online backup plus immutable content forms the bundle. Both included-file hashes and dependency closure are checked. Restore publishes only a verified fresh directory and explicitly resets derived receipts. Host logs and server model credentials are excluded. Player export uses the filtered projection. Integrity/closure is not authentication of an adversarially replaced complete bundle
- **Model/cost contract:** the single compatible Chat Completions path supports streamed and nonstreamed local protocol fixtures, bounded response/output, normalized usage, cancellation and explicit saved-draft settlement retry. It has no tool capability or automatic paid retry. Unknown usage remains null/“未知”; demo is clearly deterministic. No real cost, cache-hit or narrative-quality guarantee was validated
- **Autonomy/UI:** due events are deterministic and bounded, conditions/effects are rechecked, empty due queues make no model request, player-involving scheduled actions pause autonomy, and restart leaves it off. The actual app's tested import/create/send/cancel/native-action/author/branch/reload/retry flows use real service state. Text-node rendering and static responsive rules were inspected; Chromium behavior, visual polish and mobile layout remain unqualified
- **Delivery/reproducibility:** the exact runtime lock, private-runtime/data exclusions, Linux version check, quoted launcher paths, recovery instructions and source/AGPL/Risu attribution are present. Old Tavern mode is preserved. Packaging must retain the new WorldMode files and README and continue to label this a source candidate with the browser gate open

## New non-blocking Minor

### Q04 — `--help` starts the server instead of showing help

**Severity: Minor — Quality**  
**Location:** `world-runtime/cli.mjs:3,12`

The action parser treats a leading `--...` argument as the default `serve` action, so the later `action === '--help'` branch is unreachable. In a disposable directory, `node world-runtime/cli.mjs --help --data-dir <temporary-directory> --port 0` printed a server URL and served `/api/health` instead of exiting with usage. The reviewer stopped it cleanly and removed only the test data.

The documented launcher/serve/restore paths work, and `node world-runtime/cli.mjs help` prints usage correctly. **Use the `help` subcommand for this candidate.** A later change should recognize `--help` before defaulting to `serve` and assert that help creates no data directory/listener. No source correction was made during this frozen review.

## Remaining gates and source identity

The existing browser failure evidence was read: new Chromium fails before page load at `ProcessSingleton socket()` with `Operation not permitted`, including the previously approved escalation; supported cloud-browser access to the local application was denied with `ERR_BLOCKED_BY_CLIENT`. The integration owner verified no supported preview route. This review did not retry those denied routes or alter flags, security or network settings to evade them.

**Still required before claiming browser/product acceptance:** run the shipped Playwright journey on an authorized Linux environment where Chromium can start; inspect its real desktop/mobile screenshots, rendering, downloads, page errors and interaction outcomes. A DOM pass or syntax-valid browser script cannot close that gate. Real-provider budgeted evaluation and the deferred platform/distribution qualifications require their own evidence.

The frozen-source monitor contained 37 entries: all files under `src`, `public`, `test`, `fixtures`, then CLI, installer, launcher, root package and three locks. Its SHA256 list digest was `02c8b08817e723804faa1abab4fb1e0350772032a840cf63a21758a1465d14fa`; every entry matched at the end. Key reviewed source hashes:

| File | SHA256 |
|---|---|
| `src/server.mjs` | `a8797276e7fdc817e2c86ec9fa1f12f56b4531ff1d1134e02941efbda935f1e5` |
| `src/model.mjs` | `9c69fcdf0fbc2908a743f4b5cb6871e5cd847de8b9761eb7ec663a131326e580` |
| `src/store.mjs` | `fca1c10b56b698bc3f989d159a3903f78472102dde22b0d5f7ef625799c79157` |
| `src/host.mjs` | `627967849a3a733b3a7d58e8398ea4a6eb0f2eae2d95b09a62e839d7e8098498` |
| `src/backup.mjs` | `2317032fd0dd091f220f1c91ee749b6388f79c0ccd795f14e60522ddd6329ca8` |
| `public/app.js` | `8376ca518bf7b6e2a229f303402442619295d5c0a203dcd630c1ef1c2313632f` |

Subsequent source changes require affected checks and independent review to be repeated. Packaging/manifest updates alone do not change the code verdict, provided the packaged source matches this candidate and preserves all failed reviews and validation limits.
