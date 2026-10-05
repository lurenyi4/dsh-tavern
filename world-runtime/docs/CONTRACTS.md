# Shared contracts v1 (single owner: integration coordinator)

Plain ESM JavaScript, Node24.19.0. No extra framework. All persistent world data in SQLite; assets immutable content-addressed files. Code lives `world-runtime/src`, tests `world-runtime/test`, web `world-runtime/public` inside existing fixed Tavern checkout.

## Core module src/store.mjs (storage worker)
Export `WorldStore` with `constructor(dataDir)`, `close()` and following synchronous methods unless stated async. IDs generated internally via UUID, string. Safe exceptions `{code,message}`. No network/model inside store. Calls must require world/branch; unknown IDs reject.
- `listWorlds()` -> `[{id,name,activeBranchId,createdAt,updatedAt}]`
- `createWorld({name,card})` -> snapshot. card is normalized importer object, may be demo fallback. Save exact card in world metadata. Initialize primary character `card-main`, player `player`; optional `card.extensions.story_runtime.characters` synthetic extras. Do not turn card backstory into already-happened events.
- `snapshot(worldId,branchId?)` -> `{world:{id,name,activeBranchId,card,createdAt},branch:{id,name,head,sourceRevision,parentBranchId,forkCommitId},state:{time,characters:[{id,name,description,location}],relations:[{id,from,to,type,detail,sourceCommitId}],facts:[{id,key,value,visibility,holderId,locked,sourceCommitId}],beliefs:[{holderId,subjectId,key,value,sourceCommitId}],goals:[{id,entityId,text,status,visibility}],inventory:[{entityId,item,quantity}],variables:{},schedules:[{id,at,entityId,label,operations,precondition,status}],plotThreads:[{id,label,status,sourceCommitId}]},scenes:[{id,branchId,seq,runId,userText,narrative,operations,source,createdAt,inherited}],branches:[{id,name,head}],outbox:[{commitId,status}],usage:[{runId,attemptId,mode,inputTokens,cachedInputTokens,outputTokens,status}]}`. Exact schema stable; initial empty arrays/objects. Scenes ordered full ancestor history through fork plus own. `sourceCommitId` auto server/store metadata, not model proof.
- `commit({worldId,branchId,runId,expectedHead,sourceRevision,userText,narrative,operations,source='turn',usage=null,author=false})` -> `{commitId,seq,reused,snapshot}`. Atomically body+validated state+event provenance+outbox. Same run same payload stable; changed payload conflict even if head advanced. Reject stale head/source; lock override only trusted `author` boolean, not operation field. Empty operations allowed narrative, no fabricated state event. Immutable after-state per commit supports fork. Snapshot consistent read txn.
- `markProjected(worldId,branchId,commitId)` -> delivered; trusted backend only, explicit scope.
- `fork({worldId,branchId,commitId,name})` -> snapshot of NEW branch active; commitId null means genesis. Only from own/inherited reachable point; no sibling future.
- `selectBranch(worldId,branchId)` -> snapshot.
- `advance({worldId,branchId,to,maxEvents=10})` -> `{snapshot,executed,cancelled}`. Due schedules sorted time/id. Validate precondition against current state; invalidated events cancelled not forced. No model. At mostmaxEvents. Atomic event commits with deterministic schedule runID avoid duplicate. No schedule+no new time? may update time via explicit manual event only, but no fake NPC events.
- `recordAttempt({...})` persist usage/errors separately, never count unknown tokens as zero. Source call attempts idempotent attemptId.
- `backup(path)` async official SQLite online backup to NEW file, no overwrite.

### Operations allowlist (single semantics, reject unknown fields/kinds)
`{op:'set_location',entityId,value}`
`{op:'add_relation',from,to,type,detail?}` (multivalue directed)
`{op:'set_fact',id?,key,value,visibility?:'public'|'private',holderId?,locked?:boolean}`
`{op:'set_belief',holderId,subjectId,key,value}`
`{op:'set_goal',id?,entityId,text,status?:'active'|'paused'|'achieved'|'abandoned',visibility?}`
`{op:'change_inventory',entityId,item,amount}` (safe integer, reject negative resulting quantity)
`{op:'set_variable',key,value}` (bounded scalar string/number/boolean)
`{op:'set_plot_thread',id?,label,status:'planned'|'planted'|'partially_resolved'|'resolved'|'abandoned'}`
`{op:'schedule',id?,at,entityId,label,operations,precondition?}`; precondition restricted `{entityId,location}` or `{variable,equals}`. Scheduled operations cannot recursively schedule. At≥world time, stable internal ID.
`{op:'cancel_schedule',id}`
Do not accept arbitrary SQL, scripts, network/tool commands, cross-scope IDs or dangerous property keys.

