import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { ImportJobs } from "../src/import-jobs.mjs";
import { startServer } from "../src/server.mjs";
const gate = () => {
  let release;
  return {
    promise: new Promise((r) => (release = r)),
    release: () => release(),
  };
};
const delay = () => new Promise((r) => setTimeout(r, 50));
const runtimeDir = new URL("../.runtime/", import.meta.url).pathname;
async function ready(jobs) {
  const bytes = Buffer.from('{"name":"Ordinary close fixture"}'),
    j = await jobs.create({ filename: "card.json", size: bytes.length });
  await jobs.upload(j.id, Readable.from([bytes]));
  await jobs.jobs.get(j.id).work;
  return j;
}
for (const persistent of [false, true])
  test(
    "real HTTP published accept journal EIO cannot strand listener or data lock: " +
      (persistent ? "persistent" : "once"),
    { timeout: 15000 },
    async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), "service-close-")),
        realRename = fs.rename,
        hold = gate(),
        entered = gate();
      let app,
        failed = false,
        closing,
        accepting;
      try {
        app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
        const api = async (path, body) => {
          const r = await fetch(app.url + path, {
            method: body === undefined ? "GET" : "POST",
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          return { http: r.status, ...(await r.json()) };
        };
        const bytes = Buffer.from('{"name":"Published fixture"}'),
          j = await api("/api/import-jobs", {
            filename: "card.json",
            size: bytes.length,
          });
        await fetch(app.url + "/api/import-jobs/" + j.id + "/upload", {
          method: "PUT",
          body: bytes,
        });
        for (;;) {
          if ((await api("/api/import-jobs/" + j.id)).status === "ready") break;
          await new Promise((r) => setTimeout(r, 10));
        }
        fs.rename = async (from, to) => {
          if (String(from).includes("/cards/.staging-")) {
            await realRename(from, to);
            entered.release();
            await hold.promise;
            return;
          }
          if (String(to).endsWith(j.id + ".json")) {
            const v = JSON.parse(await fs.readFile(from, "utf8"));
            if (v.status === "completed" && (!failed || persistent)) {
              failed = true;
              throw Object.assign(Error("Completed journal EIO"), {
                code: "EIO",
              });
            }
          }
          return realRename(from, to);
        };
        syncBuiltinESMExports();
        accepting = api("/api/import-jobs/" + j.id + "/accept", {});
        await entered.promise;
        closing = app.close();
        closing.catch(() => {});
        hold.release();
        const [closed, accepted] = await Promise.allSettled([
          closing,
          accepting,
        ]);
        assert.equal(closed.status, "fulfilled");
        assert.equal(accepted.status, "fulfilled");
        assert.equal(accepted.value.status, "completed");
        assert.equal(accepted.value.persistenceWarning.code, "EIO");
        assert.equal(closed.value.warnings.length, persistent ? 1 : 0);
        assert.equal(app.server.listening, false);
        await assert.rejects(fs.stat(join(dir, ".server-lock")), {
          code: "ENOENT",
        });
        assert.deepEqual(await app.close(), closed.value);
        fs.rename = realRename;
        syncBuiltinESMExports();
        app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
        assert.equal((await api("/api/cards")).cards.length, 1);
        assert.equal(
          (await api("/api/import-jobs/" + j.id)).status,
          "completed",
        );
      } finally {
        hold.release();
        fs.rename = realRename;
        syncBuiltinESMExports();
        await Promise.allSettled([closing, accepting]);
        await app?.close().catch(() => {});
        if (app?.server.listening)
          await new Promise((r) => app.server.close(r));
        await app?.projection.close().catch(() => {});
        try {
          app?.store.close();
        } catch {}
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
test("accepted history create belongs to close boundary; closing rejects every new mutation", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "create-close-")),
    jobs = await ImportJobs.open(dir),
    hold = gate(),
    entered = gate();
  let creating,
    closing,
    closeDone = false,
    writesAfter = 0;
  try {
    for (let i = 0; i < 49; i++) {
      const j = await jobs.create({ filename: "old.json", size: 2 });
      await jobs.cancel(j.id);
    }
    const old = [...jobs.jobs.keys()][0],
      cleanup = jobs.cleanup.bind(jobs),
      save = jobs.save.bind(jobs);
    let first = true;
    jobs.cleanup = async (j) => {
      if (j.id === old && first) {
        first = false;
        entered.release();
        await hold.promise;
      }
      return cleanup(j);
    };
    jobs.save = async (j) => {
      if (closeDone) writesAfter++;
      return save(j);
    };
    creating = jobs.create({ filename: "new.json", size: 2 });
    await entered.promise;
    closing = jobs.close().then(() => (closeDone = true));
    await delay();
    assert.equal(closeDone, false);
    for (const operation of [
      () => jobs.create({ filename: "late.json", size: 2 }),
      () => jobs.upload(old, Readable.from(["{}"])),
      () => jobs.accept(old),
      () => jobs.cancel(old),
    ])
      await assert.rejects(operation(), { code: "IMPORT_CLOSED" });
    hold.release();
    await creating;
    await closing;
    assert.equal(writesAfter, 0);
  } finally {
    hold.release();
    await Promise.allSettled([creating, closing]);
    await jobs.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("eviction reserves its journal against a newly arriving cancel", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "eviction-close-")),
    jobs = await ImportJobs.open(dir),
    hold = gate(),
    entered = gate();
  let creating;
  try {
    for (let i = 0; i < 49; i++) {
      const j = await jobs.create({ filename: "old.json", size: 2 });
      await jobs.cancel(j.id);
    }
    const old = [...jobs.jobs.keys()][0],
      cleanup = jobs.cleanup.bind(jobs);
    let first = true;
    jobs.cleanup = async (j) => {
      if (j.id === old && first) {
        first = false;
        entered.release();
        await hold.promise;
      }
      return cleanup(j);
    };
    creating = jobs.create({ filename: "new.json", size: 2 });
    await entered.promise;
    await assert.rejects(jobs.cancel(old), { code: "IMPORT_RETIRED" });
    hold.release();
    await creating;
    await jobs.close();
    await assert.rejects(
      fs.readFile(join(dir, ".import-jobs", old + ".json")),
      { code: "ENOENT" },
    );
  } finally {
    hold.release();
    await creating;
    await jobs.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("pre-publication close retries a one-shot cancelled journal failure", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "register-close-")),
    jobs = await ImportJobs.open(dir),
    entered = gate(),
    hold = gate();
  let accepting, closing;
  try {
    const j = await ready(jobs),
      save = jobs.save.bind(jobs);
    let failed = false;
    jobs.save = async (r) => {
      if (r.status === "registering") {
        entered.release();
        await hold.promise;
      }
      if (r.status === "cancelled" && !failed) {
        failed = true;
        throw Object.assign(Error("Cancelled journal EIO"), { code: "EIO" });
      }
      return save(r);
    };
    accepting = jobs.accept(j.id);
    accepting.catch(() => {});
    await entered.promise;
    closing = jobs.close();
    closing.catch(() => {});
    hold.release();
    const results = await Promise.allSettled([accepting, closing]);
    assert.ok(results.every((r) => r.status === "fulfilled"));
    assert.equal(jobs.get(j.id).status, "cancelled");
    assert.equal(
      JSON.parse(
        await fs.readFile(join(dir, ".import-jobs", j.id + ".json"), "utf8"),
      ).status,
      "cancelled",
    );
  } finally {
    hold.release();
    await Promise.allSettled([accepting, closing]);
    await jobs.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("unexpected disposal error still closes listener, store and lock and repeated close is truthful", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "dispose-error-"));
  let app;
  try {
    app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
    const closeProjection = app.projection.close.bind(app.projection);
    app.projection.close = async () => {
      await closeProjection();
      throw Object.assign(Error("Projection dispose EIO"), { code: "EIO" });
    };
    const closing = app.close();
    assert.equal(app.close(), closing);
    await assert.rejects(closing, { code: "SHUTDOWN_FAILED" });
    assert.equal(app.server.listening, false);
    await assert.rejects(fs.stat(join(dir, ".server-lock")), {
      code: "ENOENT",
    });
    assert.throws(() => app.store.listWorlds());
    await assert.rejects(app.close(), { code: "SHUTDOWN_FAILED" });
    app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
    assert.equal((await fetch(app.url + "/api/health")).status, 200);
  } finally {
    await app?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});
