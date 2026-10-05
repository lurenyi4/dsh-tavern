import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(root + "/package.json");
const { parse } = require("acorn"),
  { JSDOM } = require("jsdom");
const source = readFileSync(root + "/world-runtime/public/app.js", "utf8");
const ast = parse(source, { ecmaVersion: "latest" });
function fn(name) {
  const n = ast.body.find(
    (n) => n.type === "FunctionDeclaration" && n.id.name === name,
  );
  assert.ok(n);
  return source.slice(n.start, n.end);
}
const warning = {
  code: "RUN_PERSISTENCE",
  storageCode: "EIO",
  message: "已取消，但取消状态尚未保存。请检查本地存储后再恢复运行。",
};
test("current cancelled SSE handler displays unsaved warning", () => {
  const events = new Map(),
    calls = [];
  const context = {
    state: { active: null },
    EventSource: class {
      addEventListener(k, fn) {
        events.set(k, fn);
      }
    },
    renderActive() {},
    finishRun(...v) {
      calls.push(v);
    },
  };
  vm.createContext(context);
  vm.runInContext(fn("runStatusMessage") + "\n" + fn("watchRun"), context);
  context.watchRun("ordinary-token", {});
  events.get("cancelled")({
    data: JSON.stringify({ persisted: false, persistenceWarning: warning }),
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].includes(warning.message));
  assert.ok(calls[0][0].includes("未提交草稿不会改变世界"));
  assert.equal(calls[0][1], true);
});
test("history renders persistence warning supplied by snapshot after returning to world", () => {
  const dom = new JSDOM('<div id="runHistory"></div>');
  const document = dom.window.document;
  const context = {
    state: {
      viewPending: false,
      snapshot: {
        runs: [
          {
            status: "cancelled",
            updatedAt: "2026-10-05T00:00:00Z",
            draft: "ordinary draft",
            persistenceWarning: warning,
            canRetrySettlement: false,
          },
        ],
      },
    },
    $: (id) => document.getElementById(id),
    el: (tag, text) => {
      const n = document.createElement(tag);
      n.textContent = text ?? "";
      return n;
    },
    button: () => assert.fail("cancelled warning must not offer retry"),
  };
  vm.createContext(context);
  vm.runInContext(fn("runStatusMessage") + "\n" + fn("renderRuns"), context);
  context.renderRuns();
  const actual = document.getElementById("runHistory").textContent;
  console.log("Actual cancelled history:", actual);
  assert.ok(
    actual.includes(warning.message),
    "Snapshot persistence warning should remain visible in run history",
  );
  dom.window.close();
});

for (const unsaved of [true, false])
  test(
    "loadWorld re-entry displays terminal cancellation without reconnect; unsaved=" +
      unsaved,
    async () => {
      const dom = new JSDOM(
          '<div id="runHistory"></div><textarea id="messageInput"></textarea>',
        ),
        document = dom.window.document;
      const run = {
        status: "cancelled",
        updatedAt: "2026-10-05T00:00:00Z",
        draft: "retained draft",
        error: { message: "separate diagnostic" },
        canRetrySettlement: false,
        ...(unsaved ? { persistenceWarning: warning } : {}),
      };
      const requests = [];
      const context = {
        URLSearchParams,
        clearTimeout,
        localStorage: { setItem() {} },
        state: {
          request: 0,
          author: false,
          active: null,
          viewPending: false,
          snapshot: null,
        },
        api: async (path) => {
          requests.push(path);
          return {
            world: { id: "ordinary", name: "Local world" },
            branch: { id: "main" },
            runs: path.includes("/other?") ? [] : [run],
          };
        },
        $: (id) => document.getElementById(id),
        el: (tag, text) => {
          const n = document.createElement(tag);
          n.textContent = text ?? "";
          return n;
        },
        button: () => assert.fail("cancelled history should not offer retry"),
        watchRun: () => assert.fail("terminal re-entry must not reconnect"),
        renderLists() {},
        renderWorld() {
          context.renderRuns();
        },
      };
      vm.createContext(context);
      vm.runInContext(
        fn("runStatusMessage") +
          "\n" +
          fn("renderRuns") +
          "\n" +
          fn("loadWorld"),
        context,
      );
      await context.loadWorld("ordinary", "main");
      await context.loadWorld("other", "main");
      assert.equal(document.getElementById("runHistory").textContent, "");
      await context.loadWorld("ordinary", "main");
      const history = document.getElementById("runHistory");
      assert.ok(history.textContent.includes("未提交草稿不会改变世界"));
      assert.ok(history.textContent.includes("separate diagnostic"));
      assert.ok(history.textContent.includes("retained draft"));
      assert.equal(history.textContent.includes(warning.message), unsaved);
      assert.equal(
        history.querySelector("summary").textContent.includes("状态尚未保存"),
        unsaved,
      );
      assert.equal(requests.length, 3);
      dom.window.close();
    },
  );
test("normally persisted cancelled SSE uses the same explanation without a warning", () => {
  const events = new Map(),
    calls = [];
  const context = {
    state: { active: null },
    EventSource: class {
      addEventListener(k, f) {
        events.set(k, f);
      }
    },
    renderActive() {},
    finishRun(...v) {
      calls.push(v);
    },
  };
  vm.createContext(context);
  vm.runInContext(fn("runStatusMessage") + "\n" + fn("watchRun"), context);
  context.watchRun("normal", {});
  events.get("cancelled")({ data: JSON.stringify({ persisted: true }) });
  assert.deepEqual(calls, [["已取消，未提交草稿不会改变世界。", false]]);
});
