# Normalized content admission and consumers

The 080b9dd full review reproduced a normal 5000-entry source with 40,005 nodes that normalized to 105,029 nodes. It was admitted but rejected by world creation and backup. The new policy validates the normalized result, rather than assuming a valid source implies a usable card. No raw fields, lorebook entries or resources are dropped to pass a budget.

| Stage | Contract | Shared implementation |
|---|---|---|
| Source JSON / PNG metadata / module JSON | 8 MiB, depth64,100k nodes; existing format limits | parseJson default IMPORT_LIMITS |
| Original package and backup file | 64 MiB | STORAGE_LIMITS |
| Normalized card | 5 MiB UTF-8 serialized JSON, depth32,250k nodes,1MiB characters per string,20000 elements per array,name512 characters; existing finite-number/plain-data rules | NORMALIZED_CARD_LIMITS plus initialState's common card validation |
| Native initial world configuration | Existing characters/variables/schedules field, scalar and operation constraints | initialState, before admission as well as world creation |
| Import preview and registration | Same normalized card checks, report JSON readability, then current128MiB/2000-file closure budget | prepareCard / checkImportBudget invoke initialState; registration repeats under importer lock |
| Stored card reads | Normalized parse limits plus the same world-consumption validation | parseCardMetadata invokes parseJson with NORMALIZED_CARD_LIMITS and initialState |
| Backup and restore card metadata | The identical parseCardMetadata; exact original re-import and closure comparison remain | backup JSON helper routes card.json through parseCardMetadata |
| Migration report |8MiB/depth64/100k nodes; not a world card | Existing parseJson default; checked before admission and on read |
| Generic world operations and other JSON values | Existing100k-node/depth32 limits | jsonValue defaults, unchanged |

250k is a finite normalized-card allowance of2.5 times the source node budget. It accommodates preserved raw data alongside mapped values and generated metadata, while the5MiB card ceiling remains independently enforced. It is **not** a proof that every100k-node source expands by at most2.5: every actual normalized output is checked, and larger expansions are refused before ready/accept. The budget applies to all structures, not a5000-entry exception. Exact250000/250001-node and5MiB/+1-byte tests, plus depth/string/array/name boundaries, keep admission and consumers aligned. Existing cards that satisfied the prior world-consumption contract remain within this policy; already unusable/corrupt records are never silently altered or erased.

Over-budget or invalid-native-state sources fail before preview acceptance and leave existing registered cards unchanged. This slice does not add an archive-only success mode. Source depth64 is a format-reading bound; it is not a promise that a normalized depth>32 card can run. Rejection reports the validation failure and requires a smaller/compatible source.

Three normal structures pass actual binary HTTP upload→ready→accept→world→complete backup→new-directory restore→server reopen: the full5000-entry source, nested future metadata, and Unicode plus a10000-element ordinary array. Original bytes survive each restore. Existing42/60MiB resource behavior remains covered separately; metadata/node budgets do not shrink binary media admission.

## Failure ownership

Upload reception records its primary write/sync/close error and terminal state before best-effort close/cleanup. A later cleanup error becomes cleanupWarning and never replaces the primary error; close failures have a separate closeWarning. Cancel, close and startup retry cleanup. History eviction also retries cleanup and retains a record if cleanup is incomplete. The50-record cap includes retained cleanup responsibilities; new jobs are refused if unresolved cleanup prevents making room. Startup clears a resolved cleanup warning. The UI offers retry for terminal cleanup warnings.

When restart corrects an old publication failure to completed, the current error field is cleared and the separate durability warning remains. Completed never means an injected fsync failure proved physical power-loss durability.

Independent reviews for080b9dd are preserved; this new candidate requires two new reviews. Original Android, devices, real browser decoding/visuals, representative licensed ecosystem cards and model-quality/cost gates remain open.

### Worker failures use the same failure ownership

Receive errors, worker parser/timeout failures, and errors saving a ready result now use the same small failJob path. An existing primary error is preserved; closeWarning, cleanupWarning and persistenceWarning are secondary diagnostics. persistenceWarning records a previous failed journal write; cancel/close retries persistence. No implementation can promise the latest error survived a crash while every journal write is failing; the in-process result remains accurate and startup still reconciles existing records. Tests explicitly restore journal writes before asserting exact primary-error persistence across reopen.

### Completion is separate from terminal status

A visible failed/cancelled/completed status can precede the final asynchronous journal write. Terminal close, cancel and history reclamation now await the existing upload/worker/journal completion; close/history also join an already-running cancellation. Cancel's own internal wait excludes itself. Repeated close returns the same completion promise, and new cancellation is refused once shutdown starts. Rejected receive promises already have primary errors recorded; rejected finalization promises are retained as persistence diagnostics. This closes the e327359 CI shutdown race; it does not change the normalized-content or backup limits.
