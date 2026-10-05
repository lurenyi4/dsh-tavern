import http from "node:http";
import { readFile, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WorldStore } from "./store.mjs";
import { HostProjection } from "./host.mjs";
import { importCard, listCards, readCard, assetPath } from "./importer.mjs";
import {
  visibleSnapshot,
  compileContext,
  demoGenerate,
  openAIGenerate,
  openAIConfig,
  publicDraft,
} from "./model.mjs";
import { createBackup } from "./backup.mjs";
import {
  manualPrices,
  usageReport,
  prefixDiagnostic,
} from "./observability.mjs";
import { runBehaviors } from "./behavior.mjs";
import { applyOperations, clone } from "./domain-state.mjs";
import {
  knowledgeBundle,
  searchKnowledge,
  chapterSummaries,
} from "./knowledge.mjs";
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const err = (code, message, status = 400) =>
  Object.assign(new Error(message), { code, status });
const tokenOf = (r) =>
  Buffer.from(JSON.stringify([r.worldId, r.branchId, r.runId])).toString(
    "base64url",
  );
function tokenParts(token) {
  try {
    if (token.length > 500 || !/^[A-Za-z0-9_-]+$/.test(token)) throw 0;
    const a = JSON.parse(Buffer.from(token, "base64url").toString());
    if (
      !Array.isArray(a) ||
      a.length !== 3 ||
      a.some((x) => typeof x !== "string" || x.length > 128)
    )
      throw 0;
    return a;
  } catch {
    throw err("RUN_NOT_FOUND", "运行标识无效", 404);
  }
}
const runShape = (r) =>
  Object.fromEntries(
    [
      "worldId",
      "branchId",
      "runId",
      "expectedHead",
      "sourceRevision",
      "userText",
      "mode",
      "status",
      "draft",
      "operations",
      "error",
    ]
      .filter((k) => r[k] !== undefined)
      .map((k) => [k, r[k]]),
  );
