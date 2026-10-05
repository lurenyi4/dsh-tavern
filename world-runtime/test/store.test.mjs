import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  WorldStore
} from '../src/store.mjs';
const card = {
  name:'主角',
  description:'未发生的背景',
  extensions:{
    story_runtime:{
      characters:[{
        id:'npc-a',
        name:'同名'
      }, {
        id:'npc-b',
        name:'同名'
      }],
      variables:{
        trust:0
      }
    }
  }
};
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(), 'world-store-'));
  const store=new WorldStore(dir);
  t.after(()=>{
    store.close();
    rmSync(dir, {
      recursive:true,
      force:true
    })
  });
  return {
    store,
    dir,
    s:store.createWorld({
      name:'世界',
      card
    })
  };
}
function commit(store, s, operations=[], extra={
}){
  return store.commit({
    worldId:s.world.id,
    branchId:s.branch.id,
    runId:crypto.randomUUID(),
    expectedHead:s.branch.head,
    sourceRevision:s.branch.sourceRevision,
    userText:'行动',
    narrative:'正文',
    operations,
    ...extra
  });
}
test('initial normalized schema, stable entities, atomic committed narrative and state', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  assert.equal(s.state.characters.length, 4);
  assert.equal(s.scenes.length, 0);
  assert.deepEqual(s.state.facts, []);
  assert.deepEqual(s.state.variables, {
    trust:0
  });
  const r=commit(store, s, [{
    op:'set_location',
    entityId:'card-main',
    value:'码头'
  }, {
    op:'set_belief',
    holderId:'npc-a',
    subjectId:'npc-b',
    key:'身份',
    value:'船长'
  }, {
    op:'add_relation',
    from:'npc-a',
    to:'npc-b',
    type:'好友'
  }, {
    op:'add_relation',
    from:'npc-a',
    to:'npc-b',
    type:'同事'
  }]);
  assert.equal(r.snapshot.state.characters[0].location, '码头');
  assert.equal(r.snapshot.state.relations.length, 2);
  assert.equal(r.snapshot.state.facts.length, 0);
  assert.equal(r.snapshot.scenes[0].narrative, '正文');
  assert.equal(r.snapshot.outbox[0].status, 'pending');
});
test('same run stable retry, changed payload conflict and stale write rejection', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const payload={
    worldId:s.world.id,
    branchId:s.branch.id,
    runId:'retry-one',
    expectedHead:null,
    sourceRevision:s.branch.sourceRevision,
    userText:'a',
    narrative:'b',
    operations:[]
  };
  const a=store.commit(payload);
  assert.equal(store.commit(payload).commitId, a.commitId);
  assert.equal(store.commit(payload).reused, true);
  assert.throws(()=>store.commit({
    ...payload,
    narrative:'changed'
  }), {
    code:'RUN_CONFLICT'
  });
  assert.throws(()=>commit(store, s), {
    code:'STALE_HEAD'
  });
  assert.throws(()=>commit(store, a.snapshot, [], {
    sourceRevision:'wrong'
  }), {
    code:'STALE_SOURCE'
  });
});
test('fork uses immutable ancestor state and excludes original future', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const a=commit(store, s, [{
    op:'set_variable',
    key:'trust',
    value:1
  }]);
  const b=commit(store, a.snapshot, [{
    op:'set_variable',
    key:'trust',
    value:2
  }]);
  const f=store.fork({
    worldId:s.world.id,
    branchId:s.branch.id,
    commitId:a.commitId,
    name:'分支'
  });
  assert.equal(f.state.variables.trust, 1);
  assert.deepEqual(f.scenes.map(x=>x.id), [a.commitId]);
  assert.equal(f.scenes[0].inherited, true);
  const c=commit(store, f, [{
    op:'set_variable',
    key:'trust',
    value:3
  }]);
  assert.deepEqual(c.snapshot.scenes.map(x=>x.id), [a.commitId, c.commitId]);
  assert.throws(()=>store.fork({
    worldId:s.world.id,
    branchId:f.branch.id,
    commitId:b.commitId,
    name:'偷看未来'
  }), {
    code:'INVALID_FORK'
  });
  assert.equal(store.snapshot(s.world.id, s.branch.id).state.variables.trust, 2);
});
test('locks, cross-scope identifiers, strict operation fields, inventory and prototype defense', t=>{
  const {
    store,
    s
  }
  =fixture(t);
  const a=commit(store, s, [{
    op:'set_fact',
    key:'太阳',
    value:'蓝色',
    locked:true
  }], {
    author:true
  });
  assert.throws(()=>commit(store, a.snapshot, [{
    op:'set_fact',
    key:'太阳',
    value:'红色'
  }]), {
    code:'LOCKED_FACT'
  });
  assert.throws(()=>commit(store, a.snapshot, [{
    op:'set_variable',
    key:'__proto__',
    value:1
  }]), {
    code:'INVALID_INPUT'
  });
  assert.throws(()=>commit(store, a.snapshot, [{
    op:'set_location',
    entityId:'ghost',
    value:'岸'
  }]), {
    code:'UNKNOWN_ENTITY'
  });
  assert.throws(()=>commit(store, a.snapshot, [{
    op:'set_location',
    entityId:'player',
    value:'岸',
    author:true
  }]), {
    code:'INVALID_INPUT'
  });
  assert.throws(()=>commit(store, a.snapshot, [{
    op:'change_inventory',
    entityId:'player',
    item:'钱',
    amount:-1
  }]), {
    code:'INVALID_INVENTORY'
  });
  assert.throws(()=>store.markProjected(s.world.id, 'wrong', a.commitId));
  const b=commit(store, a.snapshot, [{
    op:'set_fact',
    id:a.snapshot.state.facts[0].id,
    key:'太阳',
    value:'红色',
    locked:false
  }], {
    author:true
  });
  assert.equal(b.snapshot.state.facts[0].value, '红色');
});
test('bounded deterministic schedules, false condition cancellation, no duplicate after restart', t=>{
  const {
    store,
    dir,
    s
  }
  =fixture(t);
  const a=commit(store, s, [{
    op:'schedule',
    at:5,
    entityId:'npc-a',
    label:'抵达',
    operations:[{
      op:'set_location',
      entityId:'npc-a',
      value:'码头'
    }]
  }, {
    op:'schedule',
    at:6,
    entityId:'npc-b',
    label:'错过',
    precondition:{
      variable:'trust',
      equals:9
    },
    operations:[{
      op:'set_location',
      entityId:'npc-b',
      value:'码头'
    }]
  }, {
    op:'schedule',
    at:7,
    entityId:'npc-a',
    label:'离开',
    operations:[]
  }], {
    author:true
  });
  const r=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:10,
    maxEvents:1
  });
  assert.equal(r.executed.length, 1);
  assert.equal(r.snapshot.state.time, 5);
  const z=store.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:10,
    maxEvents:10
  });
  assert.equal(z.cancelled.length, 1);
  assert.equal(z.executed.length, 1);
  assert.equal(z.snapshot.state.time, 10);
  assert.equal(z.snapshot.state.characters.find(c=>c.id==='npc-b').location, null);
  store.close();
  const reopened=new WorldStore(dir);
  t.after(()=>reopened.close());
  const again=reopened.advance({
    worldId:s.world.id,
    branchId:s.branch.id,
    to:10
  });
  assert.equal(again.executed.length, 0);
  assert.equal(again.snapshot.scenes.length, z.snapshot.scenes.length);
});
test('online backup persists committed WAL state; cannot overwrite', async t=>{
  const {
    store,
    dir,
    s
  }
  =fixture(t);
  const a=commit(store, s, [{
    op:'set_variable',
    key:'trust',
    value:8
  }]);
  const target=join(dir, 'copy', 'world.sqlite');
  await store.backup(target);
  await assert.rejects(store.backup(target), {
    code:'BACKUP_EXISTS'
  });
  const restored=new WorldStore(join(dir, 'copy'));
  t.after(()=>restored.close());
  assert.equal(restored.snapshot(s.world.id).branch.head, a.commitId);
});

