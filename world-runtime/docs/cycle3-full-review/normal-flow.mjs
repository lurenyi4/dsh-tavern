import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorldStore} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/store.mjs';
import {applyOperations} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/domain-state.mjs';
import {runBehaviors} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/behavior.mjs';
const dir=mkdtempSync(join(tmpdir(),'audit3-story-'));let store=new WorldStore(dir);
try{
 const card={name:'渡口',extensions:{story_runtime:{rules:[{event:'input',operations:[{op:'set_variable',key:'visits',value:1},{op:'set_fact',key:'信物',value:'铜铃'}]},{event:'before_generate',operations:[{op:'set_fact',key:'信物',value:'铜铃'},{op:'create_entity',name:'信使',kind:'character'}]},{event:'model_output',operations:[{op:'set_plot_thread',label:'桥上约定',status:'planted'}]}]}}};
 let s=store.createWorld({name:'边界故事',card});const base={worldId:s.world.id,branchId:s.branch.id,expectedHead:s.branch.head,sourceRevision:s.branch.sourceRevision,runId:'three-stages',userText:'继续'};
 store.saveRun({...base,mode:'demo',status:'accepted',draft:''});const allocation={identitySeed:store.reserveRunIdentity(s.world.id,s.branch.id,base.runId),operationCursor:{index:0}};
 const a=runBehaviors(card,s.state,'input','继续',allocation),b=runBehaviors(card,a.state,'before_generate',a.text,allocation);
 const model=[{op:'add_relation',from:'player',to:b.state.characters.at(-1).id,type:'同行'},{op:'set_goal',entityId:'player',text:'送信'}];const staged=structuredClone(b.state);applyOperations(staged,model,{...allocation,dryRun:true});const c=runBehaviors(card,staged,'model_output','过桥',allocation),operations=[...a.operations,...b.operations,...model,...c.operations];
 store.saveRun({...base,mode:'demo',status:'draft',draft:c.text,operations});store.close();store=new WorldStore(dir);s=store.commit({...base,narrative:c.text,operations}).snapshot;
 for(const key of ['characters','facts','relations','goals','plotThreads'])assert.deepEqual(s.state[key].map(x=>x.id),c.state[key].map(x=>x.id));
 assert.equal(store.commit({...base,narrative:c.text,operations}).reused,true);
 assert.throws(()=>store.commit({...base,narrative:'不同正文',operations}),{code:'RUN_CONFLICT'});
 console.log('PASS three-stage flattened identities, dedup before later allocation, restart, retry and changed-payload rejection');
 const schedules=[10,20,30].map(at=>({op:'schedule',at,entityId:'card-main',label:'赴约'+at,operations:[{op:'observe',holderId:'card-main',subjectId:'player',key:'arrival',value:at}]}));
 s=store.commit({worldId:s.world.id,branchId:s.branch.id,expectedHead:s.branch.head,sourceRevision:s.branch.sourceRevision,runId:'schedules',userText:'',narrative:'约定',operations:schedules,author:true}).snapshot;
 let result=store.advance({worldId:s.world.id,branchId:s.branch.id,to:40,maxEvents:1});assert.equal(result.snapshot.state.time,10);assert.equal(result.snapshot.state.beliefs[0].knownSince,10);
 result=store.advance({worldId:s.world.id,branchId:s.branch.id,to:40,maxEvents:1});assert.equal(result.snapshot.state.time,20);assert.equal(result.snapshot.state.beliefs[0].knownSince,20);
 result=store.advance({worldId:s.world.id,branchId:s.branch.id,to:40,maxEvents:1});assert.equal(result.snapshot.state.time,40);assert.equal(result.snapshot.state.beliefs[0].knownSince,30);
 console.log('PASS bounded due-event batches preserve effective time and final clock advance');
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
