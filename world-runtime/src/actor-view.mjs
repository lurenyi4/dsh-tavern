const visible = (x, actor) =>
  x.visibility !== "private" || x.holderId === actor;
/** Conservative knowledge projection; author truth is never copied wholesale to an actor. */
export function actorState(canonical, actorId = "player") {
  const s = structuredClone(canonical);
  if (
    !s.characters.some(
      (c) => c.id === actorId && (c.kind ?? "character") === "character",
    )
  )
    throw Object.assign(new Error("Unknown actor in this world"), {
      code: "UNKNOWN_ACTOR",
    });
  s.beliefs = (s.beliefs || []).filter((b) => b.holderId === actorId);
  s.characters = s.characters
    .filter((c) => c.id === actorId || visible(c, actorId))
    .map((c) => ({
      ...c,
      description:
        c.descriptionVisibility === "private" && c.id !== actorId
          ? ""
          : c.description,
      location:
        c.id === actorId
          ? c.location
          : (s.beliefs.find((b) => b.subjectId === c.id && b.key === "location")
              ?.value ?? null),
    }));
  const ids = new Set(s.characters.map((c) => c.id));
  if (s.references)
    s.references = s.references.filter((r) => visible(r, actorId));
  s.facts = (s.facts || []).filter((f) => visible(f, actorId));
  s.relations = (s.relations || []).filter(
    (r) => visible(r, actorId) && ids.has(r.from) && ids.has(r.to),
  );
  s.inventory = (s.inventory || []).filter(
    (i) => visible(i, actorId) && ids.has(i.entityId),
  );
  s.goals = (s.goals || []).filter(
    (g) => g.visibility !== "private" || g.entityId === actorId,
  );
  s.plotThreads = (s.plotThreads || []).filter((p) =>
    ["planted", "partially_resolved", "resolved"].includes(p.status),
  );
  s.schedules = (s.schedules || [])
    .filter((q) => q.entityId === actorId)
    .map(({ operations, precondition, ...q }) => q);
  s.variables = Object.fromEntries(
    Object.entries(s.variables || {}).filter(([key]) =>
      visible(s.variableVisibility?.[key] || {}, actorId),
    ),
  );
  for (const scope of ["card", "scene"])
    if (s[scope + "Variables"])
      s[scope + "Variables"] = Object.fromEntries(
        Object.entries(s[scope + "Variables"]).filter(([key]) =>
          visible(s.variableVisibility?.[scope + ":" + key] || {}, actorId),
        ),
      );
  s.variableVisibility = Object.fromEntries(
    Object.entries(s.variableVisibility || {}).filter(([key]) => {
      if (Object.hasOwn(s.variables, key)) return true;
      const [scope, k] = key.split(":");
      return (
        ["card", "scene"].includes(scope) &&
        Object.hasOwn(s[scope + "Variables"] || {}, k)
      );
    }),
  );
  return s;
}
