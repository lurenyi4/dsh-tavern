import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  DatabaseSync
} from 'node:sqlite';
import {
  WorldStore
} from '../src/store.mjs';
import {
  injectStoreFaultForTests
} from '../src/store-test-support.mjs';
const card={
  name:'Hero',
  description:'Background',
  extensions:{
    story_runtime:{
      characters:[{
        id:'npc',
        name:'NPC'
      }],
      variables:{
        score:0
      }
    }
  }
};
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(), 'world-recovery-'));
  const store=new WorldStore(join(dir, 'nested', 'data'));
  t.after(()=>{
    store.close();
    rmSync(dir, {
      recursive:true,
      force:true
    });
  });
  const s=store.createWorld({
    name:'World',
    card
  });
  return {
    store,
    dir,
    data:join(dir, 'nested', 'data'),
    s
  };
}
function payload(s, extra={
}){
  return {
    worldId:s.world.id,
    branchId:s.branch.id,
    runId:crypto.randomUUID(),
    expectedHead:s.branch.head,
    sourceRevision:s.branch.sourceRevision,
    userText:'Question',
    narrative:'Answer',
    operations:[],
    ...extra
  };
}
function run(s, extra={
}){
  return {
    worldId:s.world.id,
    branchId:s.branch.id,
    runId:'durable-run',
    expectedHead:s.branch.head,
    sourceRevision:s.branch.sourceRevision,
    userText:'Question',
    mode:'demo',
    status:'accepted',
    draft:'',
    ...extra
  };
}
test('durable draft survives restart and commits atomically with usage', t=>{
  const {
    store,
    s,
    data
  }
  =fixture(t);
  store.saveRun(run(s));
  store.saveRun(run(s, {
    status:'draft',
    draft:'Answer',
    operations:[{
      op:'set_variable',
      key:'score',
      value:1
    }]
  }));
  assert.equal(store.snapshot(s.world.id).scenes.length, 0);
  store.close();
  const b=new WorldStore(data);
  t.after(()=>b.close());
  assert.equal(b.getRun(s.world.id, s.branch.id, 'durable-run').draft, 'Answer');
  const a=b.commit(payload(s, {
    runId:'durable-run',
    operations:[{
      op:'set_variable',
      key:'score',
      value:1
    }],
    usage:{
      attemptId:'attempt-one',
      mode:'demo',
      status:'completed',
      inputTokens:null,
      cachedInputTokens:null,
      outputTokens:null
    }
  }));
  assert.equal(a.snapshot.runs[0].status, 'committed');
  assert.equal(a.snapshot.usage[0].inputTokens, null);
  assert.equal(a.snapshot.state.variables.score, 1);
  assert.throws(()=>b.saveRun(run(s, {
    status:'generating'
  })), {
    code:'RUN_CONFLICT'
  });
});
test('cancellation prevents late commit and run identity conflicts are scoped', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  store.saveRun(run(s));
  store.saveRun(run(s, {
    status:'cancelled',
    draft:'Partial'
  }));
  assert.throws(()=>store.commit(payload(s, {
    runId:'durable-run'
  })), {
    code:'RUN_CANCELLED'
  });
  assert.throws(()=>store.saveRun(run(s, {
    status:'generating',
    draft:'Partial'
  })), {
    code:'RUN_CANCELLED'
  });
  assert.throws(()=>store.saveRun(run(s, {
    userText:'Different'
  })), {
    code:'RUN_CONFLICT'
  });
  const other=store.createWorld({
    name:'Other',
    card
  });
  store.saveRun(run(other));
  assert.equal(store.getRun(other.world.id, other.branch.id, 'durable-run').status, 'accepted');
});
test('faults at each transaction stage leave body, events, state, outbox, usage and run unchanged', t=>{
  const {
    store,
    s,
    data
  }
  =fixture(t);
  store.saveRun(run(s, {
    status:'draft',
    draft:'Answer'
  }));
  for(const stage of ['after-body', 'after-state', 'before-commit']){
    injectStoreFaultForTests(store, at=>{
      if(at===stage)throw Object.assign(new Error('test fault'), {
        code:'TEST_FAULT'
      });
    });
    assert.throws(()=>store.commit(payload(s, {
      runId:'durable-run',
      operations:[{
        op:'set_variable',
        key:'score',
        value:8
      }],
      usage:{
        attemptId:'atomic-attempt',
        mode:'demo',
        status:'completed'
      }
    })), {
      code:'TEST_FAULT'
    });
    injectStoreFaultForTests(store, null);
    const after=store.snapshot(s.world.id);
    assert.equal(after.state.variables.score, 0);
    assert.equal(after.scenes.length, 0);
    assert.equal(after.outbox.length, 0);
    assert.equal(after.usage.length, 0);
    assert.equal(after.runs[0].status, 'draft');
    const db=new DatabaseSync(join(data, 'world.sqlite'), {
      readOnly:true
    });
    assert.equal(db.prepare('SELECT count(*) as n FROM events').get().n, 0);
    db.close();
  }
  const result=store.commit(payload(s, {
    runId:'durable-run'
  }));
  assert.equal(result.snapshot.scenes.length, 1);
});
test('independent database connections reject a stale second writer', t=>{
  const {
    store,
    s,
    data
  }
  =fixture(t);
  const second=new WorldStore(data);
  t.after(()=>second.close());
  const stale=second.snapshot(s.world.id);
  store.commit(payload(s, {
    operations:[{
      op:'set_variable',
      key:'score',
      value:1
    }]
  }));
  assert.throws(()=>second.commit(payload(stale, {
    operations:[{
      op:'set_variable',
      key:'score',
      value:9
    }]
  })), {
    code:'STALE_HEAD'
  });
  assert.equal(second.snapshot(s.world.id).state.variables.score, 1);
});
test('usage attempts track unknown tokens, are idempotent, cannot move scopes or revise terminal values', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const a={
    worldId:s.world.id,
    branchId:s.branch.id,
    runId:'run-one',
    attemptId:'attempt-one',
    mode:'openai',
    status:'started'
  };
  assert.equal(store.recordAttempt(a).inputTokens, null);
  store.recordAttempt({
    ...a,
    status:'completed',
    inputTokens:100,
    cachedInputTokens:60,
    outputTokens:20
  });
  store.recordAttempt({
    ...a,
    status:'completed',
    inputTokens:100,
    cachedInputTokens:60,
    outputTokens:20
  });
  assert.equal(store.snapshot(s.world.id).usage.length, 1);
  assert.throws(()=>store.recordAttempt({
    ...a,
    status:'completed',
    inputTokens:101,
    cachedInputTokens:60,
    outputTokens:20
  }), {
    code:'ATTEMPT_CONFLICT'
  });
  assert.throws(()=>store.recordAttempt({
    ...a,
    attemptId:'bad',
    inputTokens:1,
    cachedInputTokens:2
  }), {
    code:'INVALID_INPUT'
  });
  assert.throws(()=>store.recordAttempt({
    ...a,
    attemptId:'bad',
    outputTokens:Infinity
  }), {
    code:'INVALID_INPUT'
  });
  const other=store.createWorld({
    name:'other',
    card
  });
  assert.throws(()=>store.recordAttempt({
    ...a,
    worldId:other.world.id,
    branchId:other.branch.id
  }), {
    code:'ATTEMPT_CONFLICT'
  });
});
test('inherited outbox ACK is branch scoped; genesis fork is empty; many relations preserved', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const a=store.commit(payload(s, {
    operations:Array.from({
      length:50
    }, (_, i)=>({
      op:'add_relation',
      from:'player',
      to:'npc',
      type:`relation-${i}`
    }))
  }));
  const f=store.fork({
    worldId:s.world.id,
    branchId:s.branch.id,
    commitId:a.commitId,
    name:'Fork'
  });
  store.markProjected(s.world.id, f.branch.id, a.commitId);
  assert.equal(store.snapshot(s.world.id, s.branch.id).outbox[0].status, 'pending');
  assert.equal(store.snapshot(s.world.id, f.branch.id).state.relations.length, 50);
  const genesis=store.fork({
    worldId:s.world.id,
    branchId:f.branch.id,
    commitId:null,
    name:'Genesis'
  });
  assert.equal(genesis.scenes.length, 0);
  assert.equal(genesis.state.relations.length, 0);
  assert.throws(()=>store.markProjected(s.world.id, genesis.branch.id, a.commitId), {
    code:'UNKNOWN_PROJECTION'
  });
});
test('invalid inputs all roll back and never execute scripts or prototype fields', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const bad=[{
    op:'eval',
    code:'process.exit()'
  }, {
    op:'set_variable',
    key:'constructor',
    value:1
  }, {
    op:'set_variable',
    key:'a',
    value:NaN
  }, {
    op:'set_variable',
    key:'a',
    value:{
    }
  }, {
    op:'change_inventory',
    entityId:'player',
    item:'coin',
    amount:1.5
  }, {
    op:'change_inventory',
    entityId:'player',
    item:'coin',
    amount:Infinity
  }, {
    op:'set_fact',
    key:'a',
    value:'x',
    visibility:'secret'
  }, {
    op:'set_fact',
    key:'a',
    value:'x',
    locked:'true'
  }, {
    op:'set_belief',
    holderId:'missing',
    subjectId:'player',
    key:'a',
    value:1
  }, {
    op:'set_goal',
    entityId:'player',
    text:'goal',
    status:'done'
  }, {
    op:'set_plot_thread',
    label:'plot',
    status:'done'
  }, {
    op:'schedule',
    at:-1,
    entityId:'player',
    label:'bad',
    operations:[]
  }, {
    op:'schedule',
    at:1,
    entityId:'player',
    label:'bad',
    operations:[{
      op:'schedule',
      at:2,
      entityId:'player',
      label:'nested',
      operations:[]
    }]
  }, {
    op:'schedule',
    at:1,
    entityId:'player',
    label:'bad',
    operations:[],
    precondition:{
      variable:'score',
      equals:1,
      script:'x'
    }
  }, {
    op:'cancel_schedule',
    id:'missing'
  }, JSON.parse('{"op":"set_variable","key":"ok","value":1,"__proto__":{}}')];
  for(const op of bad){
    assert.throws(()=>store.commit(payload(s, {
      operations:[op]
    })), `Should reject ${op.op}`);
    assert.equal(store.snapshot(s.world.id).scenes.length, 0);
  }
  for(const extra of [{
    expectedHead:undefined
  }, {
    author:'true'
  }, {
    worldId:'../bad'
  }, {
    unknown:true
  }, {
    narrative:null
  }, {
    operations:{
    }
  }, {
    operations:new Array(101).fill({
      op:'set_variable',
      key:'a',
      value:1
    })
  }])assert.throws(()=>store.commit(payload(s, extra)));
  assert.throws(()=>store.createWorld({
    name:'Bad',
    card:{
      ...card,
      extensions:{
        story_runtime:{
          characters:[{
            id:'player',
            name:'duplicate'
          }]
        }
      }
    }
  }));
  assert.throws(()=>store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:1,
    maxEvents:0
  }));
  assert.throws(()=>store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:1.5
  }));
  assert.equal({
  }.polluted, undefined);
});
test('cancelled schedule never fires; invalidated inventory and lock conditions cancel safely', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  let a=store.commit(payload(s, {
    author:true,
    operations:[{
      op:'change_inventory',
      entityId:'player',
      item:'coin',
      amount:1
    }, {
      op:'schedule',
      at:2,
      entityId:'player',
      label:'spend',
      operations:[{
        op:'change_inventory',
        entityId:'player',
        item:'coin',
        amount:-1
      }]
    }, {
      op:'schedule',
      at:3,
      entityId:'player',
      label:'cancel me',
      operations:[]
    }]
  })).snapshot;
  const id=a.state.schedules[1].id;
  a=store.commit(payload(a, {
    operations:[{
      op:'change_inventory',
      entityId:'player',
      item:'coin',
      amount:-1
    }, {
      op:'cancel_schedule',
      id
    }]
  })).snapshot;
  const b=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:5,
    maxEvents:10
  });
  assert.equal(b.cancelled.length, 1);
  assert.equal(b.executed.length, 0);
  assert.equal(b.snapshot.state.inventory[0].quantity, 0);
  assert.equal(b.snapshot.state.schedules[1].status, 'cancelled');
});
test('schema versions and non-world databases are refused; unsafe paths refused; closed store guarded', t=>{
  const dir=mkdtempSync(join(tmpdir(), 'world-schema-'));
  t.after(()=>rmSync(dir, {
    recursive:true,
    force:true
  }));
  const file=join(dir, 'world.sqlite');
  const db=new DatabaseSync(file);
  db.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(()=>new WorldStore(dir), {
    code:'UNSUPPORTED_SCHEMA'
  });
  const bad=join(dir, 'bad');
  mkdirSync(bad);
  const other=new DatabaseSync(join(bad, 'world.sqlite'));
  other.exec('CREATE TABLE something(x TEXT)');
  other.close();
  assert.throws(()=>new WorldStore(bad), {
    code:'UNSUPPORTED_SCHEMA'
  });
  const target=join(dir, 'real');
  mkdirSync(target);
  symlinkSync(target, join(dir, 'link'));
  assert.throws(()=>new WorldStore(join(dir, 'link')), {
    code:'UNSAFE_PATH'
  });
  const okay=new WorldStore(target);
  okay.close();
  assert.throws(()=>okay.listWorlds(), {
    code:'STORE_CLOSED'
  });
  okay.close();
});
test('backup rejects close while active and restored file is internally consistent', async t=>{
  const {
    store,
    s,
    dir
  }
  =fixture(t);
  store.commit(payload(s));
  const backup=store.backup(join(dir, 'restore', 'world.sqlite'));
  assert.throws(()=>store.close(), {
    code:'BACKUP_ACTIVE'
  });
  await backup;
  assert.ok(existsSync(join(dir, 'restore', 'world.sqlite')));
  const restored=new WorldStore(join(dir, 'restore'));
  t.after(()=>restored.close());
  assert.equal(restored.snapshot(s.world.id).scenes.length, 1);
  const db=new DatabaseSync(join(dir, 'restore', 'world.sqlite'), {
    readOnly:true
  });
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});
test('same run key is independently idempotent in each world and branch', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const first=store.commit(payload(s, {
    runId:'shared-run',
    narrative:'Parent'
  }));
  const fork=store.fork({
    worldId:s.world.id,
    branchId:s.branch.id,
    commitId:null,
    name:'Independent'
  });
  store.saveRun(run(fork, {
    runId:'shared-run'
  }));
  const secondPayload=payload(fork, {
    runId:'shared-run',
    narrative:'Child'
  });
  const second=store.commit(secondPayload);
  assert.notEqual(second.commitId, first.commitId);
  assert.equal(store.commit(secondPayload).reused, true);
  assert.equal(store.getRun(s.world.id, fork.branch.id, 'shared-run').status, 'committed');
  assert.equal(store.snapshot(s.world.id, s.branch.id).scenes[0].narrative, 'Parent');
  const world=store.createWorld({
    name:'Independent world',
    card
  });
  const third=store.commit(payload(world, {
    runId:'shared-run',
    narrative:'Other world'
  }));
  assert.notEqual(third.commitId, second.commitId);
});
test('restore receipt reset changes no canonical state, history, runs, or usage', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const a=store.commit(payload(s, {
    operations:[{
      op:'set_variable',
      key:'score',
      value:3
    }]
  }));
  store.markProjected(s.world.id, s.branch.id, a.commitId);
  const before=store.snapshot(s.world.id, s.branch.id);
  assert.deepEqual(store.resetProjectionReceipts(), {
    reset:1
  });
  const after=store.snapshot(s.world.id, s.branch.id);
  assert.deepEqual(after, {
    ...before,
    outbox:[{
      commitId:a.commitId,
      status:'pending'
    }]
  });
  assert.deepEqual(store.resetProjectionReceipts(), {
    reset:0
  });
});
test('declared initial variables and schedules are validated without creating fictional history', t=>{
  const {
    store
  }
  =fixture(t);
  const s=store.createWorld({
    name:'Card declarations',
    card:{
      name:'Card',
      extensions:{
        javascript:'throw new Error("never run")',
        story_runtime:{
          variables:{
            flag:true
          },
          schedules:[{
            at:0,
            entityId:'card-main',
            label:'Start',
            precondition:{
              variable:'flag',
              equals:true
            },
            operations:[{
              op:'set_variable',
              key:'arrived',
              value:true
            }]
          }]
        }
      }
    }
  });
  assert.equal(s.scenes.length, 0);
  assert.equal(s.state.schedules.length, 1);
  assert.equal(s.state.variables.arrived, undefined);
  const a=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:0
  });
  assert.equal(a.executed.length, 1);
  assert.equal(a.snapshot.state.variables.arrived, true);
  assert.equal(a.snapshot.scenes.length, 1);
});
test('no due events and unchanged clock create no phantom commits', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const zero=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:0
  });
  assert.equal(zero.snapshot.scenes.length, 0);
  const clock=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:5
  });
  assert.equal(clock.executed.length, 0);
  assert.equal(clock.snapshot.scenes.length, 1);
  assert.equal(clock.snapshot.scenes[0].source, 'time');
  assert.deepEqual(clock.snapshot.scenes[0].operations, []);
  assert.equal(store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:5
  }).snapshot.scenes.length, 1);
  assert.throws(()=>store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:4
  }), {
    code:'INVALID_TIME'
  });
});

