import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorldStore } from "../src/store.mjs";
test("v1→v2 migration backs up a consistent original before upgrading audience-aware format", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new WorldStore(dir);
  const w = store.createWorld({ name: "旧存档", card: { name: "甲" } });
  store.close();
  const db = new DatabaseSync(join(dir, "world.sqlite"));
  db.exec(
    "PRAGMA user_version=1; UPDATE metadata SET value='1' WHERE key='version';",
  );
  db.close();
  store = new WorldStore(dir);
  assert.equal(store.snapshot(w.world.id).world.name, "旧存档");
  store.close();
  const backups = readdirSync(dir).filter((x) =>
    /^world-v1-before-v2-.*\.sqlite$/.test(x),
  );
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
  assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(backup.prepare("SELECT name FROM worlds").get().name, "旧存档");
  backup.close();
  const current = new DatabaseSync(join(dir, "world.sqlite"), {
    readOnly: true,
  });
  assert.equal(current.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(
    current.prepare("SELECT value FROM metadata WHERE key='version'").get()
      .value,
    "2",
  );
  current.close();
  store = new WorldStore(dir);
  store.close();
  assert.equal(
    readdirSync(dir).filter((x) => /^world-v1-before-v2-/.test(x)).length,
    1,
  );
});
test("unknown future format is rejected before any migration backup or data rewrite", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "future-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WorldStore(dir);
  store.close();
  const db = new DatabaseSync(join(dir, "world.sqlite"));
  db.exec(
    "PRAGMA user_version=99; UPDATE metadata SET value='99' WHERE key='version';",
  );
  db.close();
  assert.throws(() => new WorldStore(dir), { code: "UNSUPPORTED_SCHEMA" });
  assert.equal(
    readdirSync(dir).some((x) => /^world-v1-before-v2-/.test(x)),
    false,
  );
});
test("migration backup flush failure leaves the original v1 version untouched", async (t) => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const dir = mkdtempSync(join(tmpdir(), "migration-flush-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new WorldStore(dir);
  store.createWorld({ name: "preserve me", card: { name: "甲" } });
  store.close();
  const db = new DatabaseSync(join(dir, "world.sqlite"));
  db.exec(
    "PRAGMA user_version=1; UPDATE metadata SET value='1' WHERE key='version';",
  );
  db.close();
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => {
      throw Object.assign(new Error("simulated flush failure"), {
        code: "EIO",
      });
    };
    syncBuiltinESMExports();
    assert.throws(() => new WorldStore(dir), { code: "EIO" });
  } finally {
    fs.fsyncSync = original;
    syncBuiltinESMExports();
  }
  const check = new DatabaseSync(join(dir, "world.sqlite"), { readOnly: true });
  assert.equal(check.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(
    check.prepare("SELECT name FROM worlds").get().name,
    "preserve me",
  );
  check.close();
});
