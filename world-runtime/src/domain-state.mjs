import { NORMALIZED_CARD_LIMITS } from "./storage-limits.mjs";
import { recordIdentity } from "./run-identity.mjs";
import { randomUUID } from "node:crypto";
export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
const BAD = new Set(["__proto__", "prototype", "constructor"]);
export function safeKey(value, label = "key") {
  text(value, label, 128);
  if (BAD.has(value)) fail("INVALID_INPUT", `${label} is reserved`);
  return value;
}
export function text(value, label = "text", max = 65536, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    fail("INVALID_INPUT", `Invalid ${label}`);
  return value;
}
export function identifier(value, label = "id") {
  text(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || BAD.has(value))
    fail("INVALID_INPUT", `Invalid ${label}`);
  return value;
}
export function integer(
  value,
  label = "number",
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("INVALID_INPUT", `Invalid ${label}`);
  return value;
}
export function object(value, label = "object", allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    fail("INVALID_INPUT", `Invalid ${label}`);
  if (Object.getOwnPropertySymbols(value).length)
    fail("INVALID_INPUT", `Unsupported symbol field in ${label}`);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (
      BAD.has(key) ||
      !("value" in descriptor) ||
      (allowed && !allowed.includes(key))
    )
      fail("INVALID_INPUT", `Unsupported ${label} field: ${key}`);
  }
  return value;
}
export function jsonValue(
  value,
  depth = 0,
  budget = {
    nodes: 0,
  },
) {
  if (
    depth > (budget.limits?.jsonDepth ?? 32) ||
    ++budget.nodes > (budget.limits?.jsonNodes ?? 100000)
  )
    fail("INVALID_INPUT", "JSON input is too complex");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    text(value, "JSON string", budget.limits?.stringChars ?? 1024 * 1024, true);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail("INVALID_INPUT", "Non-finite JSON number");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > (budget.limits?.arrayLength ?? 20000))
      fail("INVALID_INPUT", "JSON array too large");
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      fail("INVALID_INPUT", "Invalid JSON array prototype");
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (key === "length") continue;
      if (!/^(0|[1-9][0-9]*)$/.test(key) || !("value" in descriptor))
        fail("INVALID_INPUT", "Invalid JSON array field");
    }
    for (const x of value) jsonValue(x, depth + 1, budget);
    return;
  }
  object(value, "JSON object");
  for (const x of Object.values(value)) jsonValue(x, depth + 1, budget);
}
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
export function scalar(value, label = "value") {
  if (typeof value === "string") return text(value, label, 65536, true);
  if (typeof value === "boolean") return value;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  )
    return value;
  fail("INVALID_INPUT", `Invalid scalar ${label}`);
}
function bool(value, label) {
  if (typeof value !== "boolean") fail("INVALID_INPUT", `Invalid ${label}`);
  return value;
}
function visibility(value = "public") {
  if (!["public", "private"].includes(value))
    fail("INVALID_INPUT", "Invalid visibility");
  return value;
}
function entity(state, id) {
  identifier(id, "entityId");
  if (!state.characters.some((x) => x.id === id))
    fail("UNKNOWN_ENTITY", "Entity is not in this world");
  return id;
}
function findById(items, id, label) {
  identifier(id);
  const item = items.find((x) => x.id === id);
  if (!item) fail("UNKNOWN_REFERENCE", `${label} is not in the current branch`);
  return item;
}
const FIELDS = {
  set_location: ["entityId", "value"],
  add_relation: [
    "from",
    "to",
    "type",
    "detail",
    "visibility",
    "holderId",
    "locked",
    "addressFrom",
    "addressTo",
  ],
  update_relation: [
    "id",
    "type",
    "detail",
    "visibility",
    "holderId",
    "locked",
    "addressFrom",
    "addressTo",
  ],
  end_relation: ["id"],
  create_entity: [
    "name",
    "kind",
    "aliases",
    "description",
    "descriptionVisibility",
    "visibility",
    "holderId",
    "locked",
  ],
  update_entity: [
    "id",
    "name",
    "aliases",
    "description",
    "descriptionVisibility",
    "visibility",
    "holderId",
    "locked",
  ],
  observe: ["holderId", "subjectId", "key", "value", "kind"],
  set_fact: ["id", "key", "value", "visibility", "holderId", "locked"],
  set_belief: ["holderId", "subjectId", "key", "value"],
  set_goal: [
    "id",
    "entityId",
    "text",
    "status",
    "visibility",
    "motivation",
    "successCondition",
  ],
  change_inventory: ["entityId", "item", "amount", "visibility", "holderId"],
  set_variable: ["key", "value", "visibility", "holderId", "locked", "scope"],
  increment_variable: ["key", "amount", "scope"],
  set_plot_thread: ["id", "label", "status"],
  schedule: [
    "id",
    "at",
    "entityId",
    "label",
    "operations",
    "precondition",
    "goalId",
    "preconditionMode",
  ],
  cancel_schedule: ["id"],
  mark_chapter: ["title"],
  set_reference: ["id", "title", "text", "visibility", "holderId"],
};
export function checkPrecondition(state, p, actorId) {
  if (p === null || p === undefined) return true;
  object(p, "precondition");
  if (Object.hasOwn(p, "belief")) {
    object(p, "precondition", ["belief"]);
    object(p.belief, "belief condition", ["subjectId", "key", "equals"]);
    if (!actorId)
      fail("INVALID_INPUT", "A belief condition needs a schedule actor");
    entity(state, actorId);
    entity(state, p.belief.subjectId);
    safeKey(p.belief.key);
    scalar(p.belief.equals);
    return state.beliefs.some(
      (b) =>
        b.holderId === actorId &&
        b.subjectId === p.belief.subjectId &&
        b.key === p.belief.key &&
        b.value === p.belief.equals,
    );
  }

  if (Object.hasOwn(p, "entityId")) {
    object(p, "precondition", ["entityId", "location"]);
    entity(state, p.entityId);
    text(p.location, "location", 2048, true);
    return (
      state.characters.find((x) => x.id === p.entityId).location === p.location
    );
  }
  object(p, "precondition", ["variable", "equals"]);
  safeKey(p.variable, "variable");
  scalar(p.equals);
  return (
    Object.hasOwn(state.variables, p.variable) &&
    state.variables[p.variable] === p.equals
  );
}
export function applyOperations(
  state,
  operations,
  {
    commitId,
    author = false,
    scheduled = false,
    dryRun = false,
    identitySeed,
    operationCursor = { index: 0 },
    entityIds,
    entityCursor = { index: 0 },
  } = {},
) {
  if (!Array.isArray(operations) || operations.length > 100)
    fail("INVALID_INPUT", "Operations must be an array with at most 100 items");
  for (const op of operations) {
    const operationIndex = operationCursor.index++;
    const allocateId = (family) =>
      identitySeed
        ? recordIdentity(identitySeed, operationIndex, family)
        : family === "entity" && entityIds
          ? entityIds[entityCursor.index++]
          : randomUUID();
    object(op, "operation");
    text(op.op, "op", 64);
    if (!Object.hasOwn(FIELDS, op.op))
      fail("INVALID_INPUT", "Unknown operation");
    object(op, "operation", ["op", ...FIELDS[op.op]]);
    switch (op.op) {
      case "create_entity":
      case "update_entity": {
        const old =
          op.op === "update_entity"
            ? findById(state.characters, op.id, "Entity")
            : null;
        if ((old?.locked || op.locked === true) && !author)
          fail("LOCKED_FIELD", "Locked entity requires author action");
        if (op.name !== undefined) text(op.name, "entity name", 512);
        else if (!old) fail("INVALID_INPUT", "New entity needs name");
        const kind = old?.kind ?? op.kind ?? "character";
        if (!["character", "organization", "location", "item"].includes(kind))
          fail("INVALID_INPUT", "Invalid entity kind");
        if (
          op.aliases !== undefined &&
          (!Array.isArray(op.aliases) ||
            op.aliases.length > 32 ||
            op.aliases.some(
              (x) => typeof x !== "string" || !x.trim() || x.length > 128,
            ))
        )
          fail("INVALID_INPUT", "Invalid aliases");
        if (op.description !== undefined)
          text(op.description, "entity description", 65536, true);
        if (op.descriptionVisibility !== undefined)
          visibility(op.descriptionVisibility);
        if (op.holderId !== undefined) entity(state, op.holderId);
        if (op.locked !== undefined) bool(op.locked, "locked");
        const allocatedId = old?.id ?? allocateId("entity");
        identifier(allocatedId, "allocated entity ID");
        if (!old && state.characters.some((c) => c.id === allocatedId))
          fail("ENTITY_CONFLICT", "Allocated entity already exists");
        const value = {
          id: allocatedId,
          name: op.name ?? old.name,
          kind,
          aliases: clone(op.aliases ?? old?.aliases ?? []),
          description: op.description ?? old?.description ?? "",
          descriptionVisibility:
            op.descriptionVisibility ?? old?.descriptionVisibility ?? "public",
          location: old?.location ?? null,
          visibility: visibility(op.visibility ?? old?.visibility),
          holderId: op.holderId ?? old?.holderId ?? null,
          locked: op.locked ?? old?.locked ?? false,
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else {
          if (state.characters.length >= 1000)
            fail("STATE_LIMIT", "Entity limit exceeded");
          state.characters.push(value);
        }
        break;
      }
      case "update_relation":
      case "end_relation": {
        const old = findById(state.relations, op.id, "Relation");
        if ((old.locked || op.locked === true) && !author)
          fail("LOCKED_FIELD", "Locked relation requires author action");
        if (op.op === "end_relation") {
          old.status = "ended";
          old.validUntil = state.time;
          old.sourceCommitId = commitId ?? null;
          break;
        }
        for (const key of ["type", "detail", "addressFrom", "addressTo"])
          if (op[key] !== undefined) {
            text(op[key], key, key === "detail" ? 8192 : 256, key !== "type");
            old[key] = op[key];
          }
        if (op.visibility !== undefined)
          old.visibility = visibility(op.visibility);
        if (op.holderId !== undefined)
          old.holderId = entity(state, op.holderId);
        if (op.locked !== undefined) old.locked = bool(op.locked, "locked");
        old.sourceCommitId = commitId ?? null;
        break;
      }

      case "set_reference": {
        if (!author || scheduled)
          fail(
            "AUTHOR_REQUIRED",
            "Reference edits require explicit author action",
          );
        text(op.title, "reference title", 300);
        text(op.text, "reference text", 65536, true);
        if (op.holderId !== undefined && op.holderId !== null)
          entity(state, op.holderId);
        state.references ??= [];
        const old =
          op.id === undefined
            ? null
            : findById(state.references, op.id, "Reference");
        if (!old && state.references.length >= 128)
          fail("STATE_LIMIT", "Reference limit exceeded");
        const value = {
          id: old?.id ?? allocateId("record"),
          title: op.title,
          text: op.text,
          visibility: visibility(op.visibility ?? old?.visibility),
          holderId:
            op.holderId === undefined ? (old?.holderId ?? null) : op.holderId,
          sourceRevision: allocateId("revision"),
          sourceCommitId: commitId ?? null,
          kind: "reference-not-canon",
        };
        if (old) Object.assign(old, value);
        else state.references.push(value);
        break;
      }
      case "mark_chapter": {
        if (!author || scheduled)
          fail(
            "AUTHOR_REQUIRED",
            "Chapter markers require an explicit author action",
          );
        text(op.title, "chapter title", 300);
        break;
      }
      case "set_location": {
        entity(state, op.entityId);
        text(op.value, "location", 2048, true);
        const target = state.characters.find((x) => x.id === op.entityId);
        if (target.locked && !author)
          fail("LOCKED_FIELD", "Locked entity requires author action");
        target.location = op.value;
        target.locationSourceCommitId = commitId ?? null;
        break;
      }
      case "add_relation": {
        entity(state, op.from);
        entity(state, op.to);
        text(op.type, "relation type", 256);
        if (op.detail !== undefined)
          text(op.detail, "relation detail", 8192, true);
        if (op.holderId !== undefined) entity(state, op.holderId);
        if (op.visibility !== undefined) visibility(op.visibility);
        if (op.locked !== undefined) bool(op.locked, "locked");
        if (op.locked === true && !author)
          fail("LOCKED_FIELD", "Only author can lock relation");
        for (const k of ["addressFrom", "addressTo"])
          if (op[k] !== undefined) text(op[k], k, 256, true);
        const existing = state.relations.find(
          (r) =>
            r.from === op.from &&
            r.to === op.to &&
            r.type === op.type &&
            r.status !== "ended",
        );
        if (existing) {
          if (existing.locked && !author)
            fail("LOCKED_FIELD", "Locked relation requires author action");
          let changed = false;
          for (const key of [
            "detail",
            "visibility",
            "holderId",
            "locked",
            "addressFrom",
            "addressTo",
          ])
            if (op[key] !== undefined && existing[key] !== op[key]) {
              existing[key] = op[key];
              changed = true;
            }
          if (changed) existing.sourceCommitId = commitId ?? null;
          break;
        }
        state.relations.push({
          id: allocateId("record"),
          from: op.from,
          to: op.to,
          type: op.type,
          detail: op.detail ?? "",
          status: "active",
          validFrom: state.time,
          validUntil: null,
          visibility: op.visibility ?? "public",
          holderId: op.holderId ?? null,
          locked: op.locked ?? false,
          addressFrom: op.addressFrom ?? "",
          addressTo: op.addressTo ?? "",
          sourceCommitId: commitId ?? null,
        });
        break;
      }
      case "set_fact": {
        safeKey(op.key, "fact key");
        scalar(op.value);
        if (op.holderId !== undefined && op.holderId !== null)
          entity(state, op.holderId);
        if (op.visibility !== undefined) visibility(op.visibility);
        if (op.locked !== undefined) bool(op.locked, "locked");
        let old =
          op.id === undefined
            ? state.facts.find(
                (x) => x.key === op.key && x.holderId === (op.holderId ?? null),
              )
            : findById(state.facts, op.id, "Fact");
        const holder =
          op.holderId === undefined ? (old?.holderId ?? null) : op.holderId;
        if (
          state.facts.some(
            (x) => x !== old && x.key === op.key && x.holderId === holder,
          )
        )
          fail("INVALID_INPUT", "A fact already has this key and holder");
        if ((old?.locked || op.locked === true) && !author)
          fail("LOCKED_FACT", "Locked facts require an explicit author action");
        const value = {
          id: old?.id ?? allocateId("record"),
          key: op.key,
          value: op.value,
          visibility: op.visibility ?? old?.visibility ?? "public",
          holderId: holder,
          locked: op.locked ?? old?.locked ?? false,
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else state.facts.push(value);
        break;
      }
      case "observe":
      case "set_belief": {
        entity(state, op.holderId);
        entity(state, op.subjectId);
        safeKey(op.key, "belief key");
        scalar(op.value);
        if (
          op.op === "observe" &&
          !["observation", "rumor", "belief"].includes(op.kind ?? "observation")
        )
          fail("INVALID_INPUT", "Invalid observation kind");
        const old = state.beliefs.find(
          (x) =>
            x.holderId === op.holderId &&
            x.subjectId === op.subjectId &&
            x.key === op.key,
        );
        const value = {
          holderId: op.holderId,
          subjectId: op.subjectId,
          kind: op.op === "observe" ? (op.kind ?? "observation") : "belief",
          knownSince: state.time,
          key: op.key,
          value: op.value,
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else state.beliefs.push(value);
        break;
      }
      case "set_goal": {
        entity(state, op.entityId);
        text(op.text, "goal", 8192);
        const old =
          op.id === undefined ? null : findById(state.goals, op.id, "Goal");
        if (op.motivation !== undefined)
          text(op.motivation, "motivation", 8192, true);
        if (op.successCondition !== undefined)
          text(op.successCondition, "success condition", 8192, true);
        const status = op.status ?? old?.status ?? "active";
        if (
          ![
            "active",
            "paused",
            "achieved",
            "abandoned",
            "invalidated",
          ].includes(status)
        )
          fail("INVALID_INPUT", "Invalid goal status");
        const value = {
          id: old?.id ?? allocateId("record"),
          entityId: op.entityId,
          text: op.text,
          status,
          motivation: op.motivation ?? old?.motivation ?? "",
          successCondition: op.successCondition ?? old?.successCondition ?? "",
          visibility: visibility(op.visibility ?? old?.visibility),
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else state.goals.push(value);
        break;
      }
      case "change_inventory": {
        entity(state, op.entityId);
        text(op.item, "item", 512);
        integer(op.amount, "amount", -Number.MAX_SAFE_INTEGER);
        const old = state.inventory.find(
          (x) => x.entityId === op.entityId && x.item === op.item,
        );
        const quantity = (old?.quantity ?? 0) + op.amount;
        if (!Number.isSafeInteger(quantity) || quantity < 0)
          fail(
            "INVALID_INVENTORY",
            "Inventory quantity must remain a nonnegative safe integer",
          );
        if (op.visibility !== undefined) visibility(op.visibility);
        if (op.holderId !== undefined) entity(state, op.holderId);
        if (op.amount === 0) break;
        if (old) {
          old.quantity = quantity;
          old.sourceCommitId = commitId ?? null;
          if (op.visibility !== undefined) old.visibility = op.visibility;
          if (op.holderId !== undefined) old.holderId = op.holderId;
        } else
          state.inventory.push({
            entityId: op.entityId,
            item: op.item,
            quantity,
            visibility: op.visibility ?? "public",
            holderId: op.holderId ?? null,
            sourceCommitId: commitId ?? null,
          });
        break;
      }
      case "set_variable":
      case "increment_variable": {
        safeKey(op.key, "variable");
        const scope = op.scope ?? "world";
        if (!["world", "card", "scene"].includes(scope))
          fail("INVALID_INPUT", "Invalid variable scope");
        const field =
          scope === "world"
            ? "variables"
            : scope === "card"
              ? "cardVariables"
              : "sceneVariables";
        const metadataKey = scope === "world" ? op.key : scope + ":" + op.key;
        const meta = state.variableVisibility?.[metadataKey];
        if ((meta?.locked || op.locked === true) && !author)
          fail("LOCKED_FIELD", "Locked variable requires author action");
        if (op.visibility !== undefined) visibility(op.visibility);
        if (op.holderId !== undefined) entity(state, op.holderId);
        if (op.locked !== undefined) bool(op.locked, "locked");
        if (op.op === "set_variable") scalar(op.value);
        else {
          if (typeof op.amount !== "number")
            fail("INVALID_INPUT", "Increment amount must be numeric");
          scalar(op.amount, "increment amount");
        }
        // Scene variables exist only while preparing a turn; the authoritative
        // commit validates their shape but deliberately never persists them.
        if (scope === "scene" && !dryRun) break;
        state[field] ??= {};
        const values = state[field];
        if (op.op === "increment_variable") {
          if (
            !Object.hasOwn(values, op.key) ||
            typeof values[op.key] !== "number"
          )
            fail(
              "INVALID_VARIABLE",
              "Increment requires an existing numeric variable",
            );
          const next = values[op.key] + op.amount;
          if (
            !Number.isFinite(next) ||
            Math.abs(next) > Number.MAX_SAFE_INTEGER
          )
            fail(
              "INVALID_VARIABLE",
              "Increment result is outside the safe numeric range",
            );
          values[op.key] = next;
        } else values[op.key] = op.value;
        state.variableVisibility ??= {};
        state.variableVisibility[metadataKey] = {
          visibility: op.visibility ?? meta?.visibility ?? "public",
          holderId: op.holderId ?? meta?.holderId ?? null,
          locked: op.locked ?? meta?.locked ?? false,
        };
        if (Object.keys(values).length > 10000)
          fail("STATE_LIMIT", "Variable scope limit exceeded");
        break;
      }
      case "set_plot_thread": {
        text(op.label, "plot thread", 8192);
        if (
          ![
            "planned",
            "planted",
            "partially_resolved",
            "resolved",
            "abandoned",
          ].includes(op.status)
        )
          fail("INVALID_INPUT", "Invalid plot status");
        const old =
          op.id === undefined
            ? null
            : findById(state.plotThreads, op.id, "Plot thread");
        const value = {
          id: old?.id ?? allocateId("record"),
          label: op.label,
          status: op.status,
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else state.plotThreads.push(value);
        break;
      }
      case "schedule": {
        if (scheduled)
          fail(
            "INVALID_INPUT",
            "Scheduled operations cannot schedule recursively",
          );
        integer(op.at, "schedule time", state.time);
        entity(state, op.entityId);
        text(op.label, "schedule label", 8192);
        const old =
          op.id === undefined
            ? null
            : findById(state.schedules, op.id, "Schedule");
        if (old && old.status !== "pending")
          fail("INVALID_INPUT", "Only pending schedules can be revised");
        if (
          op.preconditionMode !== undefined &&
          !["actor", "world"].includes(op.preconditionMode)
        )
          fail("INVALID_INPUT", "Invalid precondition mode");
        if (op.preconditionMode === "world" && !author)
          fail(
            "AUTHOR_REQUIRED",
            "World-truth legality predicates require explicit author setup",
          );
        if (op.goalId !== undefined) {
          const goal = findById(state.goals, op.goalId, "Goal");
          if (goal.entityId !== op.entityId)
            fail("INVALID_INPUT", "Schedule goal must belong to its actor");
        }
        checkPrecondition(state, op.precondition, op.entityId);
        const probe = clone(state);
        applyOperations(probe, op.operations, {
          commitId,
          author: false,
          scheduled: true,
          dryRun: true,
        });
        const value = {
          id: old?.id ?? allocateId("record"),
          at: op.at,
          entityId: op.entityId,
          label: op.label,
          operations: clone(op.operations),
          precondition:
            op.precondition === undefined ? null : clone(op.precondition),
          preconditionMode:
            op.preconditionMode ?? old?.preconditionMode ?? "actor",
          status: "pending",
          goalId: op.goalId ?? old?.goalId ?? null,
          sourceCommitId: commitId ?? null,
        };
        if (old) Object.assign(old, value);
        else state.schedules.push(value);
        break;
      }
      case "cancel_schedule": {
        const old = findById(state.schedules, op.id, "Schedule");
        if (old.status === "executed")
          fail("INVALID_INPUT", "Executed schedules cannot be cancelled");
        old.status = "cancelled";
        break;
      }
    }
  }
  for (const key of [
    "relations",
    "facts",
    "beliefs",
    "goals",
    "inventory",
    "schedules",
    "plotThreads",
  ])
    if (state[key].length > 10000)
      fail("STATE_LIMIT", "World collection limit exceeded");
  if (Object.keys(state.variables).length > 10000)
    fail("STATE_LIMIT", "Variable limit exceeded");
  return state;
}
export function initialState(card) {
  object(card, "card");
  jsonValue(card, 0, { nodes: 0, limits: NORMALIZED_CARD_LIMITS });
  if (
    Buffer.byteLength(JSON.stringify(card)) > NORMALIZED_CARD_LIMITS.jsonBytes
  )
    fail("INVALID_INPUT", "Card is too large");
  text(card.name, "card name", NORMALIZED_CARD_LIMITS.nameChars);
  if (card.description !== undefined)
    text(card.description, "description", 1024 * 1024, true);
  const state = {
    time: 0,
    characters: [
      {
        id: "card-main",
        name: card.name,
        description: card.description ?? "",
        location: null,
      },
      {
        id: "player",
        name: "玩家",
        description: "",
        location: null,
      },
    ],
    relations: [],
    facts: [],
    beliefs: [],
    goals: [],
    inventory: [],
    variables: {},
    schedules: [],
    plotThreads: [],
  };
  if (card.extensions !== undefined) object(card.extensions, "extensions");
  const ext = card.extensions?.story_runtime;
  if (ext === undefined) return state;
  object(ext, "story_runtime");
  if (ext.characters !== undefined) {
    if (!Array.isArray(ext.characters) || ext.characters.length > 200)
      fail("INVALID_INPUT", "Invalid initial characters");
    for (const c of ext.characters) {
      object(c, "character", ["id", "name", "description", "location"]);
      identifier(c.id);
      text(c.name, "character name", 512);
      if (state.characters.some((x) => x.id === c.id))
        fail("INVALID_INPUT", "Duplicate character ID");
      if (c.description !== undefined)
        text(c.description, "description", 65536, true);
      if (c.location !== undefined && c.location !== null)
        text(c.location, "location", 2048, true);
      state.characters.push({
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        location: c.location ?? null,
      });
    }
  }
  if (ext.variables !== undefined) {
    object(ext.variables, "variables");
    for (const [key, value] of Object.entries(ext.variables)) {
      safeKey(key);
      scalar(value);
      state.variables[key] = value;
    }
  }
  if (ext.cardVariables !== undefined) {
    object(ext.cardVariables, "cardVariables");
    state.cardVariables = {};
    for (const [key, value] of Object.entries(ext.cardVariables)) {
      safeKey(key);
      scalar(value);
      state.cardVariables[key] = value;
    }
  }
  if (ext.schedules !== undefined) {
    if (!Array.isArray(ext.schedules) || ext.schedules.length > 100)
      fail("INVALID_INPUT", "Invalid initial schedules");
    for (const schedule of ext.schedules) {
      object(schedule, "schedule", [
        "at",
        "entityId",
        "label",
        "operations",
        "precondition",
        "goalId",
        "preconditionMode",
      ]);
      applyOperations(
        state,
        [
          {
            ...schedule,
            op: "schedule",
          },
        ],
        {
          author: false,
        },
      );
    }
  }
  return state;
}