const safeError = (e) => ({
  code: typeof e.code === "string" ? e.code : "INTERNAL_ERROR",
  message:
    typeof e.code === "string"
      ? String(e.message).slice(0, 600)
      : "操作未完成；存档保留，请查看本地运行记录。",
});
const json = (res, status, value) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req, limit = 32 * 1024 * 1024) {
  let size = 0,
    parts = [];
  for await (const p of req) {
    size += p.length;
    if (size > limit)
      throw err("BODY_TOO_LARGE", "文件或请求超出大小限制", 413);
    parts.push(p);
  }
  try {
    const v = JSON.parse(Buffer.concat(parts).toString() || "{}");
    if (!v || Array.isArray(v) || typeof v !== "object") throw 0;
    return v;
  } catch {
    throw err("INVALID_JSON", "请求需要有效JSON对象");
  }
}
export async function startServer({
  dataDir,
  port = 3089,
  host = "127.0.0.1",
  runtimeDir,
  demoDelay = 22,
  env = process.env,
} = {}) {
  if (host !== "127.0.0.1")
    throw err("BIND_RESTRICTED", "当前单用户版本只允许绑定127.0.0.1");
  dataDir = resolve(dataDir || join(process.cwd(), ".story-runtime-data"));
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lock = join(dataDir, ".server-lock");
  try {
    await mkdir(lock);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let old;
    try {
      old = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    } catch {
      throw err(
        "DATA_IN_USE",
        "数据目录有未确认锁；请检查其他进程，勿并行启动。",
      );
    }
    try {
      process.kill(old.pid, 0);
      throw err("DATA_IN_USE", "此数据目录已由另一进程使用。");
    } catch (x) {
      if (x.code !== "ESRCH") throw x;
    }
    await rm(lock, { recursive: true });
    await mkdir(lock);
  }
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  let store, projection, server;
  const live = new Map(),
    jobs = new Set(),
    auto = new Map(),
    hostErrors = new Map();
  let stopped = false;
  const prices = manualPrices(env),
    contextHistory = new Map(),
    contextReports = new Map();
  const config = openAIConfig(env),
    notify = (run, type, value) => {
      const message = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
      for (const res of run.clients) {
        if (!res.destroyed) res.write(message);
        if (["committed", "cancelled", "error"].includes(type)) res.end();
      }
      if (["committed", "cancelled", "error"].includes(type))
        run.clients.clear();
    };
  const currentAuto = (w, b) => {
    const a = auto.get(w + ":" + b);
    return a
      ? {
          enabled: a.enabled,
          maxEvents: a.maxEvents,
          remainingEvents: a.remainingEvents,
          endsAt: a.endsAt,
          lastError: a.lastError || null,
        }
      : { enabled: false };
  };
  const view = (snap, mode = "player") => {
    const out = visibleSnapshot(snap, mode);
    out.runs = (out.runs || []).map((r) => ({
      ...r,
      token: tokenOf(r),
      canRetrySettlement:
        ["failed", "interrupted", "draft"].includes(r.status) &&
        !!r.draft &&
        Array.isArray(snap.runs?.find((x) => x.runId === r.runId)?.operations),
    }));
    out.usageSummary = usageReport(snap.usage, prices);
    out.contextDiagnostic =
      contextReports.get(snap.world.id + ":" + snap.branch.id) || null;
    out.autonomy = currentAuto(snap.world.id, snap.branch.id);
    out.projectionError =
      hostErrors.get(snap.world.id + ":" + snap.branch.id) || null;
    return out;
  };
  const snap = (w, b, v) => view(store.snapshot(w, b), v);
  const busy = (w, b) =>
    [...live.values()].some(
      (r) =>
        r.worldId === w &&
        r.branchId === b &&
        ![
          "committed",
          "failed",
          "cancelled",
          "interrupted",
          "projecting",
        ].includes(r.status),
    );
  const requireIdle = (w, b) => {
    if (busy(w, b))
      throw err("WORLD_BUSY", "这一分支正在生成，请先取消或等待完成。", 409);
  };
  const drain = async (w, b) => {
    try {
      await projection.drain(store, w, b);
      hostErrors.delete(w + ":" + b);
    } catch (e) {
      hostErrors.set(w + ":" + b, safeError(e));
    }
    return store.snapshot(w, b);
  };
  function savedRun(token) {
    const [w, b, id] = tokenParts(token);
    const r = store.getRun(w, b, id);
    if (!r) throw err("RUN_NOT_FOUND", "找不到这次运行", 404);
    return r;
  }
  const endSnapshot = async (run) => {
    const s = await drain(run.worldId, run.branchId);
    run.status = "committed";
    const postCommitNotice =
      s.notices?.find((n) => n.runId === run.runId)?.text || "";
    notify(run, "committed", {
      postCommitNotice,
      snapshot: view(s),
      projectionPending: !!hostErrors.get(run.worldId + ":" + run.branchId),
    });
  };
  function launch(run, retry = false) {
    const job = (async () => {
      let attemptId = null,
        usage = null,
        attemptRecorded = false;
      try {
        if (retry) {
          if (!run.draft || !Array.isArray(run.operations))
            throw err(
              "NO_SETTLEMENT_DRAFT",
              "没有可安全重试的结构化草稿；请查看草稿或在新分支重新生成。",
            );
        } else {
          run.status = "generating";
          store.saveRun(runShape(run));
          notify(run, "status", { status: "generating" });
          const original = store.snapshot(run.worldId, run.branchId),
            card = original.world.card;
          const allocation = {
            entityIds: store.reserveRunEntityIds(
              run.worldId,
              run.branchId,
              run.runId,
            ),
            entityCursor: { index: 0 },
          };
          const input = runBehaviors(
              card,
              original.state,
              "input",
              run.userText,
              allocation,
            ),
            pre = runBehaviors(
              card,
              input.state,
              "before_generate",
              input.text,
              allocation,
            );
          const before = { ...original, state: pre.state };
          const checkpoint = store.prepareContextCheckpoint(
            run.worldId,
            run.branchId,
            "player",
            pre.state,
          );
          let generated;
          if (run.mode === "openai") {
            const scope = {
                worldId: run.worldId,
                branchId: run.branchId,
                actorId: "player",
                sourceRevision: run.sourceRevision,
              },
              key = run.worldId + ":" + run.branchId,
              messages = compileContext(before, pre.text, { checkpoint });
            contextReports.set(
              key,
              prefixDiagnostic(contextHistory.get(key), messages, scope),
            );
            contextHistory.set(key, { messages, scope });
            if (contextHistory.size > 32) {
              const oldest = contextHistory.keys().next().value;
              contextHistory.delete(oldest);
              contextReports.delete(oldest);
            }
          }
          attemptId = randomUUID();
          store.recordAttempt({
            worldId: run.worldId,
            branchId: run.branchId,
            runId: run.runId,
            attemptId,
            mode: run.mode,
            status: "started",
          });
          if (run.mode === "demo")
            generated = await demoGenerate(before, pre.text, {
              signal: run.controller.signal,
              delay: demoDelay,
              onDelta: (text) => {
                run.draft += text;
                store.saveRun(runShape(run));
                notify(run, "delta", { text });
              },
            });
          else
            generated = await openAIGenerate(before, pre.text, {
              signal: run.controller.signal,
              config,
              checkpoint,
              onDraft: (text) => {
                if (run.draft !== text) {
                  run.draft = text;
                  store.saveRun(runShape(run));
                }
                notify(run, "draft", { text });
              },
            });
          usage = generated.usage;
          const staged = clone(pre.state);
          applyOperations(staged, generated.operations, {
            author: false,
            dryRun: true,
            ...allocation,
          });
          const output = runBehaviors(
            card,
            staged,
            "model_output",
            generated.narrative,
            allocation,
          );
          usage = generated.usage;
          run.draft = output.text;
          run.operations = [
            ...input.operations,
            ...pre.operations,
            ...generated.operations,
            ...output.operations,
          ];
          store.recordAttempt({
            worldId: run.worldId,
            branchId: run.branchId,
            runId: run.runId,
            attemptId,
            mode: run.mode,
            status: "completed",
            ...usage,
          });
          attemptRecorded = true;
        }
        if (run.controller.signal.aborted) throw err("CANCELLED", "已取消生成");
        run.status = "draft";
        store.saveRun(runShape(run));
        notify(run, "draft", { text: run.draft });
        if (run.controller.signal.aborted) throw err("CANCELLED", "已取消生成");
        store.commit({
          worldId: run.worldId,
          branchId: run.branchId,
          runId: run.runId,
          expectedHead: run.expectedHead,
          sourceRevision: run.sourceRevision,
          userText: run.userText,
          narrative: run.draft,
          operations: run.operations,
          source: run.mode === "demo" ? "demo" : "openai",
        });
        run.status = "projecting";
        notify(run, "status", { status: "projecting" });
        await endSnapshot(run);
      } catch (e) {
        const saved = store.getRun(run.worldId, run.branchId, run.runId);
        if (saved?.status === "committed") {
          await endSnapshot(run);
          return;
        }
        run.status =
          run.controller.signal.aborted || e.code === "CANCELLED"
            ? "cancelled"
            : "failed";
        run.error = safeError(e);
        try {
          store.saveRun(runShape(run));
        } catch (x) {
          run.error = safeError(x);
        }
        if (attemptId && !attemptRecorded) {
          try {
            store.recordAttempt({
              worldId: run.worldId,
              branchId: run.branchId,
              runId: run.runId,
              attemptId,
              mode: run.mode,
              status: run.status === "cancelled" ? "cancelled" : "failed",
              ...(usage || e.usage || {}),
              error: run.error,
            });
          } catch {}
        }
        notify(
          run,
          run.status === "cancelled" ? "cancelled" : "error",
          run.status === "cancelled" ? {} : run.error,
        );
      }
    })();
    jobs.add(job);
    job.finally(() => {
      jobs.delete(job);
      if (
        ["committed", "failed", "cancelled", "interrupted"].includes(run.status)
      )
        live.delete(tokenOf(run));
    });
    return job;
  }
  try {
    store = new WorldStore(dataDir);
    projection = await HostProjection.open(dataDir, { runtimeDir });
    for (const w of store.listWorlds()) {
      const first = store.snapshot(w.id);
      for (const b of first.branches) {
        for (const r of store.listRuns(w.id, b.id)) {
          if (["accepted", "generating", "draft"].includes(r.status))
            store.saveRun({
              ...runShape(r),
              status: "interrupted",
              error: {
                code: "PROCESS_INTERRUPTED",
                message: "进程已重启；未自动重新调用模型。",
              },
            });
        }
        for (const u of store.snapshot(w.id, b.id).usage) {
          if (u.status === "started")
            store.recordAttempt({
              worldId: w.id,
              branchId: b.id,
              ...u,
              status: "failed",
              error: {
                code: "PROCESS_INTERRUPTED",
                message: "客户端已重启；实际供应商用量仍未知，未重新调用模型。",
              },
            });
        }
        await drain(w.id, b.id);
      }
    }
    server = http.createServer(async (req, res) => {
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      try {
        const address = server.address();
        const accepted = new Set([
          `127.0.0.1:${address.port}`,
          `localhost:${address.port}`,
        ]);
        if (!accepted.has(req.headers.host))
          throw err("HOST_REJECTED", "不允许的主机地址", 403);
        if (
          req.headers.origin &&
          new URL(req.headers.origin).origin !== "http://" + req.headers.host
        )
          throw err("ORIGIN_REJECTED", "跨站请求已拒绝", 403);
        const url = new URL(req.url, "http://127.0.0.1");
        const path = url.pathname;
        const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
        const method = req.method;
        if (method === "GET" && path === "/api/health")
          return json(res, 200, { ok: true, version: "0.1.0-linux" });
        if (method === "GET" && path === "/api/config")
          return json(res, 200, {
            demo: true,
            openaiConfigured: config.configured,
            model: config.model || null,
            endpoint: config.endpoint || null,
            configurationError: config.error || null,
            manualPrices: prices,
            generationContract: "json-narrative-operations",
            toolCallsEnabled: false,
            extraParameterNames: Object.keys(config.extraParameters || {}),
          });
        if (method === "GET" && path === "/api/cards")
          return json(res, 200, { cards: await listCards(dataDir) });
        if (
          method === "GET" &&
          parts[0] === "api" &&
          parts[1] === "cards" &&
          parts[2]
        ) {
          const record = await readCard(dataDir, parts[2]);
          if (parts[3] === "original") {
            const content = await readFile(
              join(dataDir, "cards", parts[2], "original"),
            );
            const filename = encodeURIComponent(
              record.card.original.name,
            ).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-disposition": "attachment; filename*=UTF-8''" + filename,
              "cache-control": "no-store",
            });
            return res.end(content);
          }
          if (parts.length === 3) return json(res, 200, record);
        }
        if (method === "POST" && path === "/api/import") {
          const b = await body(req);
          if (
            typeof b.filename !== "string" ||
            typeof b.base64 !== "string" ||
            b.base64.length > Math.ceil((20 * 1024 * 1024) / 3) * 4 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)
          )
            throw err("IMPORT_INPUT", "文件编码或大小无效");
          return json(
            res,
            201,
            await importCard({
              filename: b.filename,
              bytes: Buffer.from(b.base64, "base64"),
              dataDir,
            }),
          );
        }
        if (method === "GET" && path === "/api/worlds")
          return json(res, 200, { worlds: store.listWorlds() });
        if (method === "POST" && path === "/api/worlds") {
          const b = await body(req);
          let card;
          if (b.cardId) card = (await readCard(dataDir, b.cardId)).card;
          else
            card = (
              await importCard({
                filename: "clocktower-demo.json",
                bytes: await readFile(
                  new URL("../fixtures/demo-card.json", import.meta.url),
                ),
                dataDir,
              })
            ).card;
          if (b.greetingIndex !== undefined) {
            if (
              !Number.isInteger(b.greetingIndex) ||
              b.greetingIndex < 0 ||
              b.greetingIndex > (card.alternateGreetings || []).length
            )
              throw err("GREETING_INDEX", "开场选择无效");
            if (b.greetingIndex > 0)
              card = {
                ...card,
                firstMessage: card.alternateGreetings[b.greetingIndex - 1],
              };
          }
          const s = store.createWorld({ name: b.name || card.name, card });
          return json(res, 201, view(s));
        }
        if (method === "GET" && path === "/api/backup") {
          const backup = await createBackup(store, dataDir);
          res.writeHead(200, {
            "content-type": "application/json",
            "content-disposition":
              'attachment; filename="story-runtime.story-backup.json"',
            "cache-control": "no-store",
          });
          return res.end(JSON.stringify(backup));
        }
        if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
          const token = parts[2],
            r = savedRun(token),
            active = live.get(token);
          if (method === "GET" && parts[3] === "events") {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            });
            res.write(
              `event: draft\ndata: ${JSON.stringify({ text: publicDraft(active || r) })}\n\n`,
            );
            const status = active?.status || r.status;
            if (status === "projecting")
              res.write('event: status\ndata: {"status":"projecting"}\n\n');
            if (status === "committed") {
              res.write(
                `event: committed\ndata: ${JSON.stringify({ snapshot: snap(r.worldId, r.branchId), postCommitNotice: store.snapshot(r.worldId, r.branchId).notices?.find((n) => n.runId === r.runId)?.text || "" })}\n\n`,
              );
              return res.end();
            }
            if (["cancelled", "failed", "interrupted"].includes(status)) {
              res.write(
                `event: ${status === "cancelled" ? "cancelled" : "error"}\ndata: ${JSON.stringify(status === "cancelled" ? {} : r.error || { code: "INTERRUPTED", message: "运行中断，请检查保存的草稿" })}\n\n`,
              );
              return res.end();
            }
            if (!active) {
              res.write(
                'event: error\ndata: {"code":"INTERRUPTED","message":"运行已中断，请查看保存草稿"}\n\n',
              );
              return res.end();
            }
            if (active.clients.size >= 8)
              throw err("TOO_MANY_WATCHERS", "同一运行订阅过多");
            active.clients.add(res);
            req.on("close", () => active.clients.delete(res));
            return;
          }
          if (method === "POST" && parts[3] === "cancel") {
            await body(req);
            if (
              active &&
              !["committed", "failed", "cancelled", "projecting"].includes(
                active.status,
              )
            ) {
              active.controller.abort();
              return json(res, 200, { cancelled: true });
            }
            return json(res, 200, { cancelled: false, status: r.status });
          }
          if (method === "POST" && parts[3] === "retry") {
            await body(req);
            requireIdle(r.worldId, r.branchId);
            if (!["failed", "interrupted", "draft"].includes(r.status))
              throw err("RUN_NOT_RETRYABLE", "只有保存的失败草稿可重试结算");
            const run = {
              ...r,
              status: "draft",
              controller: new AbortController(),
              clients: new Set(),
              error: null,
            };
            store.saveRun(runShape(run));
            live.set(token, run);
            setImmediate(() => launch(run, true));
            return json(res, 202, { runId: token });
          }
        }
        if (parts[0] === "api" && parts[1] === "worlds" && parts[2]) {
          const w = parts[2];
          if (method === "GET" && parts.length === 3)
            return json(
              res,
              200,
              snap(
                w,
                url.searchParams.get("branchId") || undefined,
                url.searchParams.get("view") === "author" ? "author" : "player",
              ),
            );
          if (method === "GET" && parts[3] === "actor-view") {
            if (url.searchParams.get("view") !== "author")
              throw err(
                "AUTHOR_VIEW_REQUIRED",
                "请在作者视图检查其他人物认知。",
                403,
              );
            const raw = store.snapshot(
              w,
              url.searchParams.get("branchId") || undefined,
            );
            return json(
              res,
              200,
              visibleSnapshot(
                raw,
                "player",
                url.searchParams.get("actorId") || "player",
              ),
            );
          }
          if (
            method === "GET" &&
            ["knowledge", "chapters", "knowledge-search"].includes(parts[3])
          ) {
            const raw = store.snapshot(
                w,
                url.searchParams.get("branchId") || undefined,
              ),
              v =
                url.searchParams.get("view") === "author" ? "author" : "player";
            if (parts[3] === "chapters")
              return json(res, 200, { chapters: chapterSummaries(raw, v) });
            if (parts[3] === "knowledge-search")
              return json(res, 200, {
                results: searchKnowledge(raw, url.searchParams.get("q") || "", {
                  view: v,
                }),
              });
            res.setHeader(
              "content-disposition",
              'attachment; filename="story-knowledge.json"',
            );
            return json(res, 200, knowledgeBundle(raw, v));
          }
          if (method === "GET" && parts[3] === "export") {
            const s = snap(w, url.searchParams.get("branchId") || undefined);
            const text =
              `${s.world.name}\n分支：${s.branch.name}\n\n` +
              s.scenes
                .map(
                  (x) =>
                    (x.userText ? "玩家：" + x.userText + "\n\n" : "") +
                    x.narrative,
                )
                .join("\n\n---\n\n");
            res.writeHead(200, {
              "content-type": "text/plain; charset=utf-8",
              "content-disposition": 'attachment; filename="story.txt"',
            });
            return res.end(text);
          }
          if (method === "GET" && parts[3] === "search") {
            const s = snap(w, url.searchParams.get("branchId") || undefined),
              q = (url.searchParams.get("q") || "")
                .slice(0, 100)
                .toLocaleLowerCase();
            return json(res, 200, {
              results: q
                ? s.scenes
                    .filter((x) =>
                      (x.narrative + " " + x.userText)
                        .toLocaleLowerCase()
                        .includes(q),
                    )
                    .slice(-30)
                : [],
            });
          }
          if (method === "POST") {
            const b = await body(req);
            if (typeof b.branchId !== "string" || !b.branchId)
              throw err(
                "BRANCH_REQUIRED",
                "世界写入必须指定明确分支；请刷新后重试。",
              );
            const current = store.snapshot(w, b.branchId);
            const branch = current.branch.id;
            if (parts[3] === "turn") {
              if (
                typeof b.message !== "string" ||
                !b.message.trim() ||
                b.message.length > 8000 ||
                typeof b.runId !== "string" ||
                !/^[A-Za-z0-9_-]{1,128}$/.test(b.runId)
              )
                throw err("TURN_INPUT", "请输入不超过8000字的内容");
              if (!["demo", "openai"].includes(b.mode))
                throw err("MODEL_MODE", "请选择演示或已配置模型");
              if (b.mode === "openai" && !config.configured)
                throw err(
                  "MODEL_NOT_CONFIGURED",
                  "未配置真实模型，请使用本地演示",
                );
              const previous = store.getRun(w, branch, b.runId);
              if (previous) {
                if (previous.userText !== b.message || previous.mode !== b.mode)
                  throw err("RUN_CONFLICT", "相同运行标识的请求内容不同", 409);
                return json(res, 202, {
                  runId: tokenOf(previous),
                  status: previous.status,
                });
              }
              requireIdle(w, branch);
              const a = auto.get(w + ":" + branch);
              if (a) a.enabled = false;
              const r = {
                worldId: w,
                branchId: branch,
                runId: b.runId,
                expectedHead: current.branch.head,
                sourceRevision: current.branch.sourceRevision,
                userText: b.message,
                mode: b.mode,
                status: "accepted",
                draft: "",
                operations: null,
                error: null,
              };
              store.saveRun(r);
              const run = {
                ...r,
                controller: new AbortController(),
                clients: new Set(),
              };
              const token = tokenOf(r);
              live.set(token, run);
              setImmediate(() => launch(run));
              return json(res, 202, { runId: token });
            }
            if (parts[3] === "select-branch")
              return json(res, 200, view(store.selectBranch(w, b.branchId)));
            if (parts[3] === "autonomy") {
              requireIdle(w, branch);
              if (b.enabled) {
                const maxEvents = Math.min(
                  50,
                  Math.max(1, Number(b.maxEvents) || 10),
                );
                const duration = Math.min(
                  600,
                  Math.max(5, Number(b.durationSeconds) || 60),
                );
                auto.set(w + ":" + branch, {
                  worldId: w,
                  branchId: branch,
                  enabled: true,
                  maxEvents,
                  remainingEvents: maxEvents,
                  endsAt: Date.now() + duration * 1000,
                  startedAt: Date.now(),
                  startedTime: current.state.time,
                  lastError: null,
                });
              } else {
                const a = auto.get(w + ":" + branch);
                if (a) a.enabled = false;
              }
              return json(res, 200, currentAuto(w, branch));
            }
            requireIdle(w, branch);
            if (parts[3] === "card-action") {
              const declared =
                current.world.card.extensions?.story_runtime?.actions;
              const actions = Array.isArray(declared) ? declared : [];
              if (
                !Number.isInteger(b.actionIndex) ||
                b.actionIndex < 0 ||
                b.actionIndex >= Math.min(actions.length, 32)
              )
                throw err("CARD_ACTION", "卡片动作不存在");
              const action = actions[b.actionIndex];
              if (
                !action ||
                !Array.isArray(action.operations) ||
                action.operations.length > 100
              )
                throw err("CARD_ACTION", "卡片动作不是受支持的声明式变化");
              store.commit({
                worldId: w,
                branchId: branch,
                runId: b.runId || randomUUID(),
                expectedHead:
                  b.expectedHead === undefined
                    ? current.branch.head
                    : b.expectedHead,
                sourceRevision: current.branch.sourceRevision,
                userText: "",
                narrative:
                  typeof action.narrative === "string"
                    ? action.narrative
                    : "执行卡片动作：" + String(action.label || ""),
                operations: action.operations,
                source: "card-action",
                author: false,
              });
              await drain(w, branch);
              return json(res, 200, snap(w, branch));
            }
            if (parts[3] === "actions") {
              const result = store.commit({
                worldId: w,
                branchId: branch,
                runId: b.runId || randomUUID(),
                expectedHead:
                  b.expectedHead === undefined
                    ? current.branch.head
                    : b.expectedHead,
                sourceRevision: current.branch.sourceRevision,
                userText: "",
                narrative: b.narrative || "作者确认了一项世界变化。",
                operations: b.operations,
                publicNarrative: b.publicNarrative,
                source: "author",
                author: true,
              });
              await drain(w, branch);
              return json(res, 200, snap(w, branch));
            }
            if (parts[3] === "fork") {
              const s = store.fork({
                worldId: w,
                branchId: branch,
                commitId: b.commitId ?? null,
                name: b.name || "新分支",
              });
              await drain(w, s.branch.id);
              return json(res, 201, snap(w, s.branch.id));
            }
            if (parts[3] === "revise") {
              const revised = store.revise({
                worldId: w,
                branchId: branch,
                commitId: b.commitId,
                name: "修订 · " + new Date().toISOString().slice(11, 16),
                narrative: b.narrative,
                publicNarrative: b.publicNarrative,
                operations: b.operations || [],
              });
              await drain(w, revised.branch.id);
              return json(res, 201, snap(w, revised.branch.id));
            }
            if (parts[3] === "advance") {
              const result = store.advance({
                worldId: w,
                branchId: branch,
                to: b.to,
                maxEvents: b.maxEvents || 10,
              });
              await drain(w, branch);
              return json(res, 200, { ...result, snapshot: snap(w, branch) });
            }
            if (parts[3] === "recover-projection") {
              await drain(w, branch);
              return json(res, 200, snap(w, branch));
            }
          }
        }
        if (method === "GET" && parts[0] === "assets" && parts.length === 2) {
          const a = await assetPath(dataDir, parts[1]);
          res.writeHead(200, {
            "content-type": a.mime,
            "content-length": a.size,
            "cache-control": "public,max-age=31536000,immutable",
            "content-security-policy": "default-src 'none'",
          });
          return res.end(await readFile(a.path));
        }
        if (method === "GET") {
          const name = path === "/" ? "index.html" : path.slice(1);
          if (
            /^[a-zA-Z0-9_.-]+$/.test(name) &&
            /\.(html|css|js|svg|ico)$/.test(name)
          ) {
            const content = await readFile(join(publicDir, name));
            res.writeHead(200, {
              "cache-control": "no-cache",
              "content-type": {
                html: "text/html; charset=utf-8",
                css: "text/css; charset=utf-8",
                js: "text/javascript; charset=utf-8",
                svg: "image/svg+xml",
                ico: "image/x-icon",
              }[name.split(".").at(-1)],
            });
            return res.end(content);
          }
        }
        throw err("NOT_FOUND", "找不到此页面或接口", 404);
      } catch (e) {
        if (res.headersSent) {
          res.end();
          return;
        }
        const status =
          e.status ||
          (e.code === "ENOENT"
            ? 404
            : [
                  "WORLD_BUSY",
                  "STALE_HEAD",
                  "STALE_SOURCE",
                  "IDEMPOTENCY_CONFLICT",
                  "RUN_CONFLICT",
                ].includes(e.code)
              ? 409
              : 400);
        json(res, status, { error: safeError(e) });
      }
    });
    await new Promise((yes, no) => {
      server.once("error", no);
      server.listen(port, host, yes);
    });
    const timer = setInterval(async () => {
      if (stopped) return;
      for (const a of auto.values()) {
        if (!a.enabled) continue;
        if (Date.now() >= a.endsAt || a.remainingEvents <= 0) {
          a.enabled = false;
          continue;
        }
        if (busy(a.worldId, a.branchId)) continue;
        try {
          const s = store.snapshot(a.worldId, a.branchId),
            to = a.startedTime + Math.floor((Date.now() - a.startedAt) / 1000);
          const due = s.state.schedules.filter(
            (x) => x.status === "pending" && x.at <= to,
          );
          if (!due.length) continue;
          const player = due.some(
            (x) =>
              x.entityId === "player" ||
              x.operations.some(
                (o) => o.entityId === "player" || o.from === "player",
              ),
          );
          if (player) {
            a.enabled = false;
            a.lastError = {
              code: "PLAYER_DECISION_REQUIRED",
              message: "日程涉及玩家选择，自动推进已暂停。",
            };
            continue;
          }
          const result = store.advance({
            worldId: a.worldId,
            branchId: a.branchId,
            to,
            maxEvents: a.remainingEvents,
          });
          a.remainingEvents -= result.executed.length + result.cancelled.length;
          await drain(a.worldId, a.branchId);
        } catch (e) {
          a.enabled = false;
          a.lastError = safeError(e);
        }
      }
    }, 1000);
    timer.unref();
    return {
      server,
      store,
      projection,
      dataDir,
      url: `http://127.0.0.1:${server.address().port}`,
      async close() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        for (const r of live.values()) r.controller.abort();
        await Promise.allSettled([...jobs]);
        await new Promise((r) => server.close(r));
        await projection.close();
        store.close();
        await rm(lock, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await projection?.close();
    store?.close();
    await rm(lock, { recursive: true, force: true });
    throw e;
  }
}
