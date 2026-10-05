import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WorldStore } from "../src/store.mjs";
import { runBehaviors } from "../src/behavior.mjs";
import { startServer } from "../src/server.mjs";
import { injectStoreFaultForTests } from "../src/store-test-support.mjs";
const card = {
  name: "甲",
  extensions: {
    story_runtime: {
      characters: [{ id: "b", name: "乙" }],
      rules: [
        {
          event: "before_generate",
          operations: [
            { op: "add_relation", from: "card-main", to: "b", type: "同伴" },
            { op: "add_relation", from: "card-main", to: "b", type: "同伴" },
            { op: "set_goal", entityId: "card-main", text: "同行到渡口" },
            { op: "set_plot_thread", label: "渡口旧约", status: "planted" },
            {
              op: "schedule",
              at: 20,
              entityId: "card-main",
              label: "等船",
              operations: [],
            },
          ],
        },
      ],
    },
  },
};
function payload(s, runId, operations, narrative = "渡口的故事") {
  return {
    worldId: s.world.id,
    branchId: s.branch.id,
    expectedHead: s.branch.head,
    sourceRevision: s.branch.sourceRevision,
    runId,
    userText: "继续",
    narrative,
    operations,
  };
}
function runPayload(s, runId, operations) {
  const { narrative, ...rest } = payload(s, runId, operations);
  return rest;
}
test("S2-01: every staged record identity survives a real model request, failed commit, restart and settlement-only retry", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "record-identities-http-"));
  let app,
    calls = 0,
    offered;
  const provider = createServer(async (req, res) => {
    calls++;
    let raw = "";
    for await (const c of req) raw += c;
    const request = JSON.parse(raw);
    offered = JSON.parse(
      request.messages
        .find((m) => m.content.startsWith("本轮公开状态"))
        .content.split("\n")[1],
    );
    const rel = offered.relations[0],
      goal = offered.goals[0],
      plot = offered.plotThreads[0];
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                narrative: "两人结束同行，留下新的约定。",
                operations: [
                  { op: "update_relation", id: rel.id, detail: "完成同行" },
                  { op: "end_relation", id: rel.id },
                  {
                    op: "add_relation",
                    from: "card-main",
                    to: "b",
                    type: "同伴",
                    detail: "新的同行",
                  },
                  {
                    op: "set_goal",
                    id: goal.id,
                    entityId: "card-main",
                    text: goal.text,
                    status: "achieved",
                  },
                  {
                    op: "set_plot_thread",
                    id: plot.id,
                    label: plot.label,
                    status: "partially_resolved",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const env = {
    STORY_OPENAI_BASE_URL: "http://127.0.0.1:" + provider.address().port,
    STORY_OPENAI_MODEL: "local-test",
  };
  app = await startServer({ dataDir: dir, port: 0, env });
  t.after(async () => {
    await app?.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, data) => {
    const r = await fetch(
      app.url + path,
      data
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(data),
          }
        : undefined,
    );
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  };
  const imported = await call("/api/import", {
      filename: "records.json",
      base64: Buffer.from(JSON.stringify(card)).toString("base64"),
    }),
    s = await call("/api/worlds", { cardId: imported.card.id }),
    path = "/api/worlds/" + s.world.id;
  injectStoreFaultForTests(app.store, (point) => {
    if (point === "after-state")
      throw Object.assign(new Error("test rollback"), {
        code: "TEST_COMMIT_FAILURE",
      });
  });
  const run = await call(path + "/turn", {
    branchId: s.branch.id,
    runId: "record-turn",
    message: "继续",
    mode: "openai",
  });
  const failedEvents = await (
    await fetch(app.url + "/api/runs/" + run.runId + "/events")
  ).text();
  assert.match(failedEvents, /TEST_COMMIT_FAILURE/);
  assert.doesNotMatch(failedEvents, /UNKNOWN_REFERENCE/);
  assert.equal((await call(path + "?view=author")).state.relations.length, 0);
  await app.close();
  app = await startServer({ dataDir: dir, port: 0, env });
  const retry = await call("/api/runs/" + run.runId + "/retry", {});
  const events = await (
    await fetch(app.url + "/api/runs/" + retry.runId + "/events")
  ).text();
  assert.match(events, /event: committed/);
  const final = await call(path + "?view=author");
  assert.equal(calls, 1);
  assert.equal(final.state.relations.length, 2);
  assert.equal(final.state.relations[0].id, offered.relations[0].id);
  assert.equal(final.state.relations[0].status, "ended");
  assert.equal(final.state.relations[1].status, "active");
  assert.notEqual(final.state.relations[1].id, offered.relations[0].id);
  assert.equal(final.state.goals[0].id, offered.goals[0].id);
  assert.equal(final.state.goals[0].status, "achieved");
  assert.equal(final.state.plotThreads[0].id, offered.plotThreads[0].id);
});
test("S2-02: due deltas use effective event time atomically across several events, cancellation, reopen and fork", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "due-event-time-"));
  let store = new WorldStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let s = store.createWorld({
    name: "时间线",
    card: {
      name: "甲",
      extensions: { story_runtime: { characters: [{ id: "b", name: "乙" }] } },
    },
  });
  s = store.commit({
    ...payload(s, "seed", [
      { op: "add_relation", from: "card-main", to: "b", type: "同事" },
    ]),
    author: true,
  }).snapshot;
  const relation = s.state.relations[0].id;
  s = store.commit({
    ...payload(s, "plans", [
      {
        op: "schedule",
        at: 10,
        entityId: "card-main",
        label: "十时约定",
        operations: [
          { op: "end_relation", id: relation },
          { op: "add_relation", from: "card-main", to: "b", type: "朋友" },
          {
            op: "observe",
            holderId: "card-main",
            subjectId: "b",
            key: "location",
            value: "渡口",
          },
        ],
      },
      {
        op: "schedule",
        at: 15,
        entityId: "card-main",
        label: "锁定动作",
        operations: [{ op: "set_location", entityId: "b", value: "不应抵达" }],
      },
      {
        op: "schedule",
        at: 20,
        entityId: "card-main",
        label: "二十时观察",
        operations: [
          {
            op: "observe",
            holderId: "card-main",
            subjectId: "b",
            key: "location",
            value: "广场",
          },
        ],
      },
      { op: "update_entity", id: "b", locked: true },
    ]),
    author: true,
  }).snapshot;
  const r = store.advance({
    worldId: s.world.id,
    branchId: s.branch.id,
    to: 25,
    maxEvents: 10,
  });
  assert.equal(r.executed.length, 2);
  assert.equal(r.cancelled.length, 1);
  let final = store.snapshot(s.world.id, s.branch.id);
  assert.equal(final.state.relations[0].validUntil, 10);
  assert.equal(
    final.state.relations.find((x) => x.type === "朋友").validFrom,
    10,
  );
  assert.equal(final.state.beliefs[0].knownSince, 20);
  assert.equal(final.state.time, 25);
  const first = final.scenes.find(
    (x) => x.source === "schedule" && x.narrative === "十时约定",
  );
  store.close();
  store = new WorldStore(dir);
  final = store.snapshot(s.world.id, s.branch.id);
  assert.equal(final.state.beliefs[0].knownSince, 20);
  const fork = store.fork({
    worldId: s.world.id,
    branchId: s.branch.id,
    commitId: first.id,
    name: "十时分支",
  });
  assert.equal(fork.state.time, 10);
  assert.equal(fork.state.beliefs[0].knownSince, 10);
});

