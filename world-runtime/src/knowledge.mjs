import { visibleSnapshot } from "./model.mjs";

// Rebuildable views: neither summaries nor search own or rewrite world facts.
const clean = (value) => String(value ?? "").replace(/\r/g, "");
const escape = (value) => clean(value).replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
const relationText = (r) =>
  `${r.from} → ${r.to}: ${r.type} ${r.detail || ""} [${r.status ?? "active"}; validFrom=${r.validFrom ?? "unknown"}; validUntil=${r.validUntil ?? "open"}; id=${r.id}; addresses=${r.addressFrom || ""} / ${r.addressTo || ""}]`;
const source = (value) => (value ? `来源提交：${value}` : "来源：导入设定");
function checkedView(view) {
  if (!["player", "author"].includes(view))
    throw Object.assign(new Error("Unknown knowledge view"), {
      code: "INVALID_VIEW",
    });
  return view;
}
export function chapterSummaries(snapshot, view = "player") {
  const s = visibleSnapshot(snapshot, checkedView(view)),
    visible = new Set(s.scenes.map((x) => x.id));
  const markers = new Map(
    (snapshot.scenes || [])
      .filter((x) => visible.has(x.id))
      .flatMap((x) =>
        (x.operations || [])
          .filter((o) => o.op === "mark_chapter")
          .map((o) => [x.id, o.title]),
      ),
  );
  const chapters = [];
  let current = null;
  for (const scene of s.scenes) {
    if (!current || markers.has(scene.id)) {
      current = {
        id: scene.id,
        title: markers.get(scene.id) || "未分章场景",
        method: "extractive-preview-v1",
        sourceCommitIds: [],
        excerpts: [],
      };
      chapters.push(current);
    }
    current.sourceCommitIds.push(scene.id);
    // Labeled extractive excerpts, not fabricated semantic summaries or canonical facts.
    if (current.excerpts.length < 12)
      current.excerpts.push({
        sourceCommitId: scene.id,
        text: clean(scene.narrative).slice(0, 360),
        truncated: clean(scene.narrative).length > 360,
      });
  }
  return chapters;
}
export function searchKnowledge(
  snapshot,
  query,
  { view = "player", limit = 50 } = {},
) {
  checkedView(view);
  const q = clean(query).trim().toLocaleLowerCase().slice(0, 100);
  if (!q) return [];
  const s = visibleSnapshot(snapshot, view),
    results = [];
  const add = (kind, id, text, sourceCommitId = null, extra = {}) => {
    if (clean(text).toLocaleLowerCase().includes(q))
      results.push({
        kind,
        id,
        text: clean(text).slice(0, 1500),
        sourceCommitId,
        ...extra,
      });
  };
  for (const c of s.state.characters || [])
    add(
      "character",
      c.id,
      c.name + (c.aliases?.length ? " / " + c.aliases.join(" / ") : ""),
      null,
      { name: c.name },
    );
  for (const f of s.state.facts || [])
    add("fact", f.id, `${f.key}: ${f.value}`, f.sourceCommitId);
  for (const r of s.state.relations || [])
    add("relation", r.id, relationText(r), r.sourceCommitId, {
      status: r.status ?? "active",
      validUntil: r.validUntil ?? null,
    });
  for (const p of s.state.plotThreads || [])
    add("plotThread", p.id, `${p.label} (${p.status})`, p.sourceCommitId);
  for (const r of s.state.references || [])
    add("reference", r.id, r.title + "\n" + r.text, r.sourceCommitId, {
      sourceRevision: r.sourceRevision,
    });
  for (const scene of [...s.scenes].reverse())
    add("scene", scene.id, scene.userText + "\n" + scene.narrative, scene.id);
  return results.slice(
    0,
    Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50)),
  );
}
export function knowledgeBundle(snapshot, view = "player") {
  checkedView(view);
  const s = visibleSnapshot(snapshot, view);
  const header = `世界：${escape(s.world.name)}\n\n分支：${escape(s.branch.id)}\n\n快照：${escape(s.branch.head || "initial")}\n\n视图：${view}\n\n`;
  const files = {};
  files["world.md"] =
    "# 世界资料\n\n" +
    header +
    "## 当前事实\n\n" +
    s.state.facts
      .map(
        (f) =>
          `- ${escape(f.key)}：${escape(f.value)}（${source(f.sourceCommitId)}）`,
      )
      .join("\n");
  files["characters.md"] =
    "# 人物索引\n\n" +
    header +
    s.state.characters
      .map(
        (c) =>
          `- ${escape(c.name)} · ${escape(c.id)} → characters/${encodeURIComponent(c.id)}.md`,
      )
      .join("\n");
  for (const c of s.state.characters) {
    files[`characters/${encodeURIComponent(c.id)}.md`] =
      `# ${escape(c.name)}\n\n` +
      header +
      `稳定ID：${escape(c.id)}\n\n当前位置/认知：${escape(c.location ?? "未知")}\n\n## 关系\n\n` +
      s.state.relations
        .filter((r) => r.from === c.id || r.to === c.id)
        .map(
          (r) => `- ${escape(relationText(r))}（${source(r.sourceCommitId)}）`,
        )
        .join("\n") +
      "\n\n## 认知\n\n" +
      s.state.beliefs
        .filter((b) => b.holderId === c.id)
        .map(
          (b) =>
            `- ${escape(b.subjectId)} · ${escape(b.key)}：${escape(b.value)}（${source(b.sourceCommitId)}）`,
        )
        .join("\n");
  }
  files["references.md"] =
    "# 参考资料（非正史）\n\n" +
    header +
    (s.state.references || [])
      .map(
        (r) =>
          `## ${escape(r.title)}\n\n${escape(r.text)}\n\n版本：${r.sourceRevision} · ${source(r.sourceCommitId)}`,
      )
      .join("\n\n");
  files["relations.md"] =
    "# 有向关系\n\n" +
    header +
    s.state.relations
      .map((r) => `- ${escape(relationText(r))}（${source(r.sourceCommitId)}）`)
      .join("\n");
  files["events.md"] =
    "# 事件与原文索引\n\n" +
    header +
    s.scenes
      .map(
        (scene) =>
          `## ${scene.id}\n\n${escape(scene.narrative)}\n\n${source(scene.id)}\n`,
      )
      .join("\n");
  files["chapters.md"] =
    "# 章节与可重建摘录\n\n" +
    header +
    "这些是原文截取，不是模型摘要或新事实；每条可按提交ID回查完整正文。\n\n" +
    chapterSummaries(snapshot, view)
      .map(
        (c) =>
          `## ${escape(c.title)}\n\n` +
          c.excerpts
            .map(
              (e) =>
                `${escape(e.text)}${e.truncated ? "…" : ""}\n\n${source(e.sourceCommitId)}`,
            )
            .join("\n\n"),
      )
      .join("\n\n");
  files["plot-threads.md"] =
    "# 伏笔与线索\n\n" +
    header +
    s.state.plotThreads
      .map(
        (p) =>
          `- ${escape(p.label)}：${escape(p.status)}（${source(p.sourceCommitId)}）`,
      )
      .join("\n");
  return {
    format: "story-runtime-knowledge-v1",
    compatibility: "OKF-inspired, not certified OKF",
    worldId: s.world.id,
    branchId: s.branch.id,
    headCommitId: s.branch.head,
    view,
    files,
  };
}
