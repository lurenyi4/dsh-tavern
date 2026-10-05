import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { charx, silentWav } from "../fixtures/import-fixtures.mjs";
import { restoreBackup } from "../src/backup.mjs";
const temp = await mkdtemp(join(tmpdir(), "full-media-review-"));
const runtimeDir = new URL("../.runtime/", import.meta.url).pathname;
let server;
async function api(path, body) {
  const r = await fetch(server.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  return { status: r.status, value };
}
try {
  server = await startServer({
    dataDir: join(temp, "data"),
    port: 0,
    runtimeDir,
    env: {},
  });
  for (const large of [false, true]) {
    const extras = [{ name: "assets/audio/sample.wav", bytes: silentWav() }];
    if (large)
      extras.push(
        {
          name: "assets/other/one.bin",
          bytes: Buffer.alloc(21 * 1024 * 1024, 7),
        },
        {
          name: "assets/other/two.bin",
          bytes: Buffer.alloc(21 * 1024 * 1024, 8),
        },
      );
    const bytes = charx(extras);
    const { value: j } = await api("/api/import-jobs", {
      filename: large ? "large.charx" : "small.charx",
      size: bytes.length,
    });
    const upload = await fetch(
      server.url + "/api/import-jobs/" + j.id + "/upload",
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      },
    );
    assert.equal(upload.status, 202);
    let p;
    do {
      await new Promise((r) => setTimeout(r, 20));
      p = (await api("/api/import-jobs/" + j.id)).value;
    } while (p.status === "preparing");
    assert.equal(p.status, "ready");
    const accepted = await api("/api/import-jobs/" + j.id + "/accept", {});
    assert.equal(accepted.value.status, "completed");
    const card = accepted.value.result.card;
    assert.deepEqual(
      Buffer.from(
        await (
          await fetch(server.url + "/api/cards/" + card.id + "/original")
        ).arrayBuffer(),
      ),
      bytes,
    );
    const world = await api("/api/worlds", {
      name: large ? "Large imported world" : "Small imported world",
      cardId: card.id,
    });
    assert.equal(world.status, 201);
    const backup = await api("/api/backup");
    console.log(
      JSON.stringify({
        large,
        originalBytes: bytes.length,
        importStatus: accepted.value.status,
        worldStatus: world.status,
        backupStatus: backup.status,
        backupError: backup.value.error,
      }),
    );
    assert.equal(backup.status, 200);
    {
      const file = join(temp, large ? "large.json" : "small.json");
      await writeFile(file, JSON.stringify(backup.value));
      const restored = await restoreBackup(
        file,
        join(temp, large ? "restored-large" : "restored-small"),
      );
      assert.ok(restored.files > 0);
      console.log((large ? "large" : "small") + " media backup restore passed");
      assert.deepEqual(
        await readFile(join(restored.dataDir, card.original.path)),
        bytes,
      );
      for (const resource of card.extensions._import.resources)
        assert.deepEqual(
          await readFile(join(restored.dataDir, resource.path)),
          await readFile(join(temp, "data", resource.path)),
        );
    }
  }
} finally {
  await server?.close();
  await rm(temp, { recursive: true, force: true });
}
