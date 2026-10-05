import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../src/store.mjs";
import { runBehaviors } from "../src/behavior.mjs";
import { compileContext, visibleSnapshot } from "../src/model.mjs";
import { knowledgeBundle, searchKnowledge } from "../src/knowledge.mjs";
function fixture(
  t,
  card = {
    name: "甲",
    extensions: {
      story_runtime: {
        characters: [{ id: "b", name: "乙", location: "森林" }],
        variables: { score: 0 },
      },
    },
  },
) {
  const dir = mkdtempSync(join(tmpdir(), "review-fixes-"));
  let store = new WorldStore(dir),
    s = store.createWorld({ name: "世界", card });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get s() {
      return s;
    },
    refresh() {
      s = store.snapshot(s.world.id, s.branch.id);
      return s;
    },
    reopen() {
      store.close();
      store = new WorldStore(dir);
      return this.refresh();
    },
    commit(ops, extra = {}) {
      const result = store.commit({
        worldId: s.world.id,
        branchId: s.branch.id,
        expectedHead: s.branch.head,
        sourceRevision: s.branch.sourceRevision,
        runId: crypto.randomUUID(),
        userText: "",
        narrative: "公开故事",
        operations: ops,
        source: "author",
        author: true,
        ...extra,
      });
      s = result.snapshot;
      return result;
    },
  };
}
test("F01: run-reserved host IDs survive staging, saved draft, restart and identical retry", (t) => {
  const card = {
      name: "甲",
      extensions: {
        story_runtime: {
          rules: [
            {
              event: "input",
              operations: [{ op: "create_entity", name: "旅人" }],
            },
          ],
        },
      },
    },
    f = fixture(t, card),
    s = f.s,
    runId = "stable-create";
  f.store.saveRun({
    worldId: s.world.id,
    branchId: s.branch.id,
    runId,
    expectedHead: s.branch.head,
    sourceRevision: s.branch.sourceRevision,
    userText: "",
    mode: "demo",
    status: "accepted",
    draft: "",
  });
  const entityIds = f.store.reserveRunEntityIds(s.world.id, s.branch.id, runId),
    allocation = { entityIds, entityCursor: { index: 0 } };
  const staged = runBehaviors(card, s.state, "input", "", { ...allocation });
  const id = staged.state.characters.find((c) => c.name === "旅人").id;
  const operations = [
    ...staged.operations,
    { op: "set_location", entityId: id, value: "渡口" },
  ];
  f.store.saveRun({
    worldId: s.world.id,
    branchId: s.branch.id,
    runId,
    expectedHead: s.branch.head,
    sourceRevision: s.branch.sourceRevision,
    userText: "",
    mode: "demo",
    status: "draft",
    draft: "旅人到达渡口。",
    operations,
  });
  f.reopen();
  const input = {
    worldId: s.world.id,
    branchId: s.branch.id,
    runId,
    expectedHead: s.branch.head,
    sourceRevision: s.branch.sourceRevision,
    userText: "",
    narrative: "旅人到达渡口。",
    operations,
  };
  const result = f.store.commit(input);
  assert.equal(
    result.snapshot.state.characters.find((c) => c.id === id).location,
    "渡口",
  );
  assert.equal(f.store.commit(input).commitId, result.commitId);
  assert.equal(
    f.store
      .snapshot(s.world.id)
      .state.characters.filter((c) => c.name === "旅人").length,
    1,
  );
});
test("F02: ended relations keep IDs, lifecycle, addresses and evidence in model and knowledge", (t) => {
  const f = fixture(t);
  f.commit([
    {
      op: "add_relation",
      from: "card-main",
      to: "b",
      type: "member_of",
      addressFrom: "会长",
    },
  ]);
  const id = f.s.state.relations[0].id;
  f.commit([{ op: "end_relation", id }]);
  const text = JSON.stringify(compileContext(f.s, "关系如何？"));
  assert.ok(text.includes(id));
  assert.ok(text.includes("ended"));
  assert.ok(text.includes("validUntil"));
  assert.ok(text.includes("会长"));
  assert.match(knowledgeBundle(f.s, "author").files["relations.md"], /ended/);
  assert.equal(
    searchKnowledge(f.s, "member_of", { view: "author" })[0].status,
    "ended",
  );
});
test("F03/F05: actor-local ordinary conditions and lock conflicts cancel individual events, not the queue", (t) => {
  const f = fixture(t);
  f.commit([
    {
      op: "set_belief",
      holderId: "card-main",
      subjectId: "b",
      key: "location",
      value: "码头",
    },
    {
      op: "schedule",
      at: 1,
      entityId: "card-main",
      label: "只凭认识决定",
      precondition: { entityId: "b", location: "森林" },
      operations: [{ op: "set_variable", key: "sawTruth", value: true }],
    },
    {
      op: "schedule",
      at: 1,
      entityId: "b",
      label: "已锁目标",
      operations: [{ op: "set_location", entityId: "b", value: "渡口" }],
    },
    {
      op: "schedule",
      at: 1,
      entityId: "card-main",
      label: "合法事项",
      operations: [{ op: "set_variable", key: "score", value: 5 }],
    },
  ]);
  f.commit([{ op: "update_entity", id: "b", locked: true }]);
  const result = f.store.advance({
    worldId: f.s.world.id,
    branchId: f.s.branch.id,
    to: 1,
    maxEvents: 10,
  });
  assert.equal(result.cancelled.length, 2);
  assert.equal(result.executed.length, 1);
  const s = f.refresh();
  assert.equal(s.state.variables.sawTruth, undefined);
  assert.equal(s.state.variables.score, 5);
  assert.ok(
    s.state.schedules.find((q) => q.label === "已锁目标").cancellationReason,
  );
});

