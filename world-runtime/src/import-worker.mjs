import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { prepareCard } from "./importer.mjs";
try {
  const bytes = await readFile(workerData.path);
  const prepared = prepareCard({ filename: workerData.filename, bytes });
  parentPort.postMessage({ prepared });
} catch (e) {
  parentPort.postMessage({
    error: { code: e.code || "IMPORT_FAILED", message: e.message },
  });
}
