import test from "node:test";
import assert from "node:assert/strict";
import { queueOwnedWork } from "../src/queued-work.mjs";
const next = () => new Promise((resolve) => setImmediate(resolve));
for (const mode of ["turn", "retry"])
  test(
    "normal " + mode + " work is owned from queueing through completion",
    async () => {
      const jobs = new Set();
      let started = 0,
        finished = false;
      const work = queueOwnedWork(jobs, {
        canStart: () => true,
        start: async () => {
          started++;
          await next();
          finished = true;
          return mode;
        },
        cancel: () => assert.fail("normal work cancelled"),
      });
      assert.equal(jobs.has(work), true);
      assert.equal(started, 0);
      assert.equal(await work, mode);
      assert.equal(started, 1);
      assert.equal(finished, true);
      assert.equal(jobs.size, 0);
    },
  );
test("normal closing drains queued cancellation before releasing its resource", async () => {
  const jobs = new Set();
  let closing = false,
    released = false,
    starts = 0,
    saved = 0;
  const store = {
    save() {
      assert.equal(released, false);
      saved++;
    },
  };
  const work = queueOwnedWork(jobs, {
    canStart: () => !closing,
    start: () => {
      starts++;
      store.save();
    },
    cancel: () => store.save(),
  });
  closing = true;
  await Promise.allSettled([...jobs]);
  released = true;
  await next();
  assert.equal(starts, 0);
  assert.equal(saved, 1);
  assert.equal(jobs.size, 0);
  await work;
});
test("already-cancelled work does not invoke its start callback", async () => {
  const jobs = new Set(),
    controller = new AbortController();
  controller.abort();
  let starts = 0,
    cancels = 0;
  await queueOwnedWork(jobs, {
    canStart: () => !controller.signal.aborted,
    start: () => starts++,
    cancel: () => cancels++,
  });
  assert.equal(starts, 0);
  assert.equal(cancels, 1);
  assert.equal(jobs.size, 0);
});
test("rejected deferred work settles and leaves no orphan job", async () => {
  const jobs = new Set();
  const work = queueOwnedWork(jobs, {
    canStart: () => true,
    start: () => {
      throw new Error("ordinary task failure");
    },
    cancel: () => {},
  });
  await assert.rejects(work, /ordinary task failure/);
  assert.equal(jobs.size, 0);
});

test("cancel outcome still notifies when local persistence rejects and remains traceable", async () => {
  const { cancelQueuedRun } = await import("../src/queued-work.mjs");
  const run = { status: "accepted" },
    events = [];
  const outcome = await cancelQueuedRun(run, {
    save: async () => {
      throw Object.assign(Error("local store unavailable"), { code: "EIO" });
    },
    notify: (value) => events.push(value),
  });
  assert.equal(run.status, "cancelled");
  assert.equal(outcome.persisted, false);
  assert.equal(outcome.persistenceWarning.storageCode, "EIO");
  assert.deepEqual(events, [outcome]);
  assert.equal(run.persistenceWarning, outcome.persistenceWarning);
  const recovered = await cancelQueuedRun(run, {
    save: () => {},
    notify: (value) => events.push(value),
  });
  assert.equal(recovered.persisted, true);
  assert.equal(run.persistenceWarning, undefined);
  assert.equal(events.length, 2);
});
test("queued cancelled work reports its local persistence warning before ownership is released", async () => {
  const { cancelQueuedRun } = await import("../src/queued-work.mjs");
  const jobs = new Set(),
    run = { status: "accepted" },
    events = [];
  const work = queueOwnedWork(jobs, {
    canStart: () => false,
    start: () => assert.fail("cancelled task started"),
    cancel: () =>
      cancelQueuedRun(run, {
        save: () => {
          throw Object.assign(Error("write unavailable"), { code: "EIO" });
        },
        notify: (value) => {
          assert.equal(jobs.size, 1);
          events.push(value);
        },
      }),
  });
  const outcome = await work;
  assert.equal(outcome.persisted, false);
  assert.equal(events.length, 1);
  assert.equal(jobs.size, 0);
  assert.ok(run.persistenceWarning);
});
test("notification rejection remains an observable function result", async () => {
  const { cancelQueuedRun } = await import("../src/queued-work.mjs");
  const run = { status: "accepted" };
  await assert.rejects(
    cancelQueuedRun(run, {
      save: () => {},
      notify: async () => {
        throw Error("notification unavailable");
      },
    }),
    /notification unavailable/,
  );
  assert.equal(run.status, "cancelled");
  assert.equal(run.persistenceWarning, undefined);
});