test("uniform operation identities cover facts/goals/plots/schedules and do not depend on dedup allocation counts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "record-family-"));
  let store = new WorldStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const definition = {
    name: "甲",
    extensions: {
      story_runtime: {
        characters: [{ id: "b", name: "乙" }],
        rules: [
          {
            event: "input",
            operations: [
              { op: "set_fact", key: "信物", value: "旧值" },
              { op: "set_fact", key: "信物", value: "旧值" },
              { op: "set_goal", entityId: "card-main", text: "约定" },
              { op: "set_plot_thread", label: "线索", status: "planted" },
              {
                op: "schedule",
                at: 5,
                entityId: "card-main",
                label: "等待",
                operations: [],
              },
            ],
          },
        ],
      },
    },
  };
  const s = store.createWorld({ name: "记录身份", card: definition }),
    runId = "all-families";
  store.saveRun({
    ...runPayload(s, runId, []),
    mode: "demo",
    status: "accepted",
    draft: "",
  });
  const allocation = {
      identitySeed: store.reserveRunIdentity(s.world.id, s.branch.id, runId),
      operationCursor: { index: 0 },
    },
    stage = runBehaviors(definition, s.state, "input", "继续", allocation);
  const operations = [
    ...stage.operations,
    { op: "set_fact", id: stage.state.facts[0].id, key: "信物", value: "新值" },
    {
      op: "set_goal",
      id: stage.state.goals[0].id,
      entityId: "card-main",
      text: "约定",
      status: "achieved",
    },
    {
      op: "set_plot_thread",
      id: stage.state.plotThreads[0].id,
      label: "线索",
      status: "resolved",
    },
    { op: "cancel_schedule", id: stage.state.schedules[0].id },
  ];
  store.saveRun({
    ...runPayload(s, runId, operations),
    mode: "demo",
    status: "draft",
    draft: "保存的结构化草稿",
  });
  store.close();
  store = new WorldStore(dir);
  const result = store.commit(payload(s, runId, operations));
  for (const collection of ["facts", "goals", "plotThreads", "schedules"])
    assert.equal(
      result.snapshot.state[collection][0].id,
      stage.state[collection][0].id,
    );
  assert.equal(result.snapshot.state.facts.length, 1);
  assert.equal(result.snapshot.state.schedules[0].status, "cancelled");
  assert.equal(
    store.commit(payload(s, runId, operations)).commitId,
    result.commitId,
  );
});
test("cancelled staged records cannot enter canon or be settled after reopening", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "record-cancel-"));
  let store = new WorldStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const s = store.createWorld({ name: "取消", card }),
    runId = "cancel-records";
  store.saveRun({
    ...runPayload(s, runId, []),
    mode: "demo",
    status: "accepted",
    draft: "",
  });
  const allocation = {
      identitySeed: store.reserveRunIdentity(s.world.id, s.branch.id, runId),
      operationCursor: { index: 0 },
    },
    stage = runBehaviors(card, s.state, "before_generate", "继续", allocation);
  store.saveRun({
    ...runPayload(s, runId, stage.operations),
    mode: "demo",
    status: "cancelled",
    draft: "未保存的故事",
  });
  store.close();
  store = new WorldStore(dir);
  assert.throws(() => store.commit(payload(s, runId, stage.operations)), {
    code: "RUN_CANCELLED",
  });
  assert.equal(
    store.snapshot(s.world.id, s.branch.id).state.relations.length,
    0,
  );
});
test("due-event failure rolls back effective time and all earlier deltas in the same advance", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "time-rollback-"));
  const store = new WorldStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let s = store.createWorld({ name: "回滚", card: { name: "甲" } });
  s = store.commit({
    ...payload(s, "plan-time", [
      {
        op: "schedule",
        at: 10,
        entityId: "card-main",
        label: "十时",
        operations: [
          {
            op: "set_belief",
            holderId: "card-main",
            subjectId: "player",
            key: "time",
            value: 10,
          },
        ],
      },
      {
        op: "schedule",
        at: 20,
        entityId: "card-main",
        label: "二十时",
        operations: [
          {
            op: "set_belief",
            holderId: "card-main",
            subjectId: "player",
            key: "time",
            value: 20,
          },
        ],
      },
    ]),
    author: true,
  }).snapshot;
  let writes = 0;
  injectStoreFaultForTests(store, (stage) => {
    if (stage === "after-state" && ++writes === 2)
      throw Object.assign(new Error("test second event failure"), {
        code: "TEST_SECOND_EVENT",
      });
  });
  assert.throws(
    () =>
      store.advance({
        worldId: s.world.id,
        branchId: s.branch.id,
        to: 20,
        maxEvents: 10,
      }),
    { code: "TEST_SECOND_EVENT" },
  );
  assert.deepEqual(store.snapshot(s.world.id, s.branch.id).state, s.state);
  injectStoreFaultForTests(store, null);
  store.advance({
    worldId: s.world.id,
    branchId: s.branch.id,
    to: 20,
    maxEvents: 10,
  });
  assert.equal(
    store.snapshot(s.world.id, s.branch.id).state.beliefs[0].knownSince,
    20,
  );
});

