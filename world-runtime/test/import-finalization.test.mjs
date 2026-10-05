import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ImportJobs } from "../src/import-jobs.mjs";
for (const action of ["close", "cancel", "history"])
  test(
    "terminal " + action + " awaits the worker journal already in progress",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "import-finalize-")),
        jobs = await ImportJobs.open(dir),
        save = jobs.save.bind(jobs);
      let enter,
        release,
        pending,
        held = false;
      const entered = new Promise((r) => (enter = r)),
        gate = new Promise((r) => (release = r));
      try {
        jobs.save = async (j) => {
          if (j.status === "failed" && !held) {
            held = true;
            enter();
            await gate;
          }
          return save(j);
        };
        const bytes = Buffer.from("{bad"),
          j = await jobs.create({ filename: "bad.json", size: bytes.length });
        await jobs.upload(j.id, Readable.from([bytes]));
        await entered;
        const finalization = jobs.jobs.get(j.id).work;
        if (action === "history")
          for (let i = 0; i < 48; i++) {
            const old = await jobs.create({
              filename: "history.json",
              size: 2,
            });
            await jobs.cancel(old.id);
          }
        let finished = false,
          repeatedFinished = false;
        pending = (
          action === "close"
            ? jobs.close()
            : action === "cancel"
              ? jobs.cancel(j.id)
              : jobs.create({ filename: "new.json", size: 2 })
        ).then(() => {
          finished = true;
        });
        const repeated =
          action === "close"
            ? jobs.close().then(() => (repeatedFinished = true))
            : Promise.resolve();
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(
          finished,
          false,
          "terminal status is not proof that journal finalization ended",
        );
        if (action === "close") assert.equal(repeatedFinished, false);
        release();
        await pending;
        await repeated;
        await finalization;
        if (action === "history")
          await assert.rejects(
            readFile(join(dir, ".import-jobs", j.id + ".json")),
            { code: "ENOENT" },
          );
        else
          assert.equal(
            JSON.parse(
              await readFile(join(dir, ".import-jobs", j.id + ".json"), "utf8"),
            ).error.code,
            "INVALID_JSON",
          );
      } finally {
        release();
        await pending;
        await Promise.allSettled([...jobs.jobs.values()].map((j) => j.work));
        await jobs.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

test("close also waits for an already-running cancellation journal without self-await", async () => {
  const dir = await mkdtemp(join(tmpdir(), "import-cancel-finalize-")),
    jobs = await ImportJobs.open(dir),
    save = jobs.save.bind(jobs);
  let enter, release, cancelling, closing;
  const entered = new Promise((r) => (enter = r)),
    gate = new Promise((r) => (release = r));
  try {
    const j = await jobs.create({ filename: "not-uploaded.json", size: 2 });
    jobs.save = async (record) => {
      if (record.status === "cancelled") {
        enter();
        await gate;
      }
      return save(record);
    };
    cancelling = jobs.cancel(j.id);
    await entered;
    let done = false;
    closing = jobs.close().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(done, false);
    release();
    await cancelling;
    await closing;
    assert.equal(
      JSON.parse(
        await readFile(join(dir, ".import-jobs", j.id + ".json"), "utf8"),
      ).status,
      "cancelled",
    );
  } finally {
    release();
    await cancelling;
    await closing;
    await jobs.close();
    await rm(dir, { recursive: true, force: true });
  }
});
