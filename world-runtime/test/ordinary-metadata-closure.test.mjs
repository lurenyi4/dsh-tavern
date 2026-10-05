// Ordinary synthetic lorebook, no scripts or external data. End-to-end capacity contract.
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { restoreBackup } from "../src/backup.mjs";
const dir = await mkdtemp(join(tmpdir(), "media-full-closure-"));
let server;
try {
  server = await startServer({
    dataDir: dir,
    port: 0,
    runtimeDir: new URL("../.runtime/", import.meta.url).pathname,
    env: {},
  });
  const api = async (path, body) => {
    const r = await fetch(server.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, value: await r.json() };
  };
  let nested = "leaf";
  for (let i = 0; i < 20; i++) nested = { child: nested };
  const sources = [
    {
      name: "Ordinary reference book",
      first_mes: "Good morning.",
      character_book: {
        entries: Array.from({ length: 5000 }, (_, id) => ({
          id,
          keys: ["place" + id],
          content: "A quiet village.",
          comment: "Local geography",
          enabled: true,
          insertion_order: id,
        })),
      },
    },
    { name: "Nested reference", extensions: { future: nested } },
    {
      name: "Unicode reference",
      extensions: {
        future: {
          text: "星".repeat(120000),
          list: Array.from({ length: 10000 }, (_, i) => i),
        },
      },
    },
  ];
  for (const [index, source] of sources.entries()) {
    const bytes = Buffer.from(JSON.stringify(source));
    const { value: j } = await api("/api/import-jobs", {
      filename: "reference.json",
      size: bytes.length,
    });
    const upload = await fetch(
      server.url + "/api/import-jobs/" + j.id + "/upload",
      { method: "PUT", body: bytes },
    );
    assert.equal(upload.status, 202);
    let p;
    do {
      await new Promise((r) => setTimeout(r, 10));
      p = (await api("/api/import-jobs/" + j.id)).value;
    } while (p.status === "preparing");
    assert.equal(p.status, "ready");
    const accepted = await api("/api/import-jobs/" + j.id + "/accept", {});
    assert.equal(accepted.value.status, "completed");
    const card = accepted.value.result.card;
    assert.deepEqual(await readFile(join(dir, card.original.path)), bytes);
    const world = await api("/api/worlds", {
      name: "Reference world",
      cardId: card.id,
    });
    const backup = await api("/api/backup");
    const count = (value) =>
      1 +
      (value && typeof value === "object"
        ? Object.values(value).reduce((n, x) => n + count(x), 0)
        : 0);
    console.log(
      JSON.stringify({
        originalBytes: bytes.length,
        normalizedBytes: JSON.stringify(card).length,
        preview: p.status,
        accepted: accepted.value.status,
        world: world.status,
        worldError: world.value.error,
        originalNodes: count(JSON.parse(bytes)),
        normalizedNodes: count(card),
        backupStatus: backup.status,
        backupError: backup.value.error,
      }),
    );
    assert.equal(world.status, 201);
    assert.equal(
      backup.status,
      200,
      "Every accepted ordinary card should permit backup",
    );
    const file = join(dir, "backup-" + index + ".json");
    await writeFile(file, JSON.stringify(backup.value));
    const restored = await restoreBackup(file, join(dir, "restored-" + index));
    assert.deepEqual(
      await readFile(join(restored.dataDir, card.original.path)),
      bytes,
    );
    const second = await startServer({
      dataDir: restored.dataDir,
      port: 0,
      runtimeDir: new URL("../.runtime/", import.meta.url).pathname,
      env: {},
    });
    try {
      const r = await fetch(second.url + "/api/worlds");
      assert.equal((await r.json()).worlds.length, index + 1);
    } finally {
      await second.close();
    }
  }
} finally {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
