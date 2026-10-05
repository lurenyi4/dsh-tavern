// Independent actual HTTP reliability probe, isolated temporary storage, no product edits.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
const dir = await fs.mkdtemp(join(tmpdir(), "independent-worker-error-"));
const realRm = fs.rm;
let server;
try {
  server = await startServer({
    dataDir: dir,
    port: 0,
    runtimeDir: new URL("../.runtime", import.meta.url).pathname,
    env: {},
  });
  const api = async (path, body) => {
    const response = await fetch(server.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { http: response.status, ...(await response.json()) };
  };
  const bytes = Buffer.from('{"name":');
  const j = await api("/api/import-jobs", {
    filename: "ordinary-incomplete.json",
    size: bytes.length,
  });
  const uploadPath = join(dir, ".import-jobs", j.id + ".upload");
  let faults = 0;
  fs.rm = async (path, ...args) => {
    if (path === uploadPath) {
      faults++;
      throw Object.assign(new Error("Independent cleanup EBUSY"), {
        code: "EBUSY",
      });
    }
    return realRm(path, ...args);
  };
  syncBuiltinESMExports();
  const response = await fetch(
    server.url + "/api/import-jobs/" + j.id + "/upload",
    { method: "PUT", body: bytes },
  );
  assert.equal(response.status, 202);
  let result;
  for (let i = 0; i < 200; i++) {
    result = await api("/api/import-jobs/" + j.id);
    if (result.status === "failed") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  console.log(
    JSON.stringify({
      case: "worker-invalid-json-plus-cleanup-failure",
      result,
      faults,
    }),
  );
  fs.rm = realRm;
  syncBuiltinESMExports();
  const cancelled = await api("/api/import-jobs/" + j.id + "/cancel", {});
  console.log(JSON.stringify({ case: "retry-cleanup", result: cancelled }));
  assert.equal(result.status, "failed");
  assert.equal(result.cleanupWarning.code, "EBUSY");
  // Expected contract: primary INVALID_JSON survives, cleanup has independent warning.
  assert.equal(result.error.code, "INVALID_JSON");
} finally {
  fs.rm = realRm;
  syncBuiltinESMExports();
  await server?.close();
  await fs.rm(dir, { recursive: true, force: true });
}
