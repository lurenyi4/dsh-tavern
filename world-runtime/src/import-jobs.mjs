import { Worker } from "node:worker_threads";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
  open,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  importCard,
  readCard,
  recoverImportStorage,
  checkImportBudget,
  IMPORT_LIMITS,
} from "./importer.mjs";
const terminal = new Set(["completed", "cancelled", "failed", "interrupted"]);
const failure = (code, message) => Object.assign(new Error(message), { code });
export class ImportJobs {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.root = join(dataDir, ".import-jobs");
    this.jobs = new Map();
    this.closed = false;
  }
  static async open(dir) {
    const self = new ImportJobs(dir);
    self.recovery = await recoverImportStorage(dir);
    await mkdir(self.root, { recursive: true, mode: 0o700 });
    if ((await lstat(self.root)).isSymbolicLink())
      throw failure("UNSAFE_STORAGE", "导入目录不能是链接");
    for (const name of await readdir(self.root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const saved = JSON.parse(await readFile(join(self.root, name), "utf8"));
      if (saved.id + ".json" !== name)
        throw failure("CORRUPT_STORAGE", "导入记录不一致");
      if (
        saved.cardId &&
        (saved.status === "completed" ||
          saved.status === "registering" ||
          (["failed", "cancelled"].includes(saved.status) &&
            saved.stage === "registering"))
      ) {
        try {
          await readCard(dir, saved.cardId);
          const uncertain = saved.status !== "completed";
          saved.status = "completed";
          delete saved.error;
          if (uncertain)
            saved.warning ??= {
              code: "IMPORT_DURABILITY",
              message:
                "重启已确认卡片注册存在，但上次持久化结果未确认；请保留原件并备份。",
            };
        } catch (e) {
          if (e.code !== "CARD_NOT_FOUND") throw e;
          if (saved.status === "completed") {
            saved.status = "failed";
            saved.error = {
              code: "IMPORT_PUBLICATION_MISSING",
              message: "上次记录的已注册卡片在重启后不存在；请从原件重新导入。",
            };
          }
        }
      }
      if (!terminal.has(saved.status)) saved.status = "interrupted";
      const j = { ...saved, controller: new AbortController() };

      self.jobs.set(j.id, j);
      await self.cleanup(j);
      await self.save(j);
    }
    return self;
  }
  async cleanup(j) {
    try {
      await rm(join(this.root, j.id + ".upload"), { force: true });
      delete j.cleanupWarning;
      return true;
    } catch (e) {
      j.cleanupWarning = {
        code: e.code || "IMPORT_CLEANUP",
        message: "临时上传清理失败；取消或重启会重试。",
      };
      return false;
    }
  }
  async save(j) {
    const previous = j.saving ?? Promise.resolve();
    j.saving = previous
      .catch(() => {})
      .then(async () => {
        const saved = {
          id: j.id,
          filename: j.filename,
          size: j.size,
          received: j.received,
          status: j.status,
          stage: j.stage,
          error: j.error,
          warning: j.warning,
          cleanupWarning: j.cleanupWarning,
          closeWarning: j.closeWarning,
          cardId: j.result?.card.id || j.cardId,
        };
        const file = join(this.root, j.id + ".json");
        await writeFile(file + ".tmp", JSON.stringify(saved), { mode: 0o600 });
        await rename(file + ".tmp", file);
      });
    return j.saving;
  }
  get(id) {
    const j = this.jobs.get(id);
    if (!j) throw failure("IMPORT_NOT_FOUND", "导入任务不存在");
    return {
      id: j.id,
      filename: j.filename,
      size: j.size,
      received: j.received,
      status: j.status,
      stage: j.stage,
      error: j.error,
      warning: j.warning,
      cleanupWarning: j.cleanupWarning,
      closeWarning: j.closeWarning,
      cardId: j.result?.card.id || j.cardId,
      preview: j.prepared
        ? { card: j.prepared.card, report: j.prepared.report }
        : undefined,
      result: j.result,
    };
  }
  asset(id, assetId) {
    const j = this.jobs.get(id),
      asset = j?.prepared?.card.assets.find((a) => a.id === assetId);
    if (!asset) throw failure("ASSET_NOT_FOUND", "预览资源不存在");
    return { ...asset, bytes: j.prepared.mediaFiles.get(assetId) };
  }
  list() {
    return [...this.jobs.keys()].map((id) => {
      const { preview, result, ...summary } = this.get(id);
      return summary;
    });
  }
  async create({ filename, size }) {
    if (this.closed) throw failure("IMPORT_CLOSED", "服务正在关闭");
    if ([...this.jobs.values()].some((j) => !terminal.has(j.status)))
      throw failure("IMPORT_BUSY", "请先完成或取消当前导入");
    if (
      typeof filename !== "string" ||
      !filename ||
      Buffer.byteLength(filename) > 255 ||
      /[\x00-\x1f\x7f/\\]/.test(filename) ||
      [".", ".."].includes(filename)
    )
      throw failure("INVALID_FILENAME", "文件名无效");
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > IMPORT_LIMITS.rawBytes
    )
      throw failure("IMPORT_LIMIT", "文件须为1字节至64 MiB");
    const j = {
      id: randomUUID(),
      filename,
      size,
      received: 0,
      status: "created",
      controller: new AbortController(),
    };
    this.jobs.set(j.id, j);
    for (const previous of this.jobs.values())
      if (previous !== j && terminal.has(previous.status))
        delete previous.result;
    for (const old of [...this.jobs.values()]
      .filter((j) => terminal.has(j.status))
      .slice(0, Math.max(0, this.jobs.size - 49))) {
      if (!(await this.cleanup(old))) {
        await this.save(old);
        continue;
      }
      await rm(join(this.root, old.id + ".json"), { force: true });
      this.jobs.delete(old.id);
    }
    if (this.jobs.size > 50) {
      this.jobs.delete(j.id);
      throw failure(
        "IMPORT_CLEANUP_PENDING",
        "导入临时文件尚未清理，请重试取消或重启后再导入。",
      );
    }
    await this.save(j);
    return this.get(j.id);
  }
  upload(id, stream) {
    const j = this.jobs.get(id);
    if (!j || j.status !== "created")
      return Promise.reject(failure("IMPORT_NOT_READY", "任务不能上传"));
    j.uploadWork = this.receive(id, stream);
    return j.uploadWork;
  }
  async receive(id, stream) {
    const j = this.jobs.get(id);
    if (!j || j.status !== "created")
      throw failure("IMPORT_NOT_READY", "任务不能上传");
    j.status = "uploading";
    j.stream = stream;
    const path = join(this.root, id + ".upload");
    let file;
    try {
      file = await open(path, "wx", 0o600);
      for await (const chunk of stream) {
        j.controller.signal.throwIfAborted();
        j.received += chunk.length;
        if (j.received > j.size)
          throw failure("IMPORT_LIMIT", "上传超过声明大小");
        await file.writeFile(chunk);
      }
      if (j.received !== j.size)
        throw failure("IMPORT_INCOMPLETE", "上传中断，请重新选择文件");
      await file.sync();
      await file.close();
      file = null;
      j.controller.signal.throwIfAborted();
      j.status = "preparing";
      await this.save(j);
      const worker = new Worker(
        new URL("./import-worker.mjs", import.meta.url),
        { workerData: { path, filename: j.filename } },
      );
      j.worker = worker;
      j.work = new Promise((resolve) => {
        let finished = false;
        const timeout = setTimeout(() => {
          finish({
            error: {
              code: "IMPORT_TIMEOUT",
              message: "解析超过30秒上限，请缩小内容包",
            },
          });
          worker.terminate();
        }, 30000);
        timeout.unref();
        const finish = async (message) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          j.worker = null;
          try {
            if (j.status !== "cancelled" && j.status !== "interrupted") {
              if (message.prepared) {
                await checkImportBudget(this.dataDir, message.prepared, j.size);
                if (j.controller.signal.aborted || this.closed) return;
                j.prepared = message.prepared;
                j.status = "ready";
              } else {
                j.error = message.error;
                j.status = "failed";
                await rm(path, { force: true });
              }
              await this.save(j);
            }
          } catch (e) {
            j.status = "failed";
            j.error = { code: e.code || "IMPORT_STORAGE", message: e.message };
            delete j.prepared;
            await this.cleanup(j);
            try {
              await this.save(j);
            } catch {
              /* Original persistence error remains visible; startup retries cleanup. */
            }
          } finally {
            resolve();
          }
        };
        worker.once("message", finish);
        worker.once("error", (e) =>
          finish({ error: { code: "IMPORT_FAILED", message: e.message } }),
        );
        worker.once("exit", (code) => {
          if (!finished)
            finish({
              error: { code: "IMPORT_INTERRUPTED", message: "解析已停止" },
            });
        });
      });
      return this.get(id);
    } catch (e) {
      if (!["cancelled", "interrupted"].includes(j.status)) {
        j.status = "failed";
        j.error = { code: e.code || "IMPORT_FAILED", message: e.message };
      }
      try {
        await file?.close();
      } catch (closeError) {
        j.closeWarning = {
          code: closeError.code || "IMPORT_CLOSE",
          message: closeError.message,
        };
      }
      await this.cleanup(j);
      try {
        await this.save(j);
      } catch {
        /* Keep the original receive error; startup reconciles the journal. */
      }
      throw e;
    }
  }
  async accept(id) {
    const j = this.jobs.get(id);
    if (j?.status === "completed") {
      j.result ??= await readCard(this.dataDir, j.cardId);
      return this.get(id);
    }
    if (!j || j.status !== "ready")
      throw failure("IMPORT_NOT_READY", "任务尚未准备完成或已取消");
    j.status = "registering";
    j.cardId = j.prepared.card.id;
    j.work = (async () => {
      try {
        await this.save(j);
        const bytes = await readFile(join(this.root, id + ".upload"));
        j.result = await importCard({
          filename: j.filename,
          bytes,
          dataDir: this.dataDir,
          prepared: j.prepared,
          signal: j.controller.signal,
          onProgress: (stage) => {
            j.stage = stage;
          },
        });
        j.warning = j.result.warning;
        j.status = "completed";
      } catch (e) {
        j.status = j.controller.signal.aborted ? "cancelled" : "failed";
        j.error = { code: e.code || "IMPORT_FAILED", message: e.message };
      } finally {
        delete j.prepared;
        await this.cleanup(j);
        await this.save(j);
      }
    })();
    await j.work;
    return this.get(id);
  }
  async cancel(id) {
    const j = this.jobs.get(id);
    if (!j) throw failure("IMPORT_NOT_FOUND", "任务不存在");
    if (terminal.has(j.status)) {
      await this.cleanup(j);
      await this.save(j);
      return this.get(id);
    }
    j.controller.abort(failure("IMPORT_CANCELLED", "已取消导入"));
    if (j.status === "registering") {
      await j.work;
      return this.get(id);
    }
    j.status = "cancelled";
    j.stream?.destroy();
    await j.uploadWork?.catch(() => {});
    await j.worker?.terminate();
    await j.work;
    delete j.prepared;
    await this.cleanup(j);
    await this.save(j);
    return this.get(id);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const j of this.jobs.values()) {
      if (terminal.has(j.status)) {
        const prior = j.cleanupWarning;
        await this.cleanup(j);
        if (prior || j.cleanupWarning) await this.save(j);
        continue;
      }
      if (j.status === "registering") {
        j.controller.abort();
        await j.work;
      } else {
        j.status = "interrupted";
        j.controller.abort();
        j.stream?.destroy();
        await j.uploadWork?.catch(() => {});
        await j.worker?.terminate();
        await j.work;
        delete j.prepared;
        await this.cleanup(j);
        await this.save(j);
      }
    }
  }
}
