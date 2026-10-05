import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { initialState } from "../src/domain-state.mjs";
import { parseCardMetadata, listCards, importCard } from "../src/importer.mjs";
import { ImportJobs } from "../src/import-jobs.mjs";
const verify = (card) => {
  initialState(card);
  assert.deepEqual(parseCardMetadata(Buffer.from(JSON.stringify(card))), card);
};
const rejects = (card) => {
  assert.throws(() => initialState(card));
  assert.throws(() => parseCardMetadata(Buffer.from(JSON.stringify(card))));
};
const nested = (depth) => {
  let v = "leaf";
  for (let i = 0; i < depth; i++) v = { child: v };
  return v;
};
test("normalized depth, string, array and name boundaries are shared with world consumption", () => {
  verify({ name: "x".repeat(512), extensions: { value: nested(30) } });
  rejects({ name: "x".repeat(513) });
  rejects({ name: "valid", extensions: { value: nested(31) } });
  verify({
    name: "valid",
    extensions: { text: "x".repeat(1024 * 1024), list: Array(20000).fill(0) },
  });
  rejects({ name: "valid", extensions: { text: "x".repeat(1024 * 1024 + 1) } });
  rejects({ name: "valid", extensions: { list: Array(20001).fill(0) } });
  rejects({
    name: "valid",
    extensions: { text: Array(6).fill("x".repeat(900000)) },
  });
});
test("normalized node expansion budget has a finite exact boundary", () => {
  const card = {
    name: "valid",
    extensions: {
      values: Array.from({ length: 12 }, () => Array(19999).fill(null)),
    },
  };
  card.extensions.values.push(Array(9995).fill(null));
  verify(card);
  card.extensions.values[12].push(null);
  rejects(card);
});
test("valid source structures beyond the normalized contract fail before ready or registration and retain existing cards", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "content-contract-")),
    jobs = await ImportJobs.open(dir);
  t.after(async () => {
    await jobs.close();
    await rm(dir, { recursive: true, force: true });
  });
  const original = await importCard({
    filename: "existing.json",
    bytes: Buffer.from('{"name":"Existing card"}'),
    dataDir: dir,
  });
  for (const source of [
    { name: "deep", extensions: { future: nested(40) } },
    { name: "long", extensions: { future: "x".repeat(1024 * 1024 + 1) } },
    { name: "array", extensions: { future: Array(20001).fill(0) } },
    {
      name: "bytes",
      extensions: { future: Array(6).fill("x".repeat(900000)) },
    },
    { name: "x".repeat(513) },
  ]) {
    const bytes = Buffer.from(JSON.stringify(source)),
      j = await jobs.create({ filename: "ordinary.json", size: bytes.length });
    await jobs.upload(j.id, Readable.from([bytes]));
    while (jobs.get(j.id).status === "preparing")
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(jobs.get(j.id).status, "failed");
    await assert.rejects(jobs.accept(j.id), { code: "IMPORT_NOT_READY" });
    assert.deepEqual(
      (await listCards(dir)).map((c) => c.id),
      [original.card.id],
    );
  }
});

test("normalized serialized byte limit is exact and shared", () => {
  const card = {
    name: "Byte boundary",
    extensions: { parts: [...Array(4).fill("x".repeat(1024 * 1024)), ""] },
  };
  const remaining = 5 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(card));
  card.extensions.parts[4] = "x".repeat(remaining);
  verify(card);
  card.extensions.parts[4] += "x";
  rejects(card);
});

test("ordinary module raw-plus-mapped expansion is rejected before acceptance when normalized nodes exceed budget", async (t) => {
  const { zip, risum } = await import("../fixtures/import-fixtures.mjs");
  const dir = await mkdtemp(join(tmpdir(), "content-expansion-")),
    jobs = await ImportJobs.open(dir);
  t.after(async () => {
    await jobs.close();
    await rm(dir, { recursive: true, force: true });
  });
  const module = {
    name: "Ordinary large module",
    lorebook: Array.from({ length: 5000 }, (_, id) => ({
      id,
      key: "village",
      content: "A local reference.",
      extra: Array(10).fill("kept"),
    })),
  };
  const bytes = zip([
    { name: "card.json", bytes: JSON.stringify({ name: "Module reference" }) },
    { name: "module.risum", bytes: risum(module) },
  ]);
  const j = await jobs.create({
    filename: "expanded.charx",
    size: bytes.length,
  });
  await jobs.upload(j.id, Readable.from([bytes]));
  while (jobs.get(j.id).status === "preparing")
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(jobs.get(j.id).status, "failed");
  assert.match(jobs.get(j.id).error.message, /too complex/);
  assert.deepEqual(await listCards(dir), []);
  await assert.rejects(jobs.accept(j.id), { code: "IMPORT_NOT_READY" });
});