test("M1: author audit text and private main description never reach player surfaces; explicit narrative is separate", (t) => {
  const f = fixture(t, {
    name: "甲",
    description: "ORIGINAL_PRIVATE_DESCRIPTION",
  });
  f.commit(
    [
      {
        op: "set_fact",
        key: "密库",
        value: "PRIVATE_VAULT",
        visibility: "private",
        holderId: "card-main",
      },
      {
        op: "update_entity",
        id: "card-main",
        descriptionVisibility: "private",
      },
    ],
    { narrative: "AUDIT_ONLY_VAULT_DETAILS" },
  );
  for (const value of [
    visibleSnapshot(f.s),
    compileContext(f.s, "继续"),
    knowledgeBundle(f.s),
    searchKnowledge(f.s, "AUDIT_ONLY"),
  ]) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes("AUDIT_ONLY_VAULT_DETAILS"));
    assert.ok(!text.includes("ORIGINAL_PRIVATE_DESCRIPTION"));
  }
  assert.equal(visibleSnapshot(f.s).scenes.length, 0);
  assert.ok(
    JSON.stringify(visibleSnapshot(f.s, "author")).includes(
      "AUDIT_ONLY_VAULT_DETAILS",
    ),
  );
  f.commit([], {
    narrative: "SECOND_AUTHOR_AUDIT",
    publicNarrative: "玩家看到门开了。",
  });
  assert.equal(visibleSnapshot(f.s).scenes[0].narrative, "玩家看到门开了。");
  assert.ok(
    !JSON.stringify(compileContext(f.s, "继续")).includes(
      "SECOND_AUTHOR_AUDIT",
    ),
  );
  f.reopen();
  assert.equal(visibleSnapshot(f.s).scenes[0].narrative, "玩家看到门开了。");
});
test("M1 legacy author scenes without audience metadata are conservatively hidden", () => {
  const snapshot = {
    world: { card: { name: "甲", description: "old" } },
    branch: { id: "b" },
    state: {
      characters: [
        { id: "player" },
        {
          id: "card-main",
          description: "old",
          descriptionVisibility: "private",
        },
      ],
      facts: [],
      beliefs: [],
      goals: [],
      relations: [],
      inventory: [],
      variables: {},
      schedules: [],
      plotThreads: [],
    },
    scenes: [
      {
        id: "old",
        source: "author",
        narrative: "LEGACY_AUTHOR_SECRET",
        operations: [],
      },
    ],
    runs: [],
  };
  assert.ok(
    !JSON.stringify(visibleSnapshot(snapshot)).includes("LEGACY_AUTHOR_SECRET"),
  );
});

