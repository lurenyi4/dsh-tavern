import { fsyncSync } from "node:fs";
import { runBehaviors } from "./behavior.mjs";
import { contextCheckpoint } from "./model.mjs";
import { actorState } from "./actor-view.mjs";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, lstatSync, openSync, closeSync, unlinkSync } from "node:fs";
import { resolve, dirname, join, parse as parsePath, sep } from "node:path";
import {
  applyOperations,
  checkPrecondition,
  initialState,
  fail,
  text,
  integer,
  identifier,
  object,
  jsonValue,
  clone,
} from "./domain-state.mjs";
import { storeFault } from "./store-test-support.mjs";
const FORMAT = "dsh-worldmode-linux";
const VERSION = 2;
const RUN_STATES = [
  "accepted",
  "generating",
  "draft",
  "committed",
  "failed",
  "cancelled",
  "interrupted",
];
const ATTEMPT_STATES = ["started", "completed", "failed", "cancelled"];
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function pathCheck(path) {
  const absolute = resolve(path);
  let part = parsePath(absolute).root;
  for (const segment of absolute
    .slice(part.length)
    .split(sep)
    .filter(Boolean)) {
    part = join(part, segment);
    try {
      if (lstatSync(part).isSymbolicLink())
        fail("UNSAFE_PATH", "Symbolic links are not allowed in storage paths");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return absolute;
}
function safeDirectory(path) {
  text(path, "data directory", 4096);
  const absolute = pathCheck(path);
  mkdirSync(absolute, {
    recursive: true,
    mode: 0o700,
  });
  if (!lstatSync(absolute).isDirectory())
    fail("UNSAFE_PATH", "Storage directory must be a directory");
  return absolute;
}
function nullableId(value, label) {
  if (value !== null) identifier(value, label);
  return value;
}
function errorText(error) {
  if (error === null || error === undefined) return null;
  if (typeof error === "string") return text(error, "error", 8192, true);
  object(error, "error", ["code", "message"]);
  text(error.code, "error code", 128);
  text(error.message, "error message", 8192, true);
  return clone(error);
}
function token(value, label) {
  if (value === null || value === undefined) return null;
  return integer(value, label);
}
const schema = `
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE worlds(id TEXT PRIMARY KEY,name TEXT NOT NULL,active_branch_id TEXT,card_json TEXT NOT NULL,genesis_json TEXT NOT NULL,source_revision TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE branches(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),name TEXT NOT NULL,head TEXT,parent_branch_id TEXT REFERENCES branches(id),fork_commit_id TEXT,state_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(world_id,id)) STRICT;
CREATE TABLE commits(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,branch_id TEXT NOT NULL,seq INTEGER NOT NULL CHECK(seq>0),run_id TEXT NOT NULL,payload_hash TEXT NOT NULL,parent_commit_id TEXT REFERENCES commits(id),source_revision TEXT NOT NULL,user_text TEXT NOT NULL,narrative TEXT NOT NULL,operations_json TEXT NOT NULL,source TEXT NOT NULL,author INTEGER NOT NULL CHECK(author IN (0,1)),after_json TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(world_id,branch_id) REFERENCES branches(world_id,id),UNIQUE(branch_id,seq),UNIQUE(world_id,branch_id,run_id)) STRICT;
CREATE INDEX commits_parent ON commits(parent_commit_id);
CREATE TABLE events(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,branch_id TEXT NOT NULL,commit_id TEXT NOT NULL REFERENCES commits(id),ordinal INTEGER NOT NULL,operation_json TEXT NOT NULL,FOREIGN KEY(world_id,branch_id) REFERENCES branches(world_id,id),UNIQUE(commit_id,ordinal)) STRICT;
CREATE TABLE outbox(world_id TEXT NOT NULL,branch_id TEXT NOT NULL,commit_id TEXT NOT NULL REFERENCES commits(id),status TEXT NOT NULL CHECK(status IN ('pending','delivered')),PRIMARY KEY(world_id,branch_id,commit_id),FOREIGN KEY(world_id,branch_id) REFERENCES branches(world_id,id)) STRICT;
CREATE TABLE attempts(attempt_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,branch_id TEXT NOT NULL,run_id TEXT NOT NULL,mode TEXT NOT NULL,input_tokens INTEGER,cached_input_tokens INTEGER,output_tokens INTEGER,status TEXT NOT NULL,error_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(world_id,branch_id) REFERENCES branches(world_id,id)) STRICT;
CREATE INDEX attempts_scope ON attempts(world_id,branch_id,created_at);
CREATE TABLE runs(run_id TEXT NOT NULL,world_id TEXT NOT NULL,branch_id TEXT NOT NULL,fixed_hash TEXT NOT NULL,expected_head TEXT,source_revision TEXT NOT NULL,user_text TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,draft TEXT NOT NULL,operations_json TEXT,error_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(world_id,branch_id) REFERENCES branches(world_id,id),PRIMARY KEY(world_id,branch_id,run_id)) STRICT;
CREATE INDEX runs_scope ON runs(world_id,branch_id,created_at);
`;
// Refuse a look-alike, partially migrated, or extended database instead of guessing
// how to migrate it. A shipped schema change must get an explicit migration.
const SCHEMA_FINGERPRINT = hash(
  schema
    .split(";")
    .map((sql) => sql.trim())
    .filter(Boolean)
    .sort(),
);
/** Single authoritative database for WorldMode. All synchronous writes use BEGIN IMMEDIATE. */
export class WorldStore {
  #db;
  #closed = false;
  #backups = 0;
  constructor(dataDir) {
    const directory = safeDirectory(dataDir);
    const file = join(directory, "world.sqlite");
    for (const suffix of ["", "-wal", "-shm"]) {
      pathCheck(file + suffix);
      try {
        if (!lstatSync(file + suffix).isFile())
          fail("UNSAFE_PATH", "Database path must be a regular file");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    try {
      this.#db = new DatabaseSync(file, {
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
      });
      this.#db.exec("PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;");
      const version = this.#db
        .prepare("PRAGMA user_version")
        .get().user_version;
      const tables = this.#db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      const objects = this.#db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      if (version === 0 && objects.length === 0) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(schema);
          this.#db
            .prepare("INSERT INTO metadata VALUES(?,?)")
            .run("format", FORMAT);
          this.#db
            .prepare("INSERT INTO metadata VALUES(?,?)")
            .run("version", String(VERSION));
          this.#db.exec(`PRAGMA user_version=${VERSION}; COMMIT`);
        } catch (error) {
          this.#db.exec("ROLLBACK");
          throw error;
        }
      } else {
        if (![1, VERSION].includes(version))
          fail(
            "UNSUPPORTED_SCHEMA",
            "Database schema needs an explicit supported migration",
          );
        const meta = tables.some((x) => x.name === "metadata")
          ? this.#db
              .prepare("SELECT value FROM metadata WHERE key='format'")
              .get()
          : null;
        const storedVersion = tables.some((x) => x.name === "metadata")
          ? this.#db
              .prepare("SELECT value FROM metadata WHERE key='version'")
              .get()
          : null;
        if (storedVersion?.value !== String(version))
          fail(
            "UNSUPPORTED_SCHEMA",
            "Database metadata schema version is unsupported",
          );
        if (meta?.value !== FORMAT)
          fail("UNSUPPORTED_SCHEMA", "Database is not a WorldMode database");
        const expected = [
          "metadata",
          "worlds",
          "branches",
          "commits",
          "events",
          "outbox",
          "attempts",
          "runs",
        ];
        if (expected.some((name) => !tables.some((t) => t.name === name)))
          fail("UNSUPPORTED_SCHEMA", "WorldMode schema is incomplete");
      }
      const actualSchema = this.#db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((row) => row.sql.trim())
        .sort();
      if (hash(actualSchema) !== SCHEMA_FINGERPRINT)
        fail(
          "UNSUPPORTED_SCHEMA",
          "WorldMode schema differs from the supported format",
        );
      this.#db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
      );
      const check = this.#db.prepare("PRAGMA quick_check").get();
      if (Object.values(check)[0] !== "ok")
        fail("CORRUPT_DATABASE", "Database integrity check failed");
      if (this.#db.prepare("PRAGMA foreign_key_check").all().length)
        fail("CORRUPT_DATABASE", "Database reference integrity check failed");
      if (version === 1) {
        // The relational layout is unchanged. Version 2 makes immutable audience,
        // checkpoint and notification metadata mandatory for interpreting new data.
        // Older applications reject it instead of ignoring privacy metadata.
        const backupName = `world-v1-before-v2-${randomUUID()}.sqlite`;
        const backupFile = join(directory, backupName);
        this.#db.prepare("VACUUM INTO ?").run(backupFile);
        const backupFd = openSync(backupFile, "r");
        try {
          fsyncSync(backupFd);
        } finally {
          closeSync(backupFd);
        }
        const directoryFd = openSync(directory, "r");
        try {
          fsyncSync(directoryFd);
        } finally {
          closeSync(directoryFd);
        }
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db
            .prepare("UPDATE metadata SET value=? WHERE key='version'")
            .run(String(VERSION));
          this.#db
            .prepare("INSERT INTO metadata VALUES(?,?)")
            .run(
              "migration:v1-v2",
              JSON.stringify({
                from: 1,
                to: 2,
                backupName,
                createdAt: new Date().toISOString(),
              }),
            );
          this.#db.exec(`PRAGMA user_version=${VERSION}; COMMIT`);
        } catch (migrationError) {
          this.#db.exec("ROLLBACK");
          throw migrationError;
        }
      }
    } catch (error) {
      try {
        this.#db?.close();
      } catch {}
      this.#closed = true;
      if (error.code?.startsWith("ERR_SQLITE"))
        fail("INVALID_DATABASE", "Cannot open WorldMode database");
      throw error;
    }
  }
  #open() {
    if (this.#closed) fail("STORE_CLOSED", "World store is closed");
  }
  #tx(fn, write = true) {
    this.#open();
    let began = false;
    try {
      this.#db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
      began = true;
      const value = fn();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        if (began) this.#db.exec("ROLLBACK");
      } catch {}
      if (error.code?.startsWith("ERR_SQLITE"))
        fail(
          error.errcode === 5 ? "STORE_BUSY" : "STORAGE_ERROR",
          "World storage transaction failed",
        );
      throw error;
    }
  }
  close() {
    if (this.#closed) return;
    if (this.#backups)
      fail("BACKUP_ACTIVE", "Wait for active backups before closing the store");
    this.#db.close();
    this.#closed = true;
  }
  #world(worldId) {
    identifier(worldId, "worldId");
    const world = this.#db
      .prepare("SELECT * FROM worlds WHERE id=?")
      .get(worldId);
    if (!world) fail("UNKNOWN_WORLD", "World does not exist");
    return world;
  }
  #branch(worldId, branchId) {
    identifier(branchId, "branchId");
    const branch = this.#db
      .prepare("SELECT * FROM branches WHERE world_id=? AND id=?")
      .get(worldId, branchId);
    if (!branch) fail("UNKNOWN_BRANCH", "Branch does not exist in this world");
    return branch;
  }
  #history(branch) {
    const rows = [];
    let id = branch.head;
    const visited = new Set();
    while (id) {
      if (visited.has(id) || rows.length >= 100000)
        fail("CORRUPT_DATABASE", "Invalid commit ancestry");
      visited.add(id);
      const row = this.#db
        .prepare("SELECT * FROM commits WHERE id=? AND world_id=?")
        .get(id, branch.world_id);
      if (!row) fail("CORRUPT_DATABASE", "Missing commit ancestor");
      rows.push(row);
      id = row.parent_commit_id;
    }
    return rows.reverse();
  }
  #run(row) {
    return row
      ? {
          worldId: row.world_id,
          branchId: row.branch_id,
          runId: row.run_id,
          expectedHead: row.expected_head,
          sourceRevision: row.source_revision,
          userText: row.user_text,
          mode: row.mode,
          status: row.status,
          draft: row.draft,
          operations:
            row.operations_json === null
              ? null
              : JSON.parse(row.operations_json),
          error: row.error_json === null ? null : JSON.parse(row.error_json),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }
  #usage(row) {
    return {
      runId: row.run_id,
      attemptId: row.attempt_id,
      mode: row.mode,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      status: row.status,
    };
  }
  #sceneVisibility(row) {
    const saved = this.#db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get("scene-visibility:" + row.id);
    return saved
      ? JSON.parse(saved.value)
      : {
          audience:
            row.author || ["author", "revision"].includes(row.source)
              ? "author"
              : "public",
          publicNarrative: null,
        };
  }
  #snapshot(worldId, branchId) {
    const w = this.#world(worldId);
    const b = this.#branch(worldId, branchId ?? w.active_branch_id);
    const history = this.#history(b);
    const pending = this.#db
      .prepare(
        "SELECT commit_id,status FROM outbox WHERE world_id=? AND branch_id=?",
      )
      .all(worldId, b.id);
    const statuses = new Map(pending.map((x) => [x.commit_id, x.status]));
    return {
      world: {
        id: w.id,
        name: w.name,
        activeBranchId: w.active_branch_id,
        card: JSON.parse(w.card_json),
        createdAt: w.created_at,
      },
      branch: {
        id: b.id,
        name: b.name,
        head: b.head,
        sourceRevision: w.source_revision,
        parentBranchId: b.parent_branch_id,
        forkCommitId: b.fork_commit_id,
      },
      state: JSON.parse(b.state_json),
      scenes: history.map((row) => ({
        ...this.#sceneVisibility(row),
        id: row.id,
        branchId: row.branch_id,
        seq: row.seq,
        runId: row.run_id,
        userText: row.user_text,
        narrative: row.narrative,
        operations: JSON.parse(row.operations_json),
        source: row.source,
        createdAt: row.created_at,
        inherited: row.branch_id !== b.id,
      })),
      branches: this.#db
        .prepare(
          "SELECT id,name,head FROM branches WHERE world_id=? ORDER BY created_at,id",
        )
        .all(worldId)
        .map((row) => ({
          ...row,
        })),
      outbox: history
        .filter((row) => statuses.has(row.id))
        .map((row) => ({
          commitId: row.id,
          status: statuses.get(row.id),
        })),
      notices: history.flatMap((row) => {
        const record = this.#db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get("scene-notice:" + row.id);
        return record ? [JSON.parse(record.value)] : [];
      }),
      usage: this.#db
        .prepare(
          "SELECT * FROM attempts WHERE world_id=? AND branch_id=? ORDER BY created_at,attempt_id",
        )
        .all(worldId, b.id)
        .map((row) => this.#usage(row)),
      runs: this.#db
        .prepare(
          "SELECT * FROM runs WHERE world_id=? AND branch_id=? ORDER BY created_at DESC,run_id DESC LIMIT 50",
        )
        .all(worldId, b.id)
        .map((row) => this.#run(row)),
    };
  }
  snapshot(worldId, branchId) {
    return this.#tx(() => this.#snapshot(worldId, branchId), false);
  }
  listWorlds() {
    return this.#tx(
      () =>
        this.#db
          .prepare("SELECT * FROM worlds ORDER BY created_at,id")
          .all()
          .map((w) => ({
            id: w.id,
            name: w.name,
            activeBranchId: w.active_branch_id,
            createdAt: w.created_at,
            updatedAt: w.updated_at,
          })),
      false,
    );
  }
  createWorld(input) {
    object(input, "createWorld", ["name", "card"]);
    text(input.name, "world name", 512);
    const state = initialState(input.card);
    const now = new Date().toISOString(),
      worldId = randomUUID(),
      branchId = randomUUID();
    return this.#tx(() => {
      this.#db
        .prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?,?,?)")
        .run(
          worldId,
          input.name,
          branchId,
          JSON.stringify(input.card),
          JSON.stringify(state),
          randomUUID(),
          now,
          now,
        );
      this.#db
        .prepare("INSERT INTO branches VALUES(?,?,?,?,?,?,?,?)")
        .run(
          branchId,
          worldId,
          "主线",
          null,
          null,
          null,
          JSON.stringify(state),
          now,
        );
      return this.#snapshot(worldId, branchId);
    });
  }
  #commitInput(input) {
    object(input, "commit", [
      "worldId",
      "branchId",
      "runId",
      "expectedHead",
      "sourceRevision",
      "userText",
      "narrative",
      "operations",
      "source",
      "usage",
      "author",
      "publicNarrative",
    ]);
    identifier(input.worldId, "worldId");
    identifier(input.branchId, "branchId");
    identifier(input.runId, "runId");
    nullableId(input.expectedHead, "expectedHead");
    identifier(input.sourceRevision, "sourceRevision");
    text(input.userText, "user text", 128 * 1024, true);
    text(input.narrative, "narrative", 512 * 1024, true);
    text(input.source ?? "turn", "source", 64);
    if (input.publicNarrative !== undefined) {
      if (input.author !== true)
        fail(
          "AUTHOR_REQUIRED",
          "Only explicit author publishing may set player narrative",
        );
      text(input.publicNarrative, "public narrative", 512 * 1024, true);
    }
    if (input.author !== undefined && typeof input.author !== "boolean")
      fail("INVALID_INPUT", "author must be boolean");
    if (!Array.isArray(input.operations) || input.operations.length > 100)
      fail("INVALID_INPUT", "Invalid operations");
    jsonValue(input.operations);
    if (input.usage !== undefined && input.usage !== null) {
      object(input.usage, "usage", [
        "attemptId",
        "mode",
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "status",
        "error",
      ]);
      jsonValue(input.usage);
    }
    return {
      ...input,
      source: input.source ?? "turn",
      usage: input.usage ?? null,
      author: input.author ?? false,
    };
  }
  prepareContextCheckpoint(worldId, branchId, actorId = "player", stagedState) {
    identifier(actorId, "actorId");
    return this.#tx(() => {
      const snapshot = this.#snapshot(worldId, branchId),
        record = contextCheckpoint(
          stagedState ? { ...snapshot, state: clone(stagedState) } : snapshot,
          actorId,
        ),
        key = "context-checkpoint:" + record.epoch;
      const existing = this.#db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      if (existing) return JSON.parse(existing.value);
      const saved = { ...record, createdAt: new Date().toISOString() };
      this.#db
        .prepare("INSERT INTO metadata VALUES(?,?)")
        .run(key, JSON.stringify(saved));
      return saved;
    });
  }
  reserveRunEntityIds(worldId, branchId, runId) {
    identifier(runId, "runId");
    return this.#tx(() => {
      this.#world(worldId);
      this.#branch(worldId, branchId);
      if (
        !this.#db
          .prepare(
            "SELECT 1 FROM runs WHERE world_id=? AND branch_id=? AND run_id=?",
          )
          .get(worldId, branchId, runId)
      )
        fail("UNKNOWN_RUN", "Reserve IDs only for an accepted run");
      const key =
        "entity-reservations:" + JSON.stringify([worldId, branchId, runId]);
      const row = this.#db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      if (row) return JSON.parse(row.value);
      const ids = Array.from({ length: 100 }, () => randomUUID());
      this.#db
        .prepare("INSERT INTO metadata VALUES(?,?)")
        .run(key, JSON.stringify(ids));
      return ids;
    });
  }
  #commit(input, transform) {
    const w = this.#world(input.worldId),
      b = this.#branch(input.worldId, input.branchId);
    const fingerprint = hash(input);
    const prior = this.#db
      .prepare(
        "SELECT * FROM commits WHERE world_id=? AND branch_id=? AND run_id=?",
      )
      .get(input.worldId, input.branchId, input.runId);
    if (prior) {
      if (
        prior.world_id !== input.worldId ||
        prior.branch_id !== input.branchId ||
        prior.payload_hash !== fingerprint
      )
        fail(
          "RUN_CONFLICT",
          "Run ID was already used with a different payload",
        );
      return {
        commitId: prior.id,
        seq: prior.seq,
        reused: true,
        snapshot: this.#snapshot(w.id, b.id),
      };
    }
    if (b.head !== input.expectedHead)
      fail(
        "STALE_HEAD",
        "The branch changed; review the current state before retrying",
      );
    if (w.source_revision !== input.sourceRevision)
      fail("STALE_SOURCE", "The source revision changed");
    const commitId = randomUUID();
    const state = JSON.parse(b.state_json);
    const reservation = this.#db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get("entity-reservations:" + JSON.stringify([w.id, b.id, input.runId]));
    applyOperations(state, input.operations, {
      commitId,
      entityIds: reservation ? JSON.parse(reservation.value) : undefined,
      author: input.author,
    });
    if (transform) transform(state, commitId);
    const seq = b.head
      ? this.#db.prepare("SELECT seq FROM commits WHERE id=?").get(b.head).seq +
        1
      : 1;
    const now = new Date().toISOString();
    this.#db
      .prepare("INSERT INTO commits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        commitId,
        w.id,
        b.id,
        seq,
        input.runId,
        fingerprint,
        b.head,
        w.source_revision,
        input.userText,
        input.narrative,
        JSON.stringify(input.operations),
        input.source,
        input.author ? 1 : 0,
        JSON.stringify(state),
        now,
      );
    this.#db.prepare("INSERT INTO metadata VALUES(?,?)").run(
      "scene-visibility:" + commitId,
      JSON.stringify({
        audience:
          input.author || ["author", "revision"].includes(input.source)
            ? "author"
            : "public",
        publicNarrative: input.publicNarrative ?? null,
      }),
    );
    let noticeText = "";
    try {
      noticeText = runBehaviors(
        JSON.parse(w.card_json),
        state,
        "post_commit",
        "",
      ).text;
    } catch {
      noticeText = "提交后通知规则无效，世界已保存。";
    }
    if (noticeText)
      this.#db.prepare("INSERT INTO metadata VALUES(?,?)").run(
        "scene-notice:" + commitId,
        JSON.stringify({
          commitId,
          runId: input.runId,
          type: "post_commit",
          text: noticeText,
        }),
      );
    storeFault(this, "after-body");
    input.operations.forEach((op, index) =>
      this.#db
        .prepare("INSERT INTO events VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), w.id, b.id, commitId, index, JSON.stringify(op)),
    );
    this.#db
      .prepare(
        "UPDATE branches SET head=?,state_json=? WHERE id=? AND world_id=?",
      )
      .run(commitId, JSON.stringify(state), b.id, w.id);
    storeFault(this, "after-state");
    this.#db
      .prepare("INSERT INTO outbox VALUES(?,?,?,?)")
      .run(w.id, b.id, commitId, "pending");
    this.#db
      .prepare("UPDATE worlds SET updated_at=? WHERE id=?")
      .run(now, w.id);
    const run = this.#db
      .prepare(
        "SELECT * FROM runs WHERE world_id=? AND branch_id=? AND run_id=?",
      )
      .get(input.worldId, input.branchId, input.runId);
    if (run) {
      if (run.status === "cancelled")
        fail("RUN_CANCELLED", "Cancelled runs cannot commit");
      if (
        run.world_id !== w.id ||
        run.branch_id !== b.id ||
        run.user_text !== input.userText ||
        run.expected_head !== input.expectedHead ||
        run.source_revision !== input.sourceRevision
      )
        fail("RUN_CONFLICT", "Committed payload differs from saved run");
      this.#db
        .prepare(
          "UPDATE runs SET status='committed',draft=?,operations_json=?,error_json=NULL,updated_at=? WHERE world_id=? AND branch_id=? AND run_id=?",
        )
        .run(
          input.narrative,
          JSON.stringify(input.operations),
          now,
          input.worldId,
          input.branchId,
          input.runId,
        );
    }
    if (input.usage)
      this.#recordAttempt({
        ...input.usage,
        worldId: w.id,
        branchId: b.id,
        runId: input.runId,
      });
    storeFault(this, "before-commit");
    return {
      commitId,
      seq,
      reused: false,
      snapshot: this.#snapshot(w.id, b.id),
    };
  }
  commit(input) {
    const normalized = this.#commitInput(input);
    return this.#tx(() => this.#commit(normalized));
  }
  markProjected(worldId, branchId, commitId) {
    identifier(commitId, "commitId");
    return this.#tx(() => {
      this.#world(worldId);
      this.#branch(worldId, branchId);
      const item = this.#db
        .prepare(
          "SELECT status FROM outbox WHERE world_id=? AND branch_id=? AND commit_id=?",
        )
        .get(worldId, branchId, commitId);
      if (!item)
        fail("UNKNOWN_PROJECTION", "Commit has no projection in this branch");
      this.#db
        .prepare(
          "UPDATE outbox SET status='delivered' WHERE world_id=? AND branch_id=? AND commit_id=?",
        )
        .run(worldId, branchId, commitId);
      return {
        commitId,
        status: "delivered",
      };
    });
  }
  fork(input) {
    object(input, "fork", ["worldId", "branchId", "commitId", "name"]);
    text(input.name, "branch name", 512);
    nullableId(input.commitId, "commitId");
    return this.#tx(() => this.#fork(input));
  }
  #fork(input) {
    const w = this.#world(input.worldId),
      parent = this.#branch(w.id, input.branchId);
    const history = this.#history(parent);
    const index =
      input.commitId === null
        ? -1
        : history.findIndex((c) => c.id === input.commitId);
    if (input.commitId !== null && index < 0)
      fail("INVALID_FORK", "Fork point is not reachable from this branch");
    const state =
      input.commitId === null ? w.genesis_json : history[index].after_json;
    const id = randomUUID(),
      now = new Date().toISOString();
    this.#db
      .prepare("INSERT INTO branches VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        w.id,
        input.name,
        input.commitId,
        parent.id,
        input.commitId,
        state,
        now,
      );
    for (const scene of history.slice(0, index + 1))
      this.#db
        .prepare("INSERT INTO outbox VALUES(?,?,?,?)")
        .run(w.id, id, scene.id, "pending");
    this.#db
      .prepare("UPDATE worlds SET active_branch_id=?,updated_at=? WHERE id=?")
      .run(id, now, w.id);
    return this.#snapshot(w.id, id);
  }
  // Revisions never mutate an immutable scene. The fork and replacement scene
  // share one transaction, so an invalid replacement cannot leave a stray branch.
  revise(input) {
    object(input, "revision", [
      "worldId",
      "branchId",
      "commitId",
      "name",
      "narrative",
      "operations",
      "publicNarrative",
    ]);
    identifier(input.commitId, "commitId");
    text(input.name, "branch name", 512);
    text(input.narrative, "narrative", 512 * 1024, true);
    return this.#tx(() => {
      const world = this.#world(input.worldId);
      const original = this.#branch(world.id, input.branchId);
      const target = this.#history(original).find(
        (scene) => scene.id === input.commitId,
      );
      if (!target)
        fail(
          "INVALID_FORK",
          "Revision scene is not reachable from this branch",
        );
      const fork = this.#fork({
        worldId: world.id,
        branchId: original.id,
        commitId: target.parent_commit_id,
        name: input.name,
      });
      const replacement = this.#commitInput({
        worldId: world.id,
        branchId: fork.branch.id,
        runId: randomUUID(),
        expectedHead: fork.branch.head,
        sourceRevision: world.source_revision,
        userText: target.user_text,
        narrative: input.narrative,
        publicNarrative: input.publicNarrative,
        operations: input.operations,
        source: "author-revision",
        author: true,
      });
      return this.#commit(replacement).snapshot;
    });
  }
  selectBranch(worldId, branchId) {
    return this.#tx(() => {
      this.#world(worldId);
      this.#branch(worldId, branchId);
      this.#db
        .prepare("UPDATE worlds SET active_branch_id=?,updated_at=? WHERE id=?")
        .run(branchId, new Date().toISOString(), worldId);
      return this.#snapshot(worldId, branchId);
    });
  }
  advance(input) {
    object(input, "advance", ["worldId", "branchId", "to", "maxEvents"]);
    integer(input.to, "to");
    const maxEvents = integer(input.maxEvents ?? 10, "maxEvents", 1, 100);
    return this.#tx(() => {
      const w = this.#world(input.worldId);
      let b = this.#branch(w.id, input.branchId),
        state = JSON.parse(b.state_json);
      if (input.to < state.time)
        fail("INVALID_TIME", "World time cannot move backwards");
      const due = state.schedules
        .filter((s) => s.status === "pending" && s.at <= input.to)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .slice(0, maxEvents);
      const executed = [],
        cancelled = [];
      for (const schedule of due) {
        b = this.#branch(w.id, b.id);
        state = JSON.parse(b.state_json);
        const current = state.schedules.find((s) => s.id === schedule.id);
        if (current.status !== "pending") continue;
        let valid = true,
          cancellationReason = null;
        try {
          if (current.precondition)
            valid = checkPrecondition(
              current.preconditionMode === "world"
                ? state
                : actorState(state, current.entityId),
              current.precondition,
              current.entityId,
            );
        } catch (error) {
          if (
            ![
              "UNKNOWN_ENTITY",
              "UNKNOWN_ACTOR",
              "UNKNOWN_REFERENCE",
              "INVALID_INPUT",
            ].includes(error.code)
          )
            throw error;
          valid = false;
          cancellationReason = error.code;
        }
        if (current.goalId) {
          const goal = state.goals.find((g) => g.id === current.goalId);
          valid = valid && !!goal && goal.status === "active";
        }
        if (valid) {
          try {
            applyOperations(clone(state), current.operations, {
              author: false,
              scheduled: true,
            });
          } catch (error) {
            if (
              ![
                "INVALID_INVENTORY",
                "INVALID_VARIABLE",
                "LOCKED_FACT",
                "LOCKED_FIELD",
                "UNKNOWN_ENTITY",
                "UNKNOWN_REFERENCE",
                "INVALID_INPUT",
              ].includes(error.code)
            )
              throw error;
            valid = false;
            cancellationReason = error.code;
          }
        }
        const runId = `schedule:${b.id}:${current.id}`;
        const normalized = this.#commitInput({
          worldId: w.id,
          branchId: b.id,
          runId,
          expectedHead: b.head,
          sourceRevision: w.source_revision,
          userText: "",
          narrative: valid ? current.label : `日程已取消：${current.label}`,
          operations: valid ? current.operations : [],
          source: "schedule",
          author: false,
        });
        this.#commit(normalized, (next) => {
          next.time = Math.max(next.time, current.at);
          const item = next.schedules.find((s) => s.id === current.id);
          item.status = valid ? "executed" : "cancelled";
          if (!valid)
            item.cancellationReason =
              cancellationReason || "ACTOR_PRECONDITION_CHANGED";
        });
        (valid ? executed : cancelled).push(current.id);
      }
      b = this.#branch(w.id, b.id);
      state = JSON.parse(b.state_json);
      const remaining = state.schedules.some(
        (s) => s.status === "pending" && s.at <= input.to,
      );
      if (!remaining && state.time < input.to) {
        const normalized = this.#commitInput({
          worldId: w.id,
          branchId: b.id,
          runId: `clock:${b.id}:${b.head ?? "genesis"}:${input.to}`,
          expectedHead: b.head,
          sourceRevision: w.source_revision,
          userText: "",
          narrative: `世界时间推进至 ${input.to}`,
          operations: [],
          source: "time",
          author: false,
        });
        this.#commit(normalized, (next) => {
          next.time = input.to;
        });
      }
      return {
        snapshot: this.#snapshot(w.id, b.id),
        executed,
        cancelled,
      };
    });
  }
  #recordAttempt(input) {
    object(input, "attempt", [
      "worldId",
      "branchId",
      "runId",
      "attemptId",
      "mode",
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
      "status",
      "error",
    ]);
    this.#world(input.worldId);
    this.#branch(input.worldId, input.branchId);
    identifier(input.runId, "runId");
    identifier(input.attemptId, "attemptId");
    if (!["demo", "openai"].includes(input.mode))
      fail("INVALID_INPUT", "Invalid attempt mode");
    if (!ATTEMPT_STATES.includes(input.status))
      fail("INVALID_INPUT", "Invalid attempt status");
    const n = {
      ...input,
      inputTokens: token(input.inputTokens, "inputTokens"),
      cachedInputTokens: token(input.cachedInputTokens, "cachedInputTokens"),
      outputTokens: token(input.outputTokens, "outputTokens"),
      error: errorText(input.error),
    };
    if (
      n.cachedInputTokens !== null &&
      n.inputTokens !== null &&
      n.cachedInputTokens > n.inputTokens
    )
      fail("INVALID_INPUT", "Cached tokens cannot exceed input tokens");
    const prior = this.#db
      .prepare("SELECT * FROM attempts WHERE attempt_id=?")
      .get(n.attemptId);
    if (prior) {
      if (
        prior.world_id !== n.worldId ||
        prior.branch_id !== n.branchId ||
        prior.run_id !== n.runId ||
        prior.mode !== n.mode
      )
        fail(
          "ATTEMPT_CONFLICT",
          "Attempt ID was already used in another scope",
        );
      if (prior.status !== "started") {
        if (
          canonical(this.#usage(prior)) !==
            canonical({
              runId: n.runId,
              attemptId: n.attemptId,
              mode: n.mode,
              inputTokens: n.inputTokens,
              cachedInputTokens: n.cachedInputTokens,
              outputTokens: n.outputTokens,
              status: n.status,
            }) ||
          canonical(JSON.parse(prior.error_json)) !== canonical(n.error)
        )
          fail("ATTEMPT_CONFLICT", "Final attempt data cannot be overwritten");
        return this.#usage(prior);
      }
    }
    const now = new Date().toISOString();
    this.#db
      .prepare(
        "INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET input_tokens=excluded.input_tokens,cached_input_tokens=excluded.cached_input_tokens,output_tokens=excluded.output_tokens,status=excluded.status,error_json=excluded.error_json,updated_at=excluded.updated_at",
      )
      .run(
        n.attemptId,
        n.worldId,
        n.branchId,
        n.runId,
        n.mode,
        n.inputTokens,
        n.cachedInputTokens,
        n.outputTokens,
        n.status,
        JSON.stringify(n.error),
        prior?.created_at ?? now,
        now,
      );
    return this.#usage(
      this.#db
        .prepare("SELECT * FROM attempts WHERE attempt_id=?")
        .get(n.attemptId),
    );
  }
  recordAttempt(input) {
    return this.#tx(() => this.#recordAttempt(input));
  }
  saveRun(input) {
    object(input, "run", [
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
    ]);
    identifier(input.runId, "runId");
    nullableId(input.expectedHead, "expectedHead");
    identifier(input.sourceRevision, "sourceRevision");
    text(input.userText, "user text", 128 * 1024, true);
    text(input.draft, "draft", 512 * 1024, true);
    if (
      !["demo", "openai"].includes(input.mode) ||
      !RUN_STATES.includes(input.status)
    )
      fail("INVALID_INPUT", "Invalid run mode or status");
    if (input.operations !== undefined && input.operations !== null) {
      if (!Array.isArray(input.operations) || input.operations.length > 100)
        fail("INVALID_INPUT", "Invalid proposed operations");
      jsonValue(input.operations);
    }
    const err = errorText(input.error);
    const fixed = hash({
      worldId: input.worldId,
      branchId: input.branchId,
      runId: input.runId,
      expectedHead: input.expectedHead,
      sourceRevision: input.sourceRevision,
      userText: input.userText,
      mode: input.mode,
    });
    return this.#tx(() => {
      const w = this.#world(input.worldId);
      this.#branch(w.id, input.branchId);
      const prior = this.#db
        .prepare(
          "SELECT * FROM runs WHERE world_id=? AND branch_id=? AND run_id=?",
        )
        .get(input.worldId, input.branchId, input.runId);
      if (prior && prior.fixed_hash !== fixed)
        fail(
          "RUN_CONFLICT",
          "Run ID was already used with a different request",
        );
      if (prior?.status === "cancelled") {
        if (input.status !== "cancelled" || input.draft !== prior.draft)
          fail("RUN_CANCELLED", "Cancelled runs cannot be resumed");
        return this.#run(prior);
      }
      if (!prior) {
        const branch = this.#branch(w.id, input.branchId);
        if (branch.head !== input.expectedHead)
          fail("STALE_HEAD", "The branch changed before the run was saved");
        if (w.source_revision !== input.sourceRevision)
          fail("STALE_SOURCE", "The source revision changed");
      }
      if (prior?.status === "committed") {
        if (input.status !== "committed" || prior.draft !== input.draft)
          fail("RUN_CONFLICT", "Committed run cannot be changed");
        return this.#run(prior);
      }
      if (
        input.status === "committed" &&
        !this.#db
          .prepare(
            "SELECT id FROM commits WHERE run_id=? AND world_id=? AND branch_id=?",
          )
          .get(input.runId, w.id, input.branchId)
      )
        fail(
          "INVALID_RUN_STATE",
          "Only a committed world transaction may mark a run committed",
        );
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(world_id,branch_id,run_id) DO UPDATE SET status=excluded.status,draft=excluded.draft,operations_json=excluded.operations_json,error_json=excluded.error_json,updated_at=excluded.updated_at",
        )
        .run(
          input.runId,
          w.id,
          input.branchId,
          fixed,
          input.expectedHead,
          input.sourceRevision,
          input.userText,
          input.mode,
          input.status,
          input.draft,
          JSON.stringify(input.operations ?? null),
          JSON.stringify(err),
          prior?.created_at ?? now,
          now,
        );
      return this.#run(
        this.#db
          .prepare(
            "SELECT * FROM runs WHERE world_id=? AND branch_id=? AND run_id=?",
          )
          .get(input.worldId, input.branchId, input.runId),
      );
    });
  }
  getRun(worldId, branchId, runId) {
    identifier(runId, "runId");
    return this.#tx(() => {
      this.#world(worldId);
      this.#branch(worldId, branchId);
      return this.#run(
        this.#db
          .prepare(
            "SELECT * FROM runs WHERE world_id=? AND branch_id=? AND run_id=?",
          )
          .get(worldId, branchId, runId),
      );
    }, false);
  }
  listRuns(worldId, branchId) {
    return this.#tx(() => {
      this.#world(worldId);
      this.#branch(worldId, branchId);
      return this.#db
        .prepare(
          "SELECT * FROM runs WHERE world_id=? AND branch_id=? ORDER BY created_at,run_id",
        )
        .all(worldId, branchId)
        .map((row) => this.#run(row));
    }, false);
  }
  resetProjectionReceipts() {
    return this.#tx(() => {
      const result = this.#db
        .prepare("UPDATE outbox SET status='pending' WHERE status='delivered'")
        .run();
      return {
        reset: result.changes,
      };
    });
  }
  async backup(path) {
    this.#open();
    text(path, "backup path", 4096);
    const destination = pathCheck(path);
    safeDirectory(dirname(destination));
    let reserved = false;
    try {
      const fd = openSync(destination, "wx", 0o600);
      closeSync(fd);
      reserved = true;
    } catch (error) {
      if (error.code === "EEXIST")
        fail("BACKUP_EXISTS", "Backup destination already exists");
      throw error;
    }
    this.#backups++;
    try {
      await sqliteBackup(this.#db, destination);
      return {
        path: destination,
        format: FORMAT,
        version: VERSION,
      };
    } catch (error) {
      if (reserved) {
        try {
          unlinkSync(destination);
        } catch {}
      }
      fail("BACKUP_FAILED", "SQLite online backup failed");
    } finally {
      this.#backups--;
    }
  }
}