test("a restored overdue queue uses current world time rather than backdating to its due time", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "overdue-queue-"));
  let store = new WorldStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const s = store.createWorld({
    name: "恢复的逾期队列",
    card: {
      name: "甲",
      extensions: {
        story_runtime: {
          schedules: [
            {
              at: 10,
              entityId: "card-main",
              label: "逾期观察",
              operations: [
                {
                  op: "observe",
                  holderId: "card-main",
                  subjectId: "player",
                  key: "arrival",
                  value: "已到达",
                },
                {
                  op: "add_relation",
                  from: "card-main",
                  to: "player",
                  type: "见过",
                },
              ],
            },
          ],
        },
      },
    },
  });
  store.close();
  const db = new DatabaseSync(join(dir, "world.sqlite"));
  const overdue = { ...s.state, time: 20 };
  db.prepare("UPDATE branches SET state_json=? WHERE id=?").run(
    JSON.stringify(overdue),
    s.branch.id,
  );
  db.prepare("UPDATE worlds SET genesis_json=? WHERE id=?").run(
    JSON.stringify(overdue),
    s.world.id,
  );
  db.close();
  store = new WorldStore(dir);
  store.advance({
    worldId: s.world.id,
    branchId: s.branch.id,
    to: 20,
    maxEvents: 10,
  });
  const final = store.snapshot(s.world.id, s.branch.id);
  assert.equal(final.state.time, 20);
  assert.equal(final.state.beliefs[0].knownSince, 20);
  assert.equal(final.state.relations[0].validFrom, 20);
});

test("actor context supplies stable IDs for its own scheduled records while another actor cannot see them", async () => {
  const { compileContext } = await import("../src/model.mjs");
  const { initialState } = await import("../src/domain-state.mjs");
  const { randomUUID } = await import("node:crypto");
  const allocation = {
      identitySeed: randomUUID(),
      operationCursor: { index: 0 },
    },
    stage = runBehaviors(
      card,
      initialState(card),
      "before_generate",
      "",
      allocation,
    ),
    snapshot = {
      world: { id: "w", card },
      branch: { id: "branch", sourceRevision: "revision" },
      state: stage.state,
      scenes: [],
      runs: [],
      usage: [],
    };
  const own = JSON.stringify(
      compileContext(snapshot, "取消等船", { actorId: "card-main" }),
    ),
    other = JSON.stringify(
      compileContext(snapshot, "继续", { actorId: "player" }),
    );
  assert.ok(own.includes(stage.state.schedules[0].id));
  assert.ok(!other.includes(stage.state.schedules[0].id));
});