test("F04: checkpoints persist, recall early sources after 85 scenes, and change on actor privacy/fork", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 85; i++)
    f.commit([], {
      source: "demo",
      author: false,
      narrative: i === 0 ? "灯塔暗号是蓝色羽毛。" : "日常场景 " + i,
    });
  const record = f.store.prepareContextCheckpoint(
    f.s.world.id,
    f.s.branch.id,
    "player",
  );
  assert.equal(record.summaryVersion, "extractive-v2");
  assert.equal(record.coveredCommitIds.length, 60);
  f.reopen();
  assert.deepEqual(
    f.store.prepareContextCheckpoint(f.s.world.id, f.s.branch.id, "player"),
    record,
  );
  const messages = compileContext(f.s, "灯塔暗号是什么？", {
    checkpoint: record,
  });
  assert.ok(JSON.stringify(messages).includes("蓝色羽毛"));
  assert.ok(JSON.stringify(messages).includes(f.s.scenes[0].id));
  f.commit([
    { op: "update_entity", id: "card-main", descriptionVisibility: "private" },
  ]);
  const changed = f.store.prepareContextCheckpoint(
    f.s.world.id,
    f.s.branch.id,
    "player",
  );
  assert.notEqual(changed.epoch, record.epoch);
  const fork = f.store.fork({
    worldId: f.s.world.id,
    branchId: f.s.branch.id,
    commitId: null,
    name: "撤回全部剧情",
  });
  const forkRecord = f.store.prepareContextCheckpoint(
    fork.world.id,
    fork.branch.id,
    "player",
  );
  assert.notEqual(forkRecord.epoch, record.epoch);
  assert.ok(
    !JSON.stringify(
      compileContext(fork, "灯塔暗号", { checkpoint: forkRecord }),
    ).includes("蓝色羽毛"),
  );
});

test("F06: post-commit notices are durable per commit for generated and author/card paths without reexecution", (t) => {
  const card = {
      name: "甲",
      extensions: {
        story_runtime: {
          rules: [{ event: "post_commit", append: "已提交 {{getvar::score}}" }],
          variables: { score: 0 },
        },
      },
    },
    f = fixture(t, card);
  f.commit([{ op: "set_variable", key: "score", value: 1 }], {
    source: "card-action",
    author: false,
  });
  const first = f.s.notices[0];
  assert.equal(first.text, "已提交 1");
  f.commit([{ op: "set_variable", key: "score", value: 2 }], {
    narrative: "private audit",
    publicNarrative: "公共变化",
  });
  assert.equal(f.s.notices[0].text, "已提交 1");
  assert.equal(f.s.notices[1].text, "已提交 2");
  f.reopen();
  assert.deepEqual(f.s.notices[0], first);
  assert.equal(visibleSnapshot(f.s).notices.length, 2);
});

