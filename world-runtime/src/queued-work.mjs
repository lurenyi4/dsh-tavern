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
