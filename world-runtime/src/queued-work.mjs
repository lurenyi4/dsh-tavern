/** Own deferred work from admission until settlement, including cancelled starts. */
export function queueOwnedWork(tasks, { canStart, start, cancel }) {
  let resolve, reject;
  const work = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  tasks.add(work);
  const finished = () => tasks.delete(work);
  // Both continuations are attached before the callback can execute.
  work.then(finished, finished);
  setImmediate(async () => {
    try {
      resolve(await (canStart() ? start() : cancel()));
    } catch (error) {
      reject(error);
    }
  });
  return work;
}

/** Report cancellation independently from whether its record could be saved. */
export async function cancelQueuedRun(run, { save, notify }) {
  run.status = "cancelled";
  try {
    await save(run);
    delete run.persistenceWarning;
  } catch (error) {
    run.persistenceWarning = {
      code: "RUN_PERSISTENCE",
      storageCode:
        typeof error?.code === "string" ? error.code : "STORAGE_ERROR",
      message: "已取消，但取消状态尚未保存。请检查本地存储后再恢复运行。",
    };
  }
  const outcome = { persisted: !run.persistenceWarning };
  if (run.persistenceWarning)
    outcome.persistenceWarning = run.persistenceWarning;
  await notify(outcome);
  return outcome;
}