test("F01/F06 real HTTP: model references its staged host ID and reconnect replays the saved notice", async (t) => {
  const { createServer } = await import("node:http");
  const { startServer } = await import("../src/server.mjs");
  let calls = 0,
    seenId;
  const provider = createServer(async (req, res) => {
    calls++;
    let raw = "";
    for await (const c of req) raw += c;
    const request = JSON.parse(raw),
      dynamic = request.messages.find((m) =>
        m.content.startsWith("本轮公开状态"),
      ),
      state = JSON.parse(dynamic.content.split("\n")[1]);
    seenId = state.characters.find((c) => c.name === "旅人").id;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                narrative: "旅人来到渡口。",
                operations: [
                  { op: "set_location", entityId: seenId, value: "渡口" },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "staged-http-"));
  const app = await startServer({
    dataDir: dir,
    port: 0,
    env: {
      STORY_OPENAI_BASE_URL: "http://127.0.0.1:" + provider.address().port,
      STORY_OPENAI_MODEL: "local-test",
    },
  });
  t.after(async () => {
    await app.close();
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
  const card = {
    name: "甲",
    extensions: {
      story_runtime: {
        rules: [
          {
            event: "input",
            operations: [{ op: "create_entity", name: "旅人" }],
          },
          { event: "post_commit", append: "STORED_NOTICE" },
        ],
      },
    },
  };
  const imported = await call("/api/import", {
      filename: "card.json",
      base64: Buffer.from(JSON.stringify(card)).toString("base64"),
    }),
    s = await call("/api/worlds", { cardId: imported.card.id }),
    p = "/api/worlds/" + s.world.id;
  const run = await call(p + "/turn", {
    branchId: s.branch.id,
    runId: "stable-http",
    message: "继续",
    mode: "openai",
  });
  const first = await (
    await fetch(app.url + "/api/runs/" + run.runId + "/events")
  ).text();
  assert.match(first, /event: committed/);
  const after = await call(p + "?view=author");
  assert.equal(
    after.state.characters.find((c) => c.id === seenId).location,
    "渡口",
  );
  assert.equal(after.notices.length, 1);
  const replay = await (
    await fetch(app.url + "/api/runs/" + run.runId + "/events")
  ).text();
  assert.match(replay, /"postCommitNotice":"STORED_NOTICE"/);
  assert.equal(calls, 1);
});

test("F05: relation and variable locks cancel only stale schedules; unlock permits a new schedule", (t) => {
  for (const type of ["relation", "variable"]) {
    const f = fixture(t);
    f.commit([
      { op: "add_relation", from: "card-main", to: "b", type: "friend" },
    ]);
    const id = f.s.state.relations[0].id,
      change =
        type === "relation"
          ? { op: "update_relation", id, detail: "新约定" }
          : { op: "increment_variable", key: "score", amount: 1 };
    f.commit([
      {
        op: "schedule",
        at: 1,
        entityId: "card-main",
        label: type + " locked",
        operations: [change],
      },
      {
        op: "schedule",
        at: 1,
        entityId: "card-main",
        label: "other",
        operations: [{ op: "set_variable", key: "unrelated", value: true }],
      },
    ]);
    f.commit([
      type === "relation"
        ? { op: "update_relation", id, locked: true }
        : { op: "set_variable", key: "score", value: 0, locked: true },
    ]);
    const r = f.store.advance({
      worldId: f.s.world.id,
      branchId: f.s.branch.id,
      to: 1,
      maxEvents: 10,
    });
    assert.equal(r.cancelled.length, 1);
    assert.equal(r.executed.length, 1);
    f.refresh();
    assert.equal(
      f.s.state.schedules.find((q) => q.label === type + " locked")
        .cancellationReason,
      "LOCKED_FIELD",
    );
    f.commit([
      type === "relation"
        ? { op: "update_relation", id, locked: false }
        : { op: "set_variable", key: "score", value: 0, locked: false },
      {
        op: "schedule",
        at: 2,
        entityId: "card-main",
        label: "after unlock",
        operations: [change],
      },
    ]);
    assert.equal(
      f.store.advance({
        worldId: f.s.world.id,
        branchId: f.s.branch.id,
        to: 2,
        maxEvents: 10,
      }).executed.length,
      1,
    );
  }
});
test("knowledge Markdown encodes source markup rather than enabling HTML or remote image syntax", (t) => {
  const f = fixture(t);
  f.commit([], {
    narrative: "private audit",
    publicNarrative:
      "<b>literal</b> ![remote](https://example.invalid/image.png)",
  });
  const md = knowledgeBundle(f.s).files["events.md"];
  assert.ok(!md.includes("<b>"));
  assert.ok(!md.includes("![remote]"));
  assert.match(md, /\\</);
});

test("author-only reference is distinct from player-private reference and can revoke player access", (t) => {
  const f = fixture(t);
  f.commit([
    {
      op: "set_reference",
      title: "计划",
      text: "AUTHOR_REFERENCE_SENTINEL",
      visibility: "private",
      holderId: "player",
    },
  ]);
  assert.ok(
    JSON.stringify(visibleSnapshot(f.s)).includes("AUTHOR_REFERENCE_SENTINEL"),
  );
  const ref = f.s.state.references[0];
  f.commit([
    {
      op: "set_reference",
      id: ref.id,
      title: "计划",
      text: "AUTHOR_REFERENCE_SENTINEL",
      visibility: "private",
      holderId: null,
    },
  ]);
  assert.ok(
    !JSON.stringify(visibleSnapshot(f.s)).includes("AUTHOR_REFERENCE_SENTINEL"),
  );
  assert.ok(
    JSON.stringify(visibleSnapshot(f.s, "author")).includes(
      "AUTHOR_REFERENCE_SENTINEL",
    ),
  );
});

test("source-setting revisions invalidate a checkpoint even when visibility and history cutoff do not change", (t) => {
  const f = fixture(t);
  const first = f.store.prepareContextCheckpoint(f.s.world.id, f.s.branch.id);
  f.commit([
    { op: "update_entity", id: "card-main", description: "新的人物设定" },
  ]);
  const second = f.store.prepareContextCheckpoint(f.s.world.id, f.s.branch.id);
  assert.equal(second.cut, first.cut);
  assert.equal(second.visibilityVersion, first.visibilityVersion);
  assert.notEqual(second.sourceVersion, first.sourceVersion);
  assert.notEqual(second.epoch, first.epoch);
});
