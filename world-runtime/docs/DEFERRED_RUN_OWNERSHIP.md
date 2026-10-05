# Deferred run ownership

The full review of bd9a050 was interrupted by a platform safety check before completion. It is not a PASS. The coordinating review record reported a focused PASS, but there is no completed full-review approval for that source. The blocked work and new dynamic reproduction scripts were not retried or executed for this follow-up.

This change is defensive lifecycle maintenance. Both ordinary turn generation and saved-draft retry now register their deferred completion Promise in the existing jobs set at queue time. The deferred callback checks shutdown/cancellation before starting. Cancelled starts save their cancelled state while the existing completion boundary still owns the resources; they do not invoke model/settlement startup. Successful and rejected work both settle and remove their ownership entry. Launch cleanup now attaches both fulfillment and rejection continuations rather than leaving an unobserved derived finally Promise.

queueOwnedWork is a small internal helper; it does not introduce a new runtime or state store. Existing handler/background-work shutdown draining owns it just like other work. Function-level contracts check normal turn/retry startup, cancellation during normal closing before resource release, already-cancelled work, and ordinary task rejection. They do not contain network-trigger or exploitation procedures. Existing regular functional test gates remain in place.

Local validation:212unit/10actual HTTP+DOM passed. Real browser/native/device/ecosystem/model-quality gates remain open. The new candidate requires ordinary independent code-quality and functional review; neither local tests nor the interrupted prior review authorize publishing it. Remote branches are unchanged by this follow-up.
