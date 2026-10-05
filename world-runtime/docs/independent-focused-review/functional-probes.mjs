// Read-only product audit using ordinary local story data; no product source edits.
import {initialState,applyOperations,clone,checkPrecondition} from '../../src/domain-state.mjs';
import {actorState} from '../../src/actor-view.mjs';
import {runBehaviors} from '../../src/behavior.mjs';
import {compileContext,contextCheckpoint} from '../../src/model.mjs';
import {knowledgeBundle} from '../../src/knowledge.mjs';
const card={name:'甲',extensions:{story_runtime:{characters:[{id:'b',name:'乙',location:'森林'}]}}};
const state=initialState(card);
const snapshot=state=>({world:{id:'world',name:'审核世界',card},branch:{id:'branch',sourceRevision:'revision'},state,scenes:[],runs:[],usage:[],outbox:[]});
applyOperations(state,[{op:'add_relation',from:'card-main',to:'b',type:'member_of',addressFrom:'师傅'}],{commitId:'c1'});
const relation=state.relations[0];applyOperations(state,[{op:'end_relation',id:relation.id}],{commitId:'c2'});
const messages=compileContext(snapshot(state),'继续');const compact=JSON.parse(messages.find(m=>m.content.startsWith('本轮公开状态')).content.split('\n')[1]);
console.log('relationProjection',JSON.stringify({canonical:relation,prompt:compact.relations,export:knowledgeBundle(snapshot(state)).files['relations.md']}));
applyOperations(state,[{op:'set_belief',holderId:'card-main',subjectId:'b',key:'location',value:'码头'}]);
console.log('ordinaryLocationCondition',JSON.stringify({world:checkPrecondition(state,{entityId:'b',location:'森林'},'card-main'),actor:checkPrecondition(actorState(state,'card-main'),{entityId:'b',location:'森林'},'card-main')}));
const behaviorCard={...card,extensions:{...card.extensions,story_runtime:{...card.extensions.story_runtime,rules:[{event:'input',operations:[{op:'create_entity',name:'新旅人',kind:'character'}]}]}}};
const staging=runBehaviors(behaviorCard,state,'input','');const stagedId=staging.state.characters.find(c=>c.name==='新旅人').id;
let newEntityOutcome;try{applyOperations(clone(state),[...staging.operations,{op:'set_location',entityId:stagedId,value:'旅店'}],{commitId:'new-turn'});newEntityOutcome='committed';}catch(e){newEntityOutcome=e.code;}
console.log('stagedEntityReference',JSON.stringify({newEntityOutcome}));
const long=snapshot(initialState(card));long.scenes=Array.from({length:85},(_,i)=>({id:'scene-'+i,userText:'',narrative:i===0?'EARLY_STORY_EVIDENCE':'场景 '+i,operations:[]}));
console.log('longContext',JSON.stringify({checkpoint:contextCheckpoint(long),earlyEvidenceInPrompt:JSON.stringify(compileContext(long,'EARLY_STORY_EVIDENCE')).includes('"role":"assistant","content":"EARLY_STORY_EVIDENCE"'),earlyEvidenceInCheckpoint:contextCheckpoint(long).text.includes('EARLY_STORY_EVIDENCE')}));
const {WorldStore}=await import('../../src/store.mjs');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
const dir=mkdtempSync(join(tmpdir(),'story-review-'));const store=new WorldStore(dir);
try{let s=store.createWorld({name:'锁定日程',card});const commit=ops=>s=store.commit({worldId:s.world.id,branchId:s.branch.id,runId:crypto.randomUUID(),expectedHead:s.branch.head,sourceRevision:s.branch.sourceRevision,narrative:'普通作者编辑',userText:'',operations:ops,author:true}).snapshot;
commit([{op:'schedule',at:1,entityId:'b',label:'旅人前往码头',operations:[{op:'set_location',entityId:'b',value:'码头'}]}]);commit([{op:'update_entity',id:'b',locked:true}]);let outcome;try{outcome=store.advance({worldId:s.world.id,branchId:s.branch.id,to:1});}catch(e){outcome=e.code;}console.log('lockedScheduledEntity',JSON.stringify({outcome,status:store.snapshot(s.world.id,s.branch.id).state.schedules[0].status}));
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
