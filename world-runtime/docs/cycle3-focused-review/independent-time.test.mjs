import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorldStore} from '../../src/store.mjs';
import {injectStoreFaultForTests} from '../../src/store-test-support.mjs';

test('Independent due clock: bounded batches, same-time observations, cancelled locked relation, transaction rollback, reopened branch histories',()=>{
 const dir=mkdtempSync(join(tmpdir(),'c3-independent-time-')); let store=new WorldStore(dir);
 try {
 let s=store.createWorld({name:'正常同行日程',card:{name:'甲',extensions:{story_runtime:{characters:[{id:'b',name:'乙'}]}}}});
 const commit=(ops)=>s=store.commit({worldId:s.world.id,branchId:s.branch.id,expectedHead:s.branch.head,sourceRevision:s.branch.sourceRevision,runId:randomUUID(),userText:'',narrative:'作者计划',operations:ops,author:true}).snapshot;
 commit([{op:'add_relation',from:'card-main',to:'b',type:'同事'}, {op:'add_relation',from:'b',to:'player',type:'约定'}]);
 const colleague=s.state.relations[0].id, locked=s.state.relations[1].id;
 const obs=(key,value)=>({op:'observe',holderId:'card-main',subjectId:'b',key,value});
 commit([
  {op:'schedule',entityId:'card-main',at:10,label:'十时结束同事',operations:[{op:'end_relation',id:colleague},{op:'add_relation',from:'card-main',to:'b',type:'朋友'},obs('十时','渡口')]},
  {op:'schedule',entityId:'card-main',at:10,label:'十时等船',operations:[obs('同时','等船')]},
  {op:'schedule',entityId:'card-main',at:15,label:'十五时锁取消',operations:[{op:'end_relation',id:locked},obs('不能出现','无效')]},
  {op:'schedule',entityId:'card-main',at:20,label:'二十时到岸',operations:[obs('二十时','到岸')]},
 ]);
 commit([{op:'update_relation',id:locked,locked:true}]);
 const first=store.advance({worldId:s.world.id,branchId:s.branch.id,to:25,maxEvents:1});
 assert.equal(first.snapshot.state.time,10); assert.equal(first.executed.length,1);
 const before=store.snapshot(s.world.id,s.branch.id); let writes=0;
 injectStoreFaultForTests(store,p=>{if(p==='after-state' && ++writes===2)throw Object.assign(new Error('Synthetic second write interruption'),{code:'TEST_SECOND_WRITE'});});
 assert.throws(()=>store.advance({worldId:s.world.id,branchId:s.branch.id,to:25,maxEvents:10}),{code:'TEST_SECOND_WRITE'});
 assert.deepEqual(store.snapshot(s.world.id,s.branch.id),before);
 store.close(); store=new WorldStore(dir);
 assert.deepEqual(store.snapshot(s.world.id,s.branch.id),before);
 const rest=store.advance({worldId:s.world.id,branchId:s.branch.id,to:25,maxEvents:10}); s=rest.snapshot;
 assert.equal(rest.executed.length,2); assert.equal(rest.cancelled.length,1); assert.equal(s.state.time,25);
 assert.equal(s.state.relations.find(r=>r.id===colleague).validUntil,10);
 assert.equal(s.state.relations.find(r=>r.type==='朋友').validFrom,10);
 assert.equal(s.state.relations.find(r=>r.id===locked).status,'active');
 for(const [key,time] of [['十时',10],['同时',10],['二十时',20]])assert.equal(s.state.beliefs.find(b=>b.key===key).knownSince,time);
 assert.ok(!s.state.beliefs.some(b=>b.key==='不能出现'));
 const cancelled=s.state.schedules.find(q=>q.at===15);assert.equal(cancelled.cancellationReason,'LOCKED_FIELD');
 const cancelScene=s.scenes.find(x=>x.source==='schedule' && x.narrative.includes('十五时锁取消'));
 const fork=store.fork({worldId:s.world.id,branchId:s.branch.id,commitId:cancelScene.id,name:'十五时分支'});
 assert.equal(fork.state.time,15);assert.ok(!fork.state.beliefs.some(b=>b.key==='二十时'));
 const forkFinal=store.advance({worldId:s.world.id,branchId:fork.branch.id,to:22,maxEvents:10}).snapshot;
 assert.equal(forkFinal.state.beliefs.find(b=>b.key==='二十时').knownSince,20);
 assert.equal(store.snapshot(s.world.id,s.branch.id).state.time,25);
 console.log(JSON.stringify({boundedFirstTime:10,rollbackAndReopenExact:true,relationEndedAt:10,lockedCancelledAt:fork.state.time,observations:[10,10,20],forkEnd:forkFinal.state.time,originalEnd:s.state.time}));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