## Import module src/importer.mjs (import worker)
Export async `importCard({filename,bytes,dataDir})` -> `{card,report}` persisted card metadata under dataDir/cards and raw source+assets hashes. normalized card `{id,name,description,personality,scenario,firstMessage,alternateGreetings:[],exampleDialogue,systemPrompt,postHistoryInstructions,tags:[],creator,worldbook:[],assets:[{id,name,mime,path,sha256,size}],extensions:{},original:{name,sha256,path}}`. report `[{field,status:'mapped'|'preserved'|'unsupported'|'blocked'|'missing',message}]`. Helpers `listCards(dataDir)`, `readCard(dataDir,id)`, `assetPath(dataDir,assetId)` safe; export originals via path. Neither import nor rendering executes scripts or remote fetch. ST JSON/PNG metadata, Risu CharX resources/module preservation required; unsupported module behaviors accurately reported. Unknown fields preserved in original and extensions. Bound sizes, zip count/ratio/depth/path, reject symlinks/encrypted entries, HTML/SVG executable display blocked. Output only safe raster/audio assets served allowlisted mime. Child owns modules import*.mjs and test/import*.mjs, fixtures except demo-card.json owned parent.

## HTTP interface (server integrator owns)
JSON responses unless SSE/export. Errors status4xx/5xx `{error:{code,message}}`; no credential echoes.
GET /api/config -> `{demo:true,openaiConfigured,model,endpoint}` (no secrets)
GET /api/cards -> `{cards}`; POST /api/import `{filename,base64}` -> `{card,report}`
GET /api/worlds -> `{worlds}`; POST /api/worlds `{name,cardId?}` -> snapshot
GET /api/worlds/:id?branchId=...&view=player|author -> filtered snapshot (`author` explicit toggle)
POST /api/worlds/:id/turn `{branchId,message,runId,mode:'demo'|'openai'}` ->202 `{runId}`
GET /api/runs/:runId/events ->SSE events `delta` data `{text}`, `committed` `{snapshot}`, `error` `{code,message}`, `cancelled` `{}`; initial/replayed run full current draft in `draft` `{text}`. EventSource closes on terminal. Run cancellation POST /api/runs/:runId/cancel `{}`. Same runID reuse cannot duplicate turn or overwrite different payload.
POST /api/worlds/:id/actions `{branchId,runId,narrative,operations}` -> snapshot, explicit local author's declarative action; any accepted state change formalcommit.
POST /api/worlds/:id/advance `{branchId,to,maxEvents}` -> `{snapshot,executed,cancelled}`
POST /api/worlds/:id/fork `{branchId,commitId,name}` -> snapshot
POST /api/worlds/:id/select-branch `{branchId}` -> snapshot
POST /api/worlds/:id/autonomy `{branchId,enabled,maxEvents?,durationSeconds?}` -> `{enabled,...}`; default off, stops on budget/foreground, restart off, no silent catchup.
GET /api/worlds/:id/export?branchId=... -> plain text/JSON readable story (player view default)
GET /api/backup -> zip (consistent SQLite+immutable assets+manifest, no credentials/host raw log). Restore documented CLI to new data dir.
GET /assets/:hash ->safe MIME immutable data content, no card filename path trust.
GET /api/health -> `{ok:true,version}`.

## UI (web worker owns public only)
Chinese polished responsive local story app, clearly new Linux WorldMode with demo/real model status. Real data only from API; no fake state in client. Left worlds/cards/import, center narrative composer with draft+cancel/commit states, right tabs characters/relations/facts/events/inventory/goals/schedules/usage. Explicit author toggle, branch selection/fork from scene, backup/export, bounded autonomy/pause, manual world time advance. Can configure declarative actions via form/buttons, no eval/rawHTML. Demo startup is explicit create sample world button, zero credentials. Display migration report/resources/import failure. Bind once avoid duplicate submits, create stable per-send run UUID, preserve user's input/draft on errors, no stale branch update after navigation. UI can poll snapshots on autonomy interval only while active; stop on page close/nav.

## Final implementation clarifications
- branch.head is UUID|null; sourceRevision UUID; scene.seq numeric. Runs are scoped by (worldId,branchId,runId).
- advance.executed/cancelled are schedule-ID arrays.
- saveRun/getRun/listRuns persist drafts; cancelled/committed are terminal, startup marks unfinished runs interrupted. raw provider JSON is not a public draft.
- resetProjectionReceipts() is trusted restore-only; revise() is an atomic fork-before-target plus replacement commit with rollback on failure.
- increment_variable {key,amount} requires an existing numeric variable, finite bounded amount/result.
- GET /api/backup returns JSON bundle, not ZIP. CLI restore requires a new directory and verifies reference closure.
- POST /api/worlds/:id/card-action accepts {branchId,actionIndex,runId,expectedHead}; actions come from saved card, author:false.
- POST /api/worlds/:id/revise accepts {branchId,commitId,narrative,operations}.
- POST /api/runs/:opaqueToken/retry reuses a structured saved draft; no model call.
- POST /api/worlds/:id/recover-projection retries persistent outbox without regenerating.
- GET /api/cards/:id returns {card,report}; /original downloads exact original.
- POST /api/worlds may accept greetingIndex (0 default, positive alternate).
- Every world-scoped POST requires explicit nonempty branchId.
- Player responses redact original operations, hidden plans, NPC intent; NPC location uses player belief. Author responses contain full audit fields.
- Demo uses real data/host with deterministic sample text, labeled as such; real model path supports SSE and nonstream JSON, never auto-retries paid calls.
