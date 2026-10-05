import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ImportJobs } from "../src/import-jobs.mjs";
for (const phase of ["writeFile", "sync", "close"])
  test(
    "upload " +
      phase +
      " failure retains primary error through cleanup failure and restart",
    async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), "upload-fault-"));
      const originalOpen = fs.open,
        originalRm = fs.rm;
      let jobs;
      try {
        jobs = await ImportJobs.open(dir);
        const bytes = Buffer.from('{"name":"Ordinary local card"}'),
          j = await jobs.create({ filename: "card.json", size: bytes.length }),
          path = join(dir, ".import-jobs", j.id + ".upload");
        let rmFault = false,
          operationFault = false;
        fs.open = async (p, ...args) => {
          const h = await originalOpen(p, ...args);
          if (p === path) {
            const operation = h[phase].bind(h);
            h[phase] = async (...a) => {
              if (!operationFault) {
                operationFault = true;
                if (phase === "close") await operation(...a);
                throw Object.assign(new Error("Primary " + phase + " EIO"), {
                  code: "EIO",
                });
              }
              return operation(...a);
            };
          }
          return h;
        };
        fs.rm = async (p, ...args) => {
          if (p === path && !rmFault) {
            rmFault = true;
            throw Object.assign(new Error("Cleanup busy"), { code: "EBUSY" });
          }
          return originalRm(p, ...args);
        };
        syncBuiltinESMExports();
        await assert.rejects(jobs.upload(j.id, Readable.from([bytes])), {
          code: "EIO",
        });
        assert.equal(jobs.get(j.id).status, "failed");
        assert.match(jobs.get(j.id).error.message, new RegExp(phase));
        assert.equal(jobs.get(j.id).cleanupWarning.code, "EBUSY");
        fs.open = originalOpen;
        fs.rm = originalRm;
        syncBuiltinESMExports();
        await jobs.close();
        jobs = await ImportJobs.open(dir);
        assert.equal(jobs.get(j.id).status, "failed");
        assert.equal(jobs.get(j.id).error.code, "EIO");
        await assert.rejects(fs.readFile(path), { code: "ENOENT" });
      } finally {
        fs.open = originalOpen;
        fs.rm = originalRm;
        syncBuiltinESMExports();
        await jobs?.close();
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