test('author revision atomically replaces a reachable scene in a new branch, excludes original future',t=>{
 const {store,s}=fixture(t);
 const a=store.commit(payload(s,{narrative:'First',operations:[{op:'set_variable',key:'score',value:1}]}));
 const b=store.commit(payload(a.snapshot,{userText:'Original user text',narrative:'Second',operations:[{op:'set_variable',key:'score',value:2}]}));
 const c=store.commit(payload(b.snapshot,{narrative:'Future',operations:[{op:'set_variable',key:'score',value:3}]}));
 const revision=store.revise({worldId:s.world.id,branchId:s.branch.id,commitId:b.commitId,name:'Edited',narrative:'New second',operations:[{op:'set_variable',key:'score',value:7}]});
 assert.deepEqual(revision.scenes.map(scene=>scene.narrative),['First','New second']);
 assert.equal(revision.scenes[1].userText,'Original user text');
 assert.equal(revision.scenes[1].source,'author-revision');
 assert.equal(revision.state.variables.score,7);
 assert.equal(revision.branch.forkCommitId,a.commitId);
 assert.equal(store.snapshot(s.world.id,s.branch.id).branch.head,c.commitId);
 const before=store.snapshot(s.world.id);
 assert.throws(()=>store.revise({worldId:s.world.id,branchId:s.branch.id,commitId:b.commitId,name:'Invalid',narrative:'No commit',operations:[{op:'set_variable',key:'constructor',value:8}]}),{code:'INVALID_INPUT'});
 assert.deepEqual(store.snapshot(s.world.id),before);
 assert.throws(()=>store.revise({worldId:s.world.id,branchId:revision.branch.id,commitId:c.commitId,name:'Sibling future',narrative:'No',operations:[]}),{code:'INVALID_FORK'});
 const first=store.revise({worldId:s.world.id,branchId:s.branch.id,commitId:a.commitId,name:'Genesis rewrite',narrative:'Replacement first',operations:[]});
 assert.equal(first.scenes.length,1);
 assert.equal(first.branch.forkCommitId,null);
 assert.equal(first.state.variables.score,0);
});
test('look-alike schemas and unrecognized schema extensions fail closed',t=>{
 const {store,data}=fixture(t);
 store.close();
 const db=new DatabaseSync(join(data,'world.sqlite'));
 db.exec('ALTER TABLE runs ADD COLUMN extra TEXT');
 db.close();
 assert.throws(()=>new WorldStore(data),{code:'UNSUPPORTED_SCHEMA'});
});

