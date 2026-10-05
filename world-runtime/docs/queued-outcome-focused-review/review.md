# queued-work focused code/function review

- Candidate: `2a9d6ad1ae869fbb81b18ba151daa58b19912b58`
- Parent: `bd9a050622d1ecc5610615a2e53896826ea6e2c2`
- Checkout: `dsh-tavern-recovered/Story-Runtime-Linux-0.1.0`, `feat/local-media-imports`
- Reviewer scope: ordinary defensive code quality and normal function lifecycle contracts only; 2026-10-05 UTC

## Conclusion

No blocking defect found in the reviewed queued-work ownership change under its ordinary lifecycle contract. Focused code/function review is satisfactory within this scope. This is **not a completed full review**, security clearance, release approval, or publication approval. The prior full review was interrupted by platform safety checking and remains incomplete, not PASS.

## Evidence and line-level reasoning

1. `world-runtime/src/queued-work.mjs:3-12`: Promise creation, registration in the existing Set, and both completion handlers execute synchronously before dispatch. A queued callback therefore cannot be absent from the ownership set merely because it has not started. No additional scheduler, persistent state, dependency, or timer policy was introduced.
2. `queued-work.mjs:13-16`: exactly one of `start` and `cancel` is evaluated. `await` covers both synchronous return values and asynchronous completion; errors from the predicate, callback invocation, or awaited rejection settle the original Promise by rejection. The function-level rejection case verifies a synchronous start error, not all those error variants.
3. `queued-work.mjs:8-11,14`: removal occurs only after callback completion/rejection. The returned Promise retains its result/error even though a separate rejection cleanup handler is attached. Native `Set.delete` is idempotent and does not access disposed resources. Its derived continuation resolves normally under the actual native Set contract.
4. `world-runtime/src/server.mjs:439-456,708,861`: ordinary turn and retry call sites both use the helper. `retry` is forwarded unchanged to `launch`; the guard checks both shutdown and the run's abort signal immediately before startup. Cancel bookkeeping saves and notifies while the wrapper Promise is still pending and owned.
5. `server.mjs:239-438`: model generation, saved-draft settlement, cancellation checks before commit, and normal business error handling are unchanged. The launch Promise remains independently registered. The new wrapper adopts its completion; holding both Promises does not invoke work twice. Launch cleanup and wrapper cleanup may both delete the live entry, but those Map deletions are idempotent and ordinary Promise reaction ordering executes the launch cleanup before wrapper completion.
6. `server.mjs:429-436,449-455`: replacing ignored `finally` with two `then` handlers avoids an otherwise rejected derived-finally Promise. Actual cleanup is restricted to native collection removal and terminal-state checks. This does not claim arbitrary throwing custom collection implementations are supported.
7. `server.mjs:1127-1165`: shutdown stops admission, waits admitted handlers, repeatedly joins current jobs, and only then closes projection/store/lock. An admitted handler that queues after the stop flag is set still registers work before returning; the deferred guard selects cancellation. The normal-path ordering provides no identified resource-use-after-disposal gap in this change. This is static reasoning plus a function-level resource stub test, not an independent network timing reproduction.
8. `world-runtime/test/queued-work.test.mjs:5-29`: the two mode tests exercise the same helper with different labels/results. They demonstrate normal helper startup, ownership, result forwarding and cleanup; they do not themselves call actual server turn/retry routes. Ordinary real server behavior is partly covered by the existing unit suite, which was rerun unchanged.

## Independently rerun checks

- `node --test world-runtime/test/queued-work.test.mjs`: **5 passed, 0 failed**. Output: `function-tests.txt` alongside this report.
- `npm run test:world` (existing `node --test world-runtime/test/*.test.mjs`): **212 passed, 0 failed, 0 skipped**, approximately 8.1 seconds. Output: `unit-tests.txt` alongside this report.
- `git diff --check bd9a050..HEAD`: clean.
- Checkout status before/after: clean. No source, staged files, ADR, Git commit or remote state changed.

## Limitations / non-blocking follow-up observations

- The helper tests do not directly cover asynchronous callback rejection, throwing `canStart`, or a rejecting/asynchronous cancellation callback. These are statically covered by the shared try/await/catch, but additional ordinary function tests would make the claimed error contract more explicit.
- Rejection observation is distinct from error reporting. `server.mjs:443-446` can reject if cancellation persistence fails. The original work Promise carries that error, but current route callers ignore the returned Promise and shutdown uses `allSettled` without promoting job failures to shutdown errors (`1155-1157`). Thus this review verifies ownership cleanup and promise settlement, **not** a guarantee that every cancellation persistence error becomes a visible diagnostic or a failed close. No fault-injection experiment was added or run.
- The separately recorded 10 HTTP+DOM gate results were read as candidate evidence, not independently rerun in this review.
- No newly introduced or previously blocked dynamic reproduction script was read or executed. No network-fault or exploitation procedure was created, and no blocked review was retried.
- Real browser/native/device/ecosystem/model-quality validation, full prior lifecycle audit, remote CI and release gates remain outside this focused result. Existing known importer cleanup diagnostic limitation is unchanged and was not relabeled fixed.
