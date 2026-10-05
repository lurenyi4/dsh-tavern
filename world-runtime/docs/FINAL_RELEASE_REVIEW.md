# Linux WorldMode independent release review — as-found run

Review date: **2026-10-04 UTC, 17:04–17:14**

## Decision

**FAIL. Critical: 0; Major: 5; Minor: 2.**

- **Spec: FAIL** — interrupted draft durability, active-run recovery, visibility and opening-context gaps remain in the reviewed candidate
- **Quality: FAIL** — normal refresh and fast author/player switching expose missing recovery/race handling; documented development commands have portability mismatches
- **Actual browser/visual gate: BLOCKED, NOT PASSED**

This is a fresh, complete review after the first backend corrections, not a re-labeling of `BACKEND_REVIEW.md`. It records the **as-found** candidate and independent observations below. The implementation owner began repairs after each finding was reported. Those repairs do not turn this review into a pass; a **new complete review of the finished, frozen candidate is required**. Preserve this failed run when recording the next review.

Linux-first scope is authorized. Other operating systems are deferred and were not used as a reason to fail the Linux code. Equally, a working HTTP service and a DOM integration pass do not establish a finished, visually accepted Linux release.

## Scope and method

Stage 1 revisited every B01–B05/Q01 finding and the scope, authority, privacy, branch, cancellation, lock, import and restore invariants. Stage 2 read the complete implementation and Linux deliverable: all `src/*.mjs`, `public/index.html`, `app.js`, styles and icon; CLI, installer and launcher; package scripts and runtime lock configuration; importer/projector dependencies; all shipped unit/integration/DOM/browser test implementations and fixture contracts.

Requirements and evidence reviewed:

- Root `STORY_RUNTIME_LINUX_README.md`, `AGENTS.md` and package configuration
- `LINUX_SCOPE.md`, `CONTRACTS.md`, `ADR-LINUX.md`, `BACKEND_REVIEW.md`
- `BUILD_BASELINE.json`, `WORK_LOG.md`, E2E, import, storage and backup correction logs
- Original reference plan's confirmed requirements, startup instructions, traceability, invariants, commit/retry, import, actor visibility, branch/revision, context, scheduling and release gates

Baseline: upstream `403df2d1e4080e4846627a58572c6347e3eefc02`, Node **v24.19.0**, npm **11.9.0**, DSH **0.1.5-rc.2**. WorldMode changes are local additions on that baseline, not an upstream release.

All additional checks used reviewer-owned temporary local data and harmless synthetic story strings. Protocol tests used loopback mocks only. The crash test killed only its own disposable child application process. No paid provider, user credential, external publication, Codex CLI, separate cloud task, full Tavern tool profile, security-setting change or denied browser-route retry was used. No product source was changed by this reviewer. The DOM suite automatically refreshed its existing evidence JSON; this report is the only manually authored repository file.

## Independently executed checks

| Check | Result and boundary |
|---|---|
| `node --test world-runtime/test/*.test.mjs` | **99 passed**, 0 failed/skipped, before the R01–R05 repairs |
| `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs` | **4 passed**: API 3, actual-app DOM 1; 0 failed/skipped |
| `npm run check:client` | Exit 0; original Tavern client artifact current |
| `node --check` for WorldMode source, app, CLI, installer and browser test | Exit 0; syntax only |
| `bash -n start-story-runtime-linux.sh` | Exit 0 |
| Upstream official focused runner: host-projection-replay-native, session-stable-prefix, story-ledger, story-timeline | **34 passed**, 0 failed/skipped, with `DSH_BOOT_MODULE` explicitly pointing at installed rc.2 |
| Genuine local SSE → visible draft → application SIGKILL → restart | Exposed R01 |
| Fresh actual app.js DOM while real backend generation remains active | Exposed R02 |
| Local scheduled fact update with distinct public/private holders | Exposed R03 |
| Actual app.js with delayed real author-view HTTP response and intervening player-view intent | Exposed R04 |
| Context compilation with two different selected openings | Exposed R05 |

The first focused upstream-runner invocation without `DSH_BOOT_MODULE` refused because a standalone Tavern install was absent. Its own supported explicit boot-module configuration then passed all 34 tests. This is not evidence that the default full Tavern installation was performed.

The as-found `server.test.mjs` selected the sibling research runtime; API/DOM E2E selected installed `world-runtime/.runtime`. Both were rc.2. The former portability gap is Q02 below.

Green existing suites did not prove the missing cases: their restart scenarios explicitly saved completed structured drafts, and their UI reload happened after generation had finished.

## Major findings

### R01 — Visible streaming drafts are lost on genuine process interruption

**Severity: Major — Spec/Quality**  
**Location:** `src/server.mjs`, `launch`, demo `onDelta`, OpenAI `onDraft`, startup run recovery

