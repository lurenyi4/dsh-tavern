import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ImportJobs } from "../src/import-jobs.mjs";
import { listCards } from "../src/importer.mjs";
import { v2, charx } from "../fixtures/import-fixtures.mjs";
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "import-job-"));
  const jobs = await ImportJobs.open(dir);
  t.after(async () => {
    await jobs.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, jobs };
}
async function ready(jobs, id) {
  for (let i = 0; i < 200; i++) {
    const j = jobs.get(id);
    if (!["uploading", "preparing", "created"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("preview timeout");
}
test("binary upload previews without registration, explicit accept preserves exact original and duplicate identity", async (t) => {
  const { dir, jobs } = await setup(t);
  const bytes = Buffer.from(JSON.stringify(v2));
  const j = await jobs.create({ filename: "guide.json", size: bytes.length });
  await jobs.upload(j.id, Readable.from([bytes]));
  const preview = await ready(jobs, j.id);
  assert.equal(preview.status, "ready");
  assert.equal(preview.preview.card.name, "渡口向导");
  assert.deepEqual(await listCards(dir), []);
  const done = await jobs.accept(j.id);
  assert.equal(done.status, "completed");
  assert.equal((await listCards(dir)).length, 1);
  assert.deepEqual(
    await readFile(join(dir, done.result.card.original.path)),
    bytes,
  );
  assert.equal((await jobs.accept(j.id)).result.card.id, done.result.card.id);
});
test("preview cancellation and malformed upload leave existing content intact and permit retry", async (t) => {
  const { dir, jobs } = await setup(t);
  let j = await jobs.create({
    filename: "cancel.json",
    size: Buffer.byteLength(JSON.stringify(v2)),
  });
  await jobs.upload(j.id, Readable.from([Buffer.from(JSON.stringify(v2))]));
  await ready(jobs, j.id);
  assert.equal((await jobs.cancel(j.id)).status, "cancelled");
  await assert.rejects(jobs.accept(j.id), { code: "IMPORT_NOT_READY" });
  assert.deepEqual(await listCards(dir), []);
  j = await jobs.create({ filename: "bad.json", size: 4 });
  await jobs.upload(j.id, Readable.from([Buffer.from("{bad")]));
  assert.equal((await ready(jobs, j.id)).status, "failed");
  assert.deepEqual(await listCards(dir), []);
});
test("incomplete transfer fails atomically and startup records interrupted imports", async (t) => {
  const { dir, jobs } = await setup(t);
  const j = await jobs.create({ filename: "short.json", size: 20 });
  await assert.rejects(jobs.upload(j.id, Readable.from([Buffer.from("{}")])));
  assert.equal(jobs.get(j.id).status, "failed");
  await jobs.close();
  const restarted = await ImportJobs.open(dir);
  t.after(() => restarted.close());
  assert.equal(restarted.get(j.id).status, "failed");
  const next = await restarted.create({ filename: "waiting.json", size: 10 });
  await restarted.close();
  const again = await ImportJobs.open(dir);
  t.after(() => again.close());
  assert.equal(again.get(next.id).status, "interrupted");
  assert.deepEqual(await listCards(dir), []);
});

test("resource preview is local, cancellation removes staging and startup cleans only unreferenced media", async (t) => {
  const { dir, jobs } = await setup(t);
  const bytes = charx();
  const j = await jobs.create({ filename: "media.charx", size: bytes.length });
  await jobs.upload(j.id, Readable.from([bytes]));
  const preview = await ready(jobs, j.id),
    asset = preview.preview.card.assets[0];
  assert.ok(jobs.asset(j.id, asset.id).bytes.length > 0);
  const result = await jobs.accept(j.id);
  await jobs.close();
  const stale = "a".repeat(64);
  await writeFile(join(dir, "assets", stale), "orphan");
  const staging = join(
    dir,
    "cards",
    ".staging-12345678-1234-1234-1234-123456789abc",
  );
  await mkdir(staging);
  await writeFile(join(staging, "partial"), "partial");
  const restarted = await ImportJobs.open(dir);
  t.after(() => restarted.close());
  assert.deepEqual(restarted.recovery, { staging: 1, orphanAssets: 1 });
  assert.ok((await readFile(join(dir, "assets", asset.id))).length > 0);
  assert.equal((await listCards(dir))[0].id, result.result.card.id);
  await assert.rejects(readFile(join(dir, "assets", stale)), {
    code: "ENOENT",
  });
});

test("cancelling an in-flight upload releases the slot and does not register partial bytes", async (t) => {
  const { dir, jobs } = await setup(t);
  const { PassThrough } = await import("node:stream");
  const stream = new PassThrough();
  const j = await jobs.create({ filename: "partial.json", size: 100 });
  const upload = jobs.upload(j.id, stream);
  upload.catch(() => {});
  stream.write(Buffer.from("{"));
  assert.equal((await jobs.cancel(j.id)).status, "cancelled");
  await assert.rejects(upload);
  assert.deepEqual(await listCards(dir), []);
  assert.equal(
    (await jobs.create({ filename: "next.json", size: 2 })).status,
    "created",
  );
});

test(
  "a 21 MiB CharX uploads in bounded chunks, retains unknown binary and remains usable after reopen",
  { timeout: 20000 },
  async (t) => {
    const { dir, jobs } = await setup(t);
    const payload = Buffer.alloc(21 * 1024 * 1024, 7),
      bytes = charx([{ name: "assets/other/large.bin", bytes: payload }]);
    const j = await jobs.create({
      filename: "large.charx",
      size: bytes.length,
    });
    async function* chunks() {
      for (let at = 0; at < bytes.length; at += 256 * 1024)
        yield bytes.subarray(at, at + 256 * 1024);
    }
    await jobs.upload(j.id, Readable.from(chunks()));
    assert.equal(jobs.get(j.id).received, bytes.length);
    assert.equal((await ready(jobs, j.id)).status, "ready");
    const done = await jobs.accept(j.id);
    assert.equal(done.status, "completed");
    const resource = done.result.card.extensions._import.resources.find(
      (r) => r.name === "assets/other/large.bin",
    );
    assert.deepEqual(await readFile(join(dir, resource.path)), payload);
    await jobs.close();
    const again = await ImportJobs.open(dir);
    t.after(() => again.close());
    assert.equal(again.get(j.id).status, "completed");
    assert.equal((await listCards(dir)).length, 1);
  },
);

test(
  "process termination after preview leaves an interrupted job and no partially registered card",
  { timeout: 10000 },
  async (t) => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const dir = await mkdtemp(join(tmpdir(), "import-process-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const script = join(dir, "child.mjs");
    await writeFile(
      script,
      `import {ImportJobs} from ${JSON.stringify(new URL("../src/import-jobs.mjs", import.meta.url).href)};import {Readable} from 'node:stream';const jobs=await ImportJobs.open(${JSON.stringify(dir)});const bytes=Buffer.from('\\u007b"name":"Interrupted guide"}');const j=await jobs.create({filename:'card.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));const timer=setInterval(()=>{if(jobs.get(j.id).status==='ready'){console.log(j.id);clearInterval(timer);setInterval(()=>{},1000);}},10);`,
    );
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill());
    const id = await new Promise((resolve, reject) => {
      child.stdout.once("data", (x) => resolve(String(x).trim()));
      child.once("error", reject);
      child.once("exit", () => reject(Error("child exited early")));
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const recovered = await ImportJobs.open(dir);
    t.after(() => recovered.close());
    assert.equal(recovered.get(id).status, "interrupted");
    assert.deepEqual(await listCards(dir), []);
  },
);

test("cancel before atomic publication cleans only newly created resources and keeps earlier card media", async (t) => {
  const { importCard } = await import("../src/importer.mjs");
  const { silentWav } = await import("../fixtures/import-fixtures.mjs");
  const { readdir } = await import("node:fs/promises");
  const { dir } = await setup(t);
  const before = await importCard({
    filename: "before.charx",
    bytes: charx(),
    dataDir: dir,
  });
  const controller = new AbortController();
  await assert.rejects(
    importCard({
      filename: "cancel.charx",
      bytes: charx([
        {
          name: "assets/extra/new.wav",
          bytes: silentWav(),
        },
      ]),
      dataDir: dir,
      signal: controller.signal,
      onProgress: (stage) => {
        if (stage === "registering") controller.abort();
      },
    }),
  );
  assert.deepEqual(
    (await listCards(dir)).map((c) => c.id),
    [before.card.id],
  );
  assert.deepEqual(
    (await readdir(join(dir, "assets"))).sort(),
    [...new Set(before.card.assets.map((a) => a.id))].sort(),
  );
});

test("ready-record EIO releases upload and terminal cancel retries a transient cleanup failure", async (t) => {
  const fs = await import("node:fs/promises"),
    { syncBuiltinESMExports } = await import("node:module");
  const { dir, jobs } = await setup(t),
    save = jobs.save.bind(jobs);
  let injected = false,
    failedCleanup = false;
  const originalRm = fs.default.rm;
  jobs.save = async (j) => {
    if (j.status === "ready" && !injected) {
      injected = true;
      throw Object.assign(new Error("Ready record persistence failed"), {
        code: "EIO",
      });
    }
    return save(j);
  };
  const bytes = Buffer.from(JSON.stringify(v2)),
    j = await jobs.create({ filename: "ready.json", size: bytes.length });
  fs.default.rm = async (path, ...args) => {
    if (
      path === join(dir, ".import-jobs", j.id + ".upload") &&
      !failedCleanup
    ) {
      failedCleanup = true;
      throw Object.assign(new Error("Temporary cleanup unavailable"), {
        code: "EIO",
      });
    }
    return originalRm(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    await jobs.upload(j.id, Readable.from([bytes]));
    await ready(jobs, j.id);
    await jobs.jobs.get(j.id).work;
    assert.equal(jobs.get(j.id).status, "failed");
    assert.equal(jobs.get(j.id).error.code, "EIO");
    assert.equal(jobs.get(j.id).cleanupWarning.code, "EIO");
    await jobs.cancel(j.id);
    assert.equal(jobs.get(j.id).cleanupWarning, undefined);
    await assert.rejects(
      readFile(join(dir, ".import-jobs", j.id + ".upload")),
      { code: "ENOENT" },
    );
    assert.deepEqual(await listCards(dir), []);
  } finally {
    fs.default.rm = originalRm;
    syncBuiltinESMExports();
  }
  await jobs.close();
  const reopened = await ImportJobs.open(dir);
  t.after(() => reopened.close());
  assert.equal(reopened.get(j.id).status, "failed");
  assert.equal(reopened.get(j.id).error.code, "EIO");
});

test(
  "acceptance rejects media duplication beyond the bounded backup closure without affecting existing cards",
  { timeout: 20000 },
  async (t) => {
    const { dir, jobs } = await setup(t);
    const { silentWav } = await import("../fixtures/import-fixtures.mjs");
    const { importCard } = await import("../src/importer.mjs");
    const prior = await importCard({
      filename: "prior.json",
      bytes: Buffer.from(JSON.stringify(v2)),
      dataDir: dir,
    });
    const sound = (value) => {
      const bytes = Buffer.alloc(24 * 1024 * 1024 + 44, value);
      silentWav().copy(bytes, 0, 0, 44);
      bytes.writeUInt32LE(bytes.length - 8, 4);
      bytes.writeUInt32LE(bytes.length - 44, 40);
      return bytes;
    };
    const bytes = charx([
      { name: "assets/a.wav", bytes: sound(1) },
      { name: "assets/b.wav", bytes: sound(2) },
    ]);
    const j = await jobs.create({
      filename: "large-media.charx",
      size: bytes.length,
    });
    await jobs.upload(j.id, Readable.from([bytes]));
    const done = await ready(jobs, j.id);
    assert.equal(done.status, "failed");
    assert.equal(done.error.code, "IMPORT_STORAGE_BUDGET");
    await assert.rejects(jobs.accept(j.id), { code: "IMPORT_NOT_READY" });
    assert.deepEqual(
      (await listCards(dir)).map((c) => c.id),
      [prior.card.id],
    );
  },
);
