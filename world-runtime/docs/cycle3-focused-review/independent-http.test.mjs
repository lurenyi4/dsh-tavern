import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WorldStore } from "../../src/store.mjs";
import { runBehaviors } from "../../src/behavior.mjs";
import { startServer } from "../../src/server.mjs";
import { injectStoreFaultForTests } from "../../src/store-test-support.mjs";
const card = {
  name: "甲",
  extensions: {
    story_runtime: {
      characters: [{ id: "b", name: "乙" }],
      rules: [
        {event: "input", operations: [
          {op: "set_fact", key: "信物", value: "旧铜铃"},
          {op: "set_fact", key: "信物", value: "旧铜铃"},
          {op: "schedule", entityId: "player", at: 10, label: "玩家等船", operations: []},
          {op: "set_goal", entityId: "player", text: "归还信物"},
        ]},
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
test("Independent HTTP: input facts/player schedule + pre relations/goal/plot retain exact supplied IDs through failed write/reopen/retry", async (t) => {
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
      goal = offered.goals.find(g=>g.text==="同行到渡口"),
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
                  {op: "set_fact", id: offered.facts.find(f=>f.key==="信物").id, key: "信物", value: "已归还"},
                  {op: "cancel_schedule", id: offered.schedules.find(q=>q.label==="玩家等船").id},
                  {op: "set_goal", id: offered.goals.find(g=>g.text==="归还信物").id, entityId: "player", text: "归还信物", status: "achieved"},
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
  for (const family of ["facts","goals","plotThreads","schedules"]) {
    for (const record of offered[family]) {
      assert.ok(final.state[family].some(r=>r.id===record.id), family+" exact ID survives");
    }
  }
  assert.equal(final.state.facts.find(f=>f.key==="信物").value,"已归还");
  assert.equal(final.state.schedules.find(q=>q.label==="玩家等船").status,"cancelled");
  assert.equal(final.state.goals.find(g=>g.text==="同行到渡口").status,"achieved");
  console.log(JSON.stringify({calls, suppliedIds:Object.fromEntries(["relations","facts","goals","plotThreads","schedules"].map(k=>[k,offered[k].map(v=>v.id)])), committedScenes:final.scenes.length, retryCommitted:true}));
  assert.equal(final.state.plotThreads[0].id, offered.plotThreads[0].id);
});