As found, callbacks updated only `run.draft` in memory and emitted SSE. `saveRun` happened before generation and after a complete result or a caught error. An abrupt process death bypassed both later paths.

Independent observation:

1. A local SSE mock emitted an incomplete narrative containing `PUBLIC_DRAFT_BEFORE_CRASH` and kept the stream open
2. The real application's run SSE displayed that narrative
3. A separate real snapshot request still returned persisted `draft: ""`
4. The disposable application process was killed with SIGKILL and restarted on the same data directory
5. Restart returned `status: "interrupted"`, `draft: ""`, zero scenes; the usage attempt remained `started` with unknown token counts

No world state was falsely committed, but the already-visible narrative was lost. The existing manually seeded draft-restart tests cannot establish live-stream checkpoint durability.

**Required outcome:** checkpoint safe public narrative during generation before declaring it durably visible; preserve it after real process death, without persisting raw operation JSON or applying a partial result. Reconcile unfinished attempt status on restart while retaining unknown usage. Test a genuine running child process and observed SSE boundary, not only direct `saveRun` injection.

### R02 — Refresh during generation loses the running UI and cancellation controls

**Severity: Major — Spec/Quality**  
**Location:** `public/app.js`, initial boot, `loadWorld`, `renderRuns`, `watchRun`

The initial client state has `active: null`. Loading a snapshot does not attach to its accepted/generating run; `renderRuns` excludes those statuses. No timer refreshes that world unless autonomy is enabled.

Independent actual-app DOM observation while the real HTTP backend was generating:

- Backend run status: `generating`
- EventSource subscriptions created: **0**
- Run bar hidden: **true**
- Draft hidden: **true**
- Send button disabled: **false**
- Run-history text: empty

A normal page refresh therefore removes the visible progress and cancel path. A new send appears available but encounters `WORLD_BUSY`; even later completion has no watcher to refresh the page automatically.

**Required outcome:** discover and reattach to recoverable live runs after reload/selection, show the correct scoped draft and cancel control, and handle terminal or interrupted state without duplicate generation. Keep the existing protection against late results changing a newly selected branch. Add a mid-stream reload test.

### R03 — Scheduled private fact updates still enter public narrative/context

**Severity: Major — Spec**  
**Location:** `src/model.mjs`, `visibleSnapshot` scheduled-scene `observed` selection

B01's raw-operation redaction works, but the new scheduled-result path resolves no-ID fact updates using only a matching public **key**, ignoring the holder. Facts legitimately have the same key with different holders. The reducer preserves the private holder's prior visibility; the presentation path can mistake another holder's public fact for this update.

Independent local fixture:

1. Store a public fact with key `shared-key`, holder null, and a private fact with that key held by `card-main`
2. An NPC schedule updates the private holder's fact by key and holder, omitting visibility
3. Advance the schedule and inspect the player snapshot and compiled messages

Observed: private updated value remained absent from `state.facts`, yet the scheduled scene narrative became `PRIVATE_UPDATED`, and the same string was included in model context.

**Required outcome:** resolve the exact fact and its permitted observation, including holder/ID and inherited visibility. Never promote a private change merely because another public fact shares its key. Use a conservative explicit-public policy where historical observation cannot be established, and test both ID and key/holder cases.

### R04 — A stale author response renders private information in player mode

**Severity: Major — Spec/Quality**  
**Location:** `public/app.js`, `authorToggle`, `refreshWorld`, `loadWorld`

`refreshWorld` returns early while `state.navigating` is true. A second view-toggle intent therefore changes `state.author` without invalidating the first request or requesting the new view. When the first author response arrives, `renderWorld` labels the current mode as player while rendering the old author's snapshot.

Independent actual-app check used a controlled delay on the real author-view HTTP response. From player mode, check author, uncheck it while the author request remains pending, then release that response.

Observed together:

- Author checkbox checked: **false**
- Author notice hidden: **true**
- Private sentinel present in the world panel: **true**

This is a client presentation race; server-side model-context filtering is a separate boundary. It still breaks the explicit player/author product guarantee.

**Required outcome:** every view intent must invalidate incompatible pending work. Match response ticket and requested view before rendering, and promptly remove private content when entering player mode. Test delayed and repeated toggles, including navigation while the view fetch is pending.

### R05 — The displayed/selected opening is absent from model context

**Severity: Major — Spec/Quality**  
**Location:** `src/model.mjs`, `compileContext`; `public/app.js` imported-opening rendering

The UI displays `world.card.firstMessage`, including an explicitly selected alternate greeting. `compileContext` uses other card fields, state and committed scenes but never that selected opening. For a new world there are no committed scenes that could supply it another way.