test('increment_variable is atomic, scoped, supports numeric deltas and idempotent retries', t => {
  const { store, s } = fixture(t);
  const request = payload(s, {
    runId: 'increment-once',
    author: false,
    operations: [
      { op: 'increment_variable', key: 'score', amount: 2 },
      { op: 'increment_variable', key: 'score', amount: 0.5 },
      { op: 'increment_variable', key: 'score', amount: -1 }
    ]
  });
  // Merely building or displaying a proposed action never changes persisted state.
  assert.equal(store.snapshot(s.world.id, s.branch.id).state.variables.score, 0);
  const committed = store.commit(request);
  assert.equal(committed.snapshot.state.variables.score, 1.5);
  assert.equal(committed.snapshot.scenes.length, 1);
  const retry = store.commit(request);
  assert.equal(retry.reused, true);
  assert.equal(retry.commitId, committed.commitId);
  assert.equal(retry.snapshot.state.variables.score, 1.5);
  const fork = store.fork({ worldId: s.world.id, branchId: s.branch.id, commitId: committed.commitId, name: 'Independent increments' });
  const child = store.commit(payload(fork, { operations: [{ op: 'increment_variable', key: 'score', amount: 3 }] }));
  assert.equal(child.snapshot.state.variables.score, 4.5);
  assert.equal(store.snapshot(s.world.id, s.branch.id).state.variables.score, 1.5);
});