test('reasserting same directed relation does not create duplicate state and updates retain source',t=>{const {store,s}=fixture(t);const op={op:'add_relation',from:'npc-a',to:'npc-b',type:'friend_of',detail:'同行'};const a=commit(store,s,[op]);const b=commit(store,a.snapshot,[op]);assert.equal(b.snapshot.state.relations.length,1);assert.equal(b.snapshot.state.relations[0].sourceCommitId,a.commitId);const c=commit(store,b.snapshot,[{...op,detail:'多年同行'}]);assert.equal(c.snapshot.state.relations.length,1);assert.equal(c.snapshot.state.relations[0].sourceCommitId,c.commitId);});
test('goals, schedules and inventory changes retain authoritative source evidence',t=>{const {store,s}=fixture(t);const r=commit(store,s,[{op:'set_goal',entityId:'npc-a',text:'归还提灯',status:'active'},{op:'change_inventory',entityId:'npc-a',item:'提灯',amount:1},{op:'schedule',at:5,entityId:'npc-a',label:'返回渡口',operations:[{op:'set_location',entityId:'npc-a',value:'渡口'}]}]);for(const list of ['goals','inventory','schedules'])assert.equal(r.snapshot.state[list][0].sourceCommitId,r.commitId);});

test('reference revisions are immutable in past snapshots and stale extraction cannot commit after an edit',t=>{const {store,s}=fixture(t);const a=commit(store,s,[{op:'set_reference',title:'故事大纲',text:'候选未来，不是已发生事实',visibility:'public'}],{author:true});const ref=a.snapshot.state.references[0];const b=commit(store,a.snapshot,[{op:'set_reference',id:ref.id,title:'故事大纲',text:'修订后的候选',visibility:'public'}],{author:true});assert.notEqual(b.snapshot.state.references[0].sourceRevision,ref.sourceRevision);assert.throws(()=>commit(store,a.snapshot,[{op:'set_fact',key:'旧提取',value:'过时'}]),{code:'STALE_HEAD'});const f=store.fork({worldId:s.world.id,branchId:s.branch.id,commitId:a.commitId,name:'旧资料分支'});assert.equal(f.state.references[0].text,'候选未来，不是已发生事实');});