Independent check compiled the same player's response, “I choose the first option,” for two snapshots differing only in opening: one offered harbor/forest choices and the other placed the player in a library. Neither opening appeared in the messages, and the compiled messages were identical.

The real model thus cannot reliably continue the opening that the user just read or resolve its choices. Alternate greeting selection changes presentation without changing the relevant generation input.

**Required outcome:** include the chosen opening with clear imported/noncanonical provenance and the proper dialogue context, without automatically applying any implied inventory or other state changes. Test captured local-provider requests for default and alternate openings. Also define/render the supported pure template preview surface: displayed opening macros currently remain literal while prompt fields use the template renderer.

## Minor findings

### Q02 — Unit/HTTP test command depends on a sibling research directory

`test/server.test.mjs` defaults to `resolve('../dsh-pinned')`, unlike E2E's installed-runtime resolution. A normal standalone source checkout with `install:world-runtime` completed is not guaranteed to have that unrelated sibling. Align the test default with the shipped runtime and verify the documented command from a clean standalone layout.

### Q03 — Browser executable environment variable differs between docs and code

The reviewed Linux README uses `STORY_CHROMIUM`, but `test/e2e-browser.mjs` reads `STORY_CHROMIUM_PATH`. The example happens to use the script's default path, hiding the mismatch; a user with a different Chromium path would still run the wrong executable. Use one documented name.

## First-backend-finding disposition in this run

| Prior finding | Independent conclusion |
|---|---|
| B01 private operation payloads | Original raw-operation paths corrected; **not fully closed**, new scheduled public-result path fails R03 |
| B02 planned plot exposure | Planned/abandoned state excluded; regression passed |
| B03 normalized draft replay disappears | Plain narrative representation/replay corrected; genuine streaming process death remains R01 |
| B04 incomplete backup accepted | Closure re-derived from original, required registrations/resources checked before publication; expanded negative/roundtrip tests passed |
| B05 implicit active-branch writes | World-scoped POST requires explicit branch before resolving state; original regression passed |
| Q01 raw JSON budget truncation | Structured per-collection budgeting avoids malformed/current-state starvation by long descriptions; regression passed |

## Positive findings and bounded quality conclusions

- This is an actual served local web application using the real backend, not a placeholder page or CLI-only substitute
- SQLite is the one authority. Formal narrative, operations/events, state, matching run completion and outbox share the transaction; failures at three injected stages roll back together
- World/branch checks, immutable history, stale head/source protection, lock enforcement, scoped idempotency and atomic fork/revision are present and exercised. Imported card actions use `author: false`; numeric increments use the same validation and commit route
- The native DSH integration uses the minimal Session/JSONL path and persistent scoped message identities. The independently rerun API case reused durable messages after lost receipts and through backup/restore without generating again
- Import formats preserve original bytes, unsupported module/resource content and unknown fields. Resource parsing is bounded; active formats are not exposed as executable display content. No card-script evaluation or default external resource fetch was found
- Backup validates both per-file hashes and dependency closure, uses official online SQLite backup, excludes model environment credentials and derived host logs, and restores only through a new staged directory
- Bounded schedules revalidate conditions/effects, preserve deterministic identity, perform no model call and stop for player-involving operations. Startup leaves autonomy off
- OpenAI-compatible generation uses one bounded request and no tool capability or automatic paid retry. Unknown usage remains null. Local SSE/JSON tests validate protocol behavior, not real-provider billing or output quality
- Static UI uses text nodes rather than executing card HTML, includes responsive rules, and passes substantial actual-app DOM flows. The race/recovery findings above show why those green flows are not complete product acceptance

## Remaining release gates and next review

The browser blocker is independently documented in `E2E_WORK_LOG.md` and `e2e-evidence/browser-blocked.log`: local Chromium fails before app load at ProcessSingleton socket creation, including the approved escalation; supported cloud browser navigation to the local application was denied. This reviewer did not retry or route around those restrictions.

Accordingly, **real Chromium journeys, rendering, visual polish, mobile viewport behavior, screenshots, browser downloads and real browser-console assertions have not passed**. The Playwright script is present and syntax-valid; DOM work is supplemental and cannot replace this gate.

Real paid-provider billing/cache effects and narrative quality, hardware power-loss durability, Android/macOS/Windows, installer signing and external publication were not qualified. Existing Linux scope correctly defers the other platforms. No blanket security, full legacy-script compatibility or cross-platform release claim is justified here.

The next review must begin after all R01–R05 repairs and the two command/documentation corrections are complete. It should first repeat each missing case, then reread and rerun the complete final Linux candidate, including any new failure paths introduced by recovery changes. Do not convert this as-found FAIL into a PASS based only on implementer reports or focused repair tests.
