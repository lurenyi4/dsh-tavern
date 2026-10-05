import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/server.mjs";
const runtimeDir = new URL("../.runtime/", import.meta.url).pathname;
const gate = () => {
  let release;
  return {
    promise: new Promise((r) => (release = r)),
    release: () => release(),
  };
};
for (const route of ["import", "worlds"])
  for (const fault of [false, true])
    test(
      "disconnected " +
        route +
        " handler remains owned through close; storage failure " +
        fault,
      { timeout: 15000 },
      async () => {
        const dir = await fs.mkdtemp(join(tmpdir(), "http-owner-")),
          realRename = fs.rename,
          entered = gate(),
          hold = gate();
        let app,
          request,
          closing,
          closed = false,
          lateWrites = 0;
        try {
          app = await startServer({
            dataDir: dir,
            port: 0,
            runtimeDir,
            env: {},
          });
          fs.rename = async (from, to) => {
            if (String(from).includes("/cards/.staging-")) {
              entered.release();
              await hold.promise;
              if (closed) lateWrites++;
              if (fault)
                throw Object.assign(
                  Error("Persistent registration IO failure"),
                  { code: "EIO" },
                );
            }
            return realRename(from, to);
          };
          syncBuiltinESMExports();
          const payload = JSON.stringify(
            route === "import"
              ? {
                  filename: "legacy.json",
                  base64: Buffer.from(
                    '{"name":"Disconnected import"}',
                  ).toString("base64"),
                }
              : { name: "Disconnected world" },
          );
          request = http.request(
            app.url + "/api/" + route,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              },
            },
            (r) => r.resume(),
          );
          request.on("error", () => {});
          request.end(payload);
          await entered.promise;
          request.destroy();
          await new Promise((r) => setTimeout(r, 20));
          closing = app.close().then((result) => {
            closed = true;
            return result;
          });
          await new Promise((r) => setTimeout(r, 70));
          assert.equal(
            closed,
            false,
            "business handler must outlive its disconnected socket",
          );
          assert.equal(
            (await fs.stat(join(dir, ".server-lock"))).isDirectory(),
            true,
          );
          hold.release();
          await closing;
          assert.equal(lateWrites, 0);
          assert.equal(app.server.listening, false);
          await assert.rejects(fs.stat(join(dir, ".server-lock")), {
            code: "ENOENT",
          });
          fs.rename = realRename;
          syncBuiltinESMExports();
          app = await startServer({
            dataDir: dir,
            port: 0,
            runtimeDir,
            env: {},
          });
          const cards = await (await fetch(app.url + "/api/cards")).json(),
            worlds = await (await fetch(app.url + "/api/worlds")).json();
          assert.equal(cards.cards.length, fault ? 0 : 1);
          assert.equal(
            worlds.worlds.length,
            !fault && route === "worlds" ? 1 : 0,
          );
        } finally {
          hold.release();
          request?.destroy();
          fs.rename = realRename;
          syncBuiltinESMExports();
          await closing?.catch(() => {});
          await app?.close().catch(() => {});
          await new Promise((r) => setTimeout(r, 50));
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
    );
test(
  "shutdown aborts unfinished JSON bodies instead of waiting indefinitely",
  { timeout: 5000 },
  async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "http-body-close-"));
    let app, request;
    try {
      app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
      request = http.request(
        app.url + "/api/worlds",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "1000",
          },
        },
        (r) => r.resume(),
      );
      request.on("error", () => {});
      request.write("{");
      await new Promise((r) => setTimeout(r, 40));
      await Promise.race([
        app.close(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("close waited for unfinished body")),
            1500,
          ).unref(),
        ),
      ]);
      assert.equal(app.server.listening, false);
      await assert.rejects(fs.stat(join(dir, ".server-lock")), {
        code: "ENOENT",
      });
    } finally {
      request?.destroy();
      await app?.close().catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "disconnected world action remains owned through its real projection completion",
  { timeout: 15000 },
  async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "http-action-owner-")),
      entered = gate(),
      hold = gate();
    let app,
      request,
      closing,
      closed = false,
      late = 0;
    try {
      app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
      const world = await (
          await fetch(app.url + "/api/worlds", {
            method: "POST",
            body: JSON.stringify({ name: "Action owner" }),
          })
        ).json(),
        drain = app.projection.drain.bind(app.projection);
      app.projection.drain = async (...args) => {
        entered.release();
        await hold.promise;
        if (closed) late++;
        return drain(...args);
      };
      const payload = JSON.stringify({
        branchId: world.branch.id,
        narrative: "A normal local update",
        operations: [{ op: "set_variable", key: "visited", value: true }],
      });
      request = http.request(
        app.url + "/api/worlds/" + world.world.id + "/actions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (r) => r.resume(),
      );
      request.on("error", () => {});
      request.end(payload);
      await entered.promise;
      request.destroy();
      closing = app.close().then(() => (closed = true));
      await new Promise((r) => setTimeout(r, 70));
      assert.equal(closed, false);
      assert.equal(
        (await fs.stat(join(dir, ".server-lock"))).isDirectory(),
        true,
      );
      hold.release();
      await closing;
      assert.equal(late, 0);
      app = await startServer({ dataDir: dir, port: 0, runtimeDir, env: {} });
      const recovered = await (
        await fetch(app.url + "/api/worlds/" + world.world.id)
      ).json();
      assert.equal(recovered.state.variables.visited, true);
      assert.ok(recovered.outbox.every((x) => x.status === "delivered"));
    } finally {
      hold.release();
      request?.destroy();
      await closing?.catch(() => {});
      await app?.close().catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
