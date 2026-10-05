# Linux WorldMode E2E work log

## Scope and environment

- Linux, Node v24.19.0, Playwright 1.58.2, Chromium `/usr/bin/chromium`
- Real loopback HTTP server, real SQLite data directories, pinned DSH 0.1.5-rc.2 persistence
- Fresh temporary data directories; all model environment variables explicitly absent; deterministic local demo only; no paid or remote model requests
- Test owner edits only `test/e2e*.mjs`, this log and `docs/e2e-evidence/`

## 2026-10-04 first integration milestone

Command: `node --test world-runtime/test/e2e-api.mjs`

Result: 3 passing integration tests, approximately 4.6 seconds

Covered against real server:

1. ST JSON, ST PNG and CharX imports, safe resource HTTP serving, malformed JSON rejected without changing current world
2. Repeated exact run submission creates exactly one scene; changed payload with same run rejected
3. Demo turn commits narrative and location together; partial SSE cancellation preserves prior formal scenes/state and keeps draft
4. Author variables, inventory, multiple directed relations, public/private facts, beliefs and goals; reader response excludes NPC private sentinel
5. Bounded manual schedule advance; due NPC state changes without new chat or model call; repeated exhausted advance creates no fake scene
6. Historical fork starts with exact ancestor state/history and remains isolated from original branch
7. DSH on-disk message identities and delivered receipts; simulated lost receipt after durable DSH write is replayed on restart without duplicate message
8. Actual downloadable backup file restored to a new directory; story, state, assets/cards, branches and DSH projection survive two new server starts
9. Persisted pre-commit draft is marked interrupted after restart, then explicit settlement retry commits it once with no new model call
10. Real autonomous timer consumes only the one-event budget, stops, and leaves two due schedules pending; player-involving schedule pauses without choosing for player

These checks are HTTP/persistence integration tests. Browser UI testing is tracked separately and is not yet passed.

## Real browser execution blocker (2026-10-04 16:45 UTC)

- Full Playwright user-journey script is `test/e2e-browser.mjs`, including file imports, author forms, schedules, branch-switch-during-SSE, backup download/restore and desktop/mobile screenshot assertions
- Local `/usr/bin/chromium` launch failed before loading the app: `process_singleton_posix.cc:297 socket() failed: Operation not permitted`. The approved execution escalation had the same result
- Supported cloud Chrome/CUA selection worked, but navigation to the live local test server `http://127.0.0.1:44697` was blocked with `net::ERR_BLOCKED_BY_CLIENT`
- No security settings, network route, URL alternatives or access controls were changed to work around those restrictions
- Evidence: `e2e-evidence/browser-blocked.log`
- Therefore real Chromium flows, visual layout, mobile rendering and screenshots are **NOT PASSED / NOT EXECUTED**. Syntax-valid Playwright tests alone do not establish that gate

## Supplemental DOM integration (not a replacement browser gate)

`test/e2e-dom.mjs` executes the actual served `app.js` in jsdom with real loopback HTTP fetch, real SSE streams, SQLite and DSH. Only missing browser infrastructure is supplied: dialog open/close and a fetch-backed EventSource bridge. No world data, model results or UI API endpoints are mocked. This can find event handling and state integration failures; it cannot establish Chromium behavior or visual correctness.

First run caught a malformed second model `<option>` in `index.html`. The actual HTML parser omitted the real-model option; boot tried to set `null.disabled` and stopped initial list loading. Reported to integrator for correction. QA does not edit app sources.

## Final verified integration result (2026-10-04 16:58 UTC)

Command:

`node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs`

Result: **4/4 pass**, approximately 6 seconds, against the clean installed `world-runtime/.runtime`. Explicit runtime override and development fallback are supported. Evidence is `e2e-evidence/integration-last.log` plus structured `e2e-evidence/dom-report.json`.

The malformed model-option markup was fixed by the integrator and the DOM boot was revalidated. The final actual-app DOM scenario additionally covers:

- Native imported declarative action button atomically increments the persisted trust variable
- Creating a second world from an imported card using the real creation dialog, then navigating back
- Author-operation preview causes no persisted change; each explicit submission is rendered only after the server commit
- Actual timer-driven autonomous NPC change and budget stop; manual schedule advance with no new user message or model attempt
- Fork from a historical scene and change branch while a real SSE turn remains in progress; late SSE does not overwrite the selected branch UI
- Fresh DOM reload restores persisted branch/story
- Full server restart marks a persisted pre-commit draft interrupted; the actual “仅重试结算 · 不调用模型” button commits it without a new model attempt
- No recorded DOM JavaScript/SSE errors

The server's newer reader-privacy semantics are respected: NPC true positions, private facts and NPC schedules are asserted through explicit author view; reader view remains filtered.

### Browser/visual gate remains open

The final Playwright script passes `node --check world-runtime/test/e2e-browser.mjs` and includes all requested journeys, backup download/new-directory restore, restart/draft recovery, page-console assertions, source trace capture, and 1440px/390px screenshots. Its launch fails in this executor before any page is loaded. No actual Chromium screenshots were generated or visually inspected; desktop/mobile visual acceptance is unverified. The DOM pass must not be relabeled as browser E2E or product release approval.

On a Linux environment where installed Chromium can launch, run:

`STORY_CHROMIUM_PATH=/usr/bin/chromium node --test world-runtime/test/e2e-browser.mjs`

The script uses fresh temporary application data, explicit empty model configuration and local-only page requests. It cleans up server/browser/data even if browser launch fails. Browser evidence is written under `world-runtime/docs/e2e-evidence` only when a real browser can run.

## Release UI regressions R02 / R04 (2026-10-04 17:22 UTC)

Two additional tests in `test/e2e-dom.mjs` run the served app code against the real HTTP/SSE/SQLite/DSH backend. They remain supplemental DOM tests, not Chromium or visual acceptance.

- **R02 live-run reload:** A slow real demo run starts in a fork. The first DOM is closed while the server keeps generating. A newer decoy world is created and the server's active branch changes; a second DOM receives the first DOM's actual same-origin persisted selection. It restores the correct world/fork, reconnects once to the existing SSE token, receives continuing draft text, disables sending, and cancels through the resumed UI. The original run and attempt identities remain unchanged; attempt count is one, formal scenes/outbox remain zero, and authoritative state is unchanged
- **R04 view-response ordering:** The test lets a genuine author HTTP response arrive and buffers its delivery to the app. The user toggles back to player; the newer player response renders before the old author response is released. The old response never restores the private sentinel. A second case starts from visible author data and holds the real player response: private fields are cleared immediately, and changing world/plans/people tabs while pending cannot reveal cached author data. A MutationObserver records zero transient private-data appearances with the author checkbox off
- The response gates delay real responses without replacing their bytes or supplying synthetic API state. The first case verifies the held response really contains the author-only fixture; the second verifies the held player response is filtered

Commands:

`node --test --test-name-pattern='release R0' world-runtime/test/e2e-dom.mjs`

`node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs`

Final result: **2/2 focused and 6/6 complete API + DOM tests passed**. The final complete run took approximately 7.55 seconds. SHA-256 sums of the eight monitored public/core/test files matched before and after that run, and both test/comparison exit codes were zero.

An intermediate complete run was 5/6: the previous API durable-draft test found `committed` delivered before all projection receipts were delivered. The integrator confirmed the concurrent R01 change temporarily marked the live run committed too early, then restored a separate `projecting` phase. The original assertion was retained and augmented with projection diagnostics; the fixed complete suite passed twice. The intermediate failure is preserved rather than removed.

Evidence:

- `e2e-evidence/release-ui-regressions.log`
- `e2e-evidence/release-ui-regressions-full.log`
- `e2e-evidence/release-ui-regressions-r02.json`
- `e2e-evidence/release-ui-regressions-r04.json`
- `e2e-evidence/release-ui-regressions-first-full-failure.log`
- `e2e-evidence/release-ui-regressions-retry-diagnostic.log`
- `e2e-evidence/release-ui-regressions-sources-before.sha256`
- `e2e-evidence/release-ui-regressions-sources-after.sha256`

No app sources or security settings were changed by QA, no browser workaround was retried, and all test servers and their dedicated temporary data were cleaned up. The real Chromium/desktop/mobile visual gate remains blocked as previously recorded.