test('increment_variable rejects missing/non-numeric/unsafe values and cannot bypass a fact lock', t => {
  const { store, s } = fixture(t);
  const seeded = store.commit(payload(s, {
    author: true,
    operations: [
      { op: 'set_variable', key: 'text', value: '2' },
      { op: 'set_variable', key: 'flag', value: true },
      { op: 'set_variable', key: 'ceiling', value: Number.MAX_SAFE_INTEGER },
      { op: 'set_variable', key: 'floor', value: -Number.MAX_SAFE_INTEGER },
      { op: 'set_fact', key: 'fixed-setting', value: 'fixed', locked: true }
    ]
  })).snapshot;
  const invalid = [
    { op: 'increment_variable', key: 'missing', amount: 1 },
    { op: 'increment_variable', key: 'text', amount: 1 },
    { op: 'increment_variable', key: 'flag', amount: 1 },
    { op: 'increment_variable', key: 'score', amount: '1' },
    { op: 'increment_variable', key: 'score', amount: true },
    { op: 'increment_variable', key: 'score', amount: null },
    { op: 'increment_variable', key: 'score', amount: NaN },
    { op: 'increment_variable', key: 'score', amount: Infinity },
    { op: 'increment_variable', key: 'score', amount: -Infinity },
    { op: 'increment_variable', key: 'score', amount: Number.MAX_SAFE_INTEGER + 1 },
    { op: 'increment_variable', key: 'ceiling', amount: 1 },
    { op: 'increment_variable', key: 'floor', amount: -1 },
    { op: 'increment_variable', key: '__proto__', amount: 1 },
    { op: 'increment_variable', key: 'constructor', amount: 1 },
    { op: 'increment_variable', key: 'prototype', amount: 1 },
    { op: 'increment_variable', key: 'score', amount: 1, author: true }
  ];
  for (const operation of invalid) {
    assert.throws(() => store.commit(payload(seeded, {
      operations: [{ op: 'increment_variable', key: 'score', amount: 1 }, operation]
    })));
    assert.deepEqual(store.snapshot(s.world.id, s.branch.id), seeded);
  }
  assert.throws(() => store.commit(payload(seeded, {
    author: false,
    operations: [
      { op: 'increment_variable', key: 'score', amount: 1 },
      { op: 'set_fact', key: 'fixed-setting', value: 'changed' }
    ]
  })), { code: 'LOCKED_FACT' });
  assert.deepEqual(store.snapshot(s.world.id, s.branch.id), seeded);
});

test('scheduled increments are validated again and cancelled when numeric target changes type', t => {
  const { store, s } = fixture(t);
  const scheduled = store.commit(payload(s, {
    operations: [{ op: 'schedule', at: 2, entityId: 'player', label: 'Increment score', operations: [{ op: 'increment_variable', key: 'score', amount: 1 }] }]
  })).snapshot;
  store.commit(payload(scheduled, { operations: [{ op: 'set_variable', key: 'score', value: 'unavailable' }] }));
  const advanced = store.advance({ worldId: s.world.id, branchId: s.branch.id, to: 2 });
  assert.equal(advanced.executed.length, 0);
  assert.equal(advanced.cancelled.length, 1);
  assert.equal(advanced.snapshot.state.variables.score, 'unavailable');
  assert.equal(advanced.snapshot.state.schedules[0].status, 'cancelled');
});
