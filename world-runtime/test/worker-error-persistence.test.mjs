import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { ImportJobs } from "../src/import-jobs.mjs";
import { listCards } from "../src/importer.mjs";
for (const mode of [
  "cleanup_once",
  "cleanup_persistent",
  "save_once",
  "save_persistent",
])
  test(
    "worker INVALID_JSON survives " + mode + " and retry/reopen",
    async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), "worker-primary-"));
      const originalRm = fs.rm;
      let jobs,
        enabled = true,
        faults = 0;
      try {
        jobs = await ImportJobs.open(dir);
        const save = jobs.save.bind(jobs),
          bytes = Buffer.from('{"name":'),
          j = await jobs.create({
            filename: "incomplete.json",
            size: bytes.length,
          }),
          path = join(dir, ".import-jobs", j.id + ".upload");
        const shouldFail = () =>
          enabled && (mode.endsWith("persistent") || faults === 0);
        if (mode.startsWith("cleanup")) {
          fs.rm = async (p, ...args) => {
            if (p === path && shouldFail()) {
              faults++;
              throw Object.assign(new Error("Cleanup busy"), { code: "EBUSY" });
            }
            return originalRm(p, ...args);
          };
          syncBuiltinESMExports();
        } else
          jobs.save = async (record) => {
            if (record.status === "failed" && shouldFail()) {
              faults++;
              throw Object.assign(new Error("Journal IO failure"), {
                code: "EIO",
              });
            }
            return save(record);
          };
        await jobs.upload(j.id, Readable.from([bytes]));
        await jobs.jobs.get(j.id).work;
        const failed = jobs.get(j.id);
        assert.equal(failed.status, "failed");
        assert.equal(failed.error.code, "INVALID_JSON");
        assert.equal(faults, 1);
        assert.equal(
          mode.startsWith("cleanup")
            ? failed.cleanupWarning.code
            : failed.persistenceWarning.code,
          mode.startsWith("cleanup") ? "EBUSY" : "EIO",
        );
        assert.deepEqual(await listCards(dir), []);
        if (mode.endsWith("persistent")) {
          if (mode.startsWith("cleanup"))
            assert.equal((await jobs.cancel(j.id)).error.code, "INVALID_JSON");
          else await assert.rejects(jobs.cancel(j.id), { code: "EIO" });
          assert.equal(jobs.get(j.id).error.code, "INVALID_JSON");
        }
        enabled = false;
        fs.rm = originalRm;
        syncBuiltinESMExports();
        await jobs.cancel(j.id);
        assert.equal(jobs.get(j.id).error.code, "INVALID_JSON");
        assert.equal(jobs.get(j.id).cleanupWarning, undefined);
        await assert.rejects(fs.readFile(path), { code: "ENOENT" });
        await jobs.close();
        jobs = await ImportJobs.open(dir);
        assert.equal(jobs.get(j.id).error.code, "INVALID_JSON");
        assert.equal(jobs.get(j.id).status, "failed");
      } finally {
        fs.rm = originalRm;
        syncBuiltinESMExports();
        await jobs?.close();
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
