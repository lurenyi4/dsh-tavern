# Independent focused history-warning review

Date: 2026-10-05 UTC
Repository: dsh-tavern-recovered/Story-Runtime-Linux-0.1.0
Branch: feat/local-media-imports
Target: b7a25cdb5e5343eefa60fd5a706c9c146b2d34c7
Parent: e8a24028145dea3de4c71ab7503726321a2227ab

## Verdict: PASS for this narrow UI repair

No actionable correctness or maintainability finding in the production delta. The prior P2 (snapshot cancellation persistence warning missing after reopening the world) is closed for the supplied queued-start warning contract. This is an independent focused review, not a full product/release acceptance or publication approval.

## Independent evidence

- Original history-warning assertion against parent source: 1 failed, exit 1 (`original-red.log`). Against target source: 1 passed, exit 0 (`original-green.log`). The same original history test body/assertion is used; an environment-selectable source and optional new formatter dependency were added to the external harness. The old SSE exact-string expectation is deliberately not selected because the intended new text now preserves cancellation context alongside the warning.
- Target `world-runtime/test/run-outcome-dom.test.mjs`: 5 passed, exit 0 (`five-contracts.log`). Covers warning-bearing SSE, snapshot history, loadWorld away/back with warning and without warning (no terminal SSE reconnect), and normally persisted cancellation SSE.
- Independent additional DOM/function checks: 3 passed, exit 0 (`independent-dom.log`, `independent-dom.test.mjs`). Uses the actual production `el` declaration to verify literal diagnostic/draft text; checks failed/interrupted/draft history retains prior diagnostics and drafts; verifies SSE/history formatter agreement and stale-stream isolation.
- `git diff --check`: exit 0. Repository worktree remained clean.

## Static review

Only production change is in `world-runtime/public/app.js`. `runStatusMessage` is a small pure formatting helper shared by live cancellation and history. It does not create another state store, retry layer, or persistence policy. History continues filtering and limiting exactly the prior four relevant states, and continues trusting `canRetrySettlement` for retry eligibility. The new summary makes the supplied unresolved warning visible without expanding details. The detail message retains cancellation/unchanged-world context, distinct run error, persistence warning, and retained draft.

Production `el` sets `textContent`, and `announce` also sets `textContent`; there is no new HTML interpretation. `finishRun(outcome.message, outcome.warning)` matches the actual `(message, error = false)` signature. No warning produces boolean false; a supplied warning produces true. The cancelled SSE handler explicitly sets status to cancelled after spreading its event payload, consistent with the event type. `loadWorld` still subscribes only to accepted/generating/draft runs, so the terminal history warning is correctly self-contained and needs no reconnect. Existing current-run identity gating is retained.

This meets the narrow documented spec and KISS goal with one shared helper rather than parallel message construction. No production source, index, ADR, remote branch, or existing review record was edited.

## Limits

The 220 unit / 10 HTTP+DOM maker results are background only; this review independently reran the targeted five contracts, original red/green assertion, and three additional pure DOM/function checks. No new network or storage fault experiment was created or run. The previously interrupted full review remains incomplete and is not converted into PASS. The old already-running cancellation catch's adjacent persistence-warning limitation is unchanged and not claimed resolved. These fixture-level DOM results do not claim real-browser visual behavior, induced filesystem failure, hardware persistence, multi-platform/native acceptance, or full original Tavern acceptance. No push, Codex CLI, or new cloud task was performed.
