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
