/** Real local HTTP + SQLite + pinned DSH integration. No remote model calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {startServer} from '../src/server.mjs';
import {restoreBackup} from '../src/backup.mjs';
import {v2, png, mappedCharx} from '../fixtures/import-fixtures.mjs';

const installedRuntime=fileURLToPath(new URL('../.runtime/',import.meta.url));
const runtimeDir=resolve(process.env.STORY_DSH_RUNTIME_DIR || (existsSync(join(installedRuntime,'node_modules')) ? installedRuntime : fileURLToPath(new URL('../../../dsh-pinned/',import.meta.url))));
export async function request(url,path,body,status=body===undefined?200:200){
 const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const content=await response.text();let value;try{value=JSON.parse(content);}catch{value=content;}
 assert.equal(response.status,status,`${path}: ${content}`);return value;
}
export async function streamRun(url,token,onEvent=()=>{}){
 const response=await fetch(`${url}/api/runs/${token}/events`,{signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let text='',terminal=null;const events=[];
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});let boundary;while((boundary=text.indexOf('\n\n'))>=0){const block=text.slice(0,boundary);text=text.slice(boundary+2);const type=block.split('\n').find(x=>x.startsWith('event: '))?.slice(7);const raw=block.split('\n').filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');if(!type)continue;const event={type,data:JSON.parse(raw)};events.push(event);await onEvent(event);if(['committed','cancelled','error'].includes(type))terminal=event;}}}finally{await reader.cancel();}
 assert.ok(terminal,`SSE ended without terminal event: ${JSON.stringify(events)}`);return {events,terminal};
}
const publicState=s=>({head:s.branch.head,scenes:s.scenes,state:s.state});
const messageIds=async(server,w,b)=>{const host=await server.projection.session(w,b);const reader=await server.projection.ctx.sessionPersistence.open(host.id,'read');try{return (await reader.read()).events.filter(e=>e.type==='assistant/message').map(e=>e.data.message.id);}finally{await reader.close();}};

test('real HTTP lifecycle: imports, idempotency, cancellation, schedules, privacy, fork, backup and ACK recovery', {timeout:120000}, async t=>{
 const temp=await mkdtemp(join(tmpdir(),'story-runtime-http-e2e-')),dataDir=join(temp,'original');let server;
 t.after(async()=>{await server?.close();await rm(temp,{recursive:true,force:true});});
 server=await startServer({dataDir,port:0,runtimeDir,demoDelay:8,env:{}});let url=server.url;
 assert.equal((await request(url,'/api/config')).openaiConfigured,false);
 const imported=[];
 for(const [filename,bytes] of [['qa-card.json',Buffer.from(JSON.stringify(v2))],['qa-card.png',png([['chara',v2]])],['qa-card.charx',mappedCharx()]]){
  const card=await request(url,'/api/import',{filename,base64:bytes.toString('base64')},201);assert.equal(card.card.name,'渡口向导');assert.ok(card.report.length);imported.push(card);
 }
 assert.equal((await request(url,'/api/cards')).cards.length,3);
 const importedWorld=await request(url,'/api/worlds',{name:'Imported archive',cardId:imported[2].card.id},201);
 assert.ok(importedWorld.world.card.assets.some(a=>a.mime==='image/png'));
 const raster=importedWorld.world.card.assets.find(a=>a.mime==='image/png');const asset=await fetch(url+'/assets/'+raster.id);assert.equal(asset.status,200);assert.equal(asset.headers.get('Content-Type'),'image/png');assert.ok((await asset.arrayBuffer()).byteLength>0);
 let current=await request(url,'/api/worlds',{name:'HTTP lifecycle'},201);const w=current.world.id,b=current.branch.id;
 const worldPath=`/api/worlds/${w}`;
 const beforeBad=structuredClone(publicState(current));await request(url,'/api/import',{filename:'broken.json',base64:Buffer.from('{broken').toString('base64')},400);assert.deepEqual(publicState(await request(url,worldPath)),beforeBad);
 const runId=randomUUID(),turn={branchId:b,message:'前往码头',mode:'demo',runId};
 const accepted=await request(url,worldPath+'/turn',turn,202);const repeated=await request(url,worldPath+'/turn',turn,202);assert.equal(repeated.runId,accepted.runId);
 const committed=await streamRun(url,accepted.runId);assert.equal(committed.terminal.type,'committed');current=committed.terminal.data.snapshot;assert.equal(current.scenes.length,1);assert.equal(current.state.characters.find(c=>c.id==='player').location,'码头');assert.ok(current.outbox.every(x=>x.status==='delivered'));
 await request(url,worldPath+'/turn',{...turn,message:'changed'},409);await request(url,worldPath+'/turn',turn,202);assert.equal((await request(url,worldPath)).scenes.length,1);
 const firstCommit=current.scenes[0].id,beforeCancel=structuredClone(publicState(current));
 const cancelling=await request(url,worldPath+'/turn',{...turn,runId:randomUUID(),message:'前往不该到达的远方'},202);let cancelled=false;
 const partial=await streamRun(url,cancelling.runId,async event=>{if(!cancelled&&['delta','draft'].includes(event.type)&&event.data.text){cancelled=true;await request(url,`/api/runs/${cancelling.runId}/cancel`,{});}});
 assert.ok(cancelled);assert.equal(partial.terminal.type,'cancelled');current=await request(url,worldPath);assert.deepEqual(publicState(current),beforeCancel);assert.ok(current.runs.some(r=>r.status==='cancelled'&&r.draft.length>0));
 const secret='E2E_PRIVATE_VAULT_927';
 current=await request(url,worldPath+'/actions',{branchId:b,runId:randomUUID(),narrative:'作者记录了一组世界设定。',operations:[
  {op:'set_variable',key:'courage',value:7},{op:'change_inventory',entityId:'player',item:'提灯',amount:2},
  {op:'add_relation',from:'card-main',to:'player',type:'信任',detail:'初次同行'},
  {op:'add_relation',from:'card-main',to:'player',type:'欠债',detail:'一份承诺'},
  {op:'set_fact',key:'secret-vault',value:secret,visibility:'private',holderId:'card-main'},
  {op:'set_fact',key:'public-clock',value:'钟楼仍在运行',visibility:'public'},
  {op:'set_belief',holderId:'card-main',subjectId:'player',key:'guess',value:secret},
  {op:'set_goal',entityId:'card-main',text:secret,status:'active',visibility:'private'},
  {op:'schedule',at:2,entityId:'card-main',label:'向导前往广场',operations:[{op:'set_location',entityId:'card-main',value:'广场'}]}
 ]});
 assert.equal(current.state.variables.courage,7);assert.equal(current.state.inventory.find(x=>x.item==='提灯').quantity,2);assert.equal(current.state.relations.length,2);
 const player=await request(url,worldPath+'?view=player');assert.ok(!JSON.stringify(player).includes(secret),'private NPC fact/belief/goal absent from reader response');const author=await request(url,worldPath+'?view=author');assert.ok(JSON.stringify(author).includes(secret));
 const attemptsBefore=current.usage.length,scenesBefore=current.scenes.length;
 const advanced=await request(url,worldPath+'/advance',{branchId:b,to:6,maxEvents:1});assert.equal(advanced.executed.length,1);const advancedAuthor=await request(url,worldPath+'?view=author');assert.equal(advancedAuthor.state.characters.find(x=>x.id==='card-main').location,'广场');assert.equal(advancedAuthor.scenes.length,scenesBefore+1);assert.equal(advanced.snapshot.state.characters.find(x=>x.id==='card-main').location,null);assert.equal(advanced.snapshot.usage.length,attemptsBefore);
 const more=await request(url,worldPath+'/advance',{branchId:b,to:6,maxEvents:1});assert.equal(more.executed.length,1);assert.equal((await request(url,worldPath+'?view=author')).state.characters.find(x=>x.id==='messenger').location,'杂货铺');
 const none=await request(url,worldPath+'/advance',{branchId:b,to:6,maxEvents:1});assert.equal(none.executed.length,0);assert.equal(none.snapshot.usage.length,attemptsBefore);assert.equal(none.snapshot.scenes.length,more.snapshot.scenes.length);
 const fork=await request(url,worldPath+'/fork',{branchId:b,commitId:firstCommit,name:'从初见分岔'},201);assert.equal(fork.scenes.length,1);assert.equal(fork.state.variables.courage,undefined);assert.equal(fork.state.inventory.length,0);
 const branchB=fork.branch.id;const changed=await request(url,worldPath+'/actions',{branchId:branchB,narrative:'分支独有的变化。',operations:[{op:'set_variable',key:'onlyFork',value:true}]});assert.equal(changed.state.variables.onlyFork,true);const original=await request(url,worldPath+`?branchId=${b}&view=author`);assert.equal(original.state.variables.onlyFork,undefined);assert.equal(original.state.variables.courage,7);
 await request(url,worldPath+'/select-branch',{branchId:b});
 const idsBefore=await messageIds(server,w,b);assert.equal(idsBefore.length,original.scenes.length);assert.equal(new Set(idsBefore).size,idsBefore.length);
 // Simulates a crash after DSH fsync but before the SQLite receipt acknowledgement.
 server.store.resetProjectionReceipts();await server.close();server=null;
 server=await startServer({dataDir,port:0,runtimeDir,demoDelay:0,env:{}});url=server.url;
 const recovered=await request(url,worldPath+'?view=author');assert.deepEqual(recovered.scenes,original.scenes);assert.ok(recovered.outbox.every(x=>x.status==='delivered'));assert.deepEqual(await messageIds(server,w,b),idsBefore,'ACK recovery must reuse exact DSH messages');assert.equal(recovered.autonomy.enabled,false);
 const backupResponse=await fetch(url+'/api/backup');assert.equal(backupResponse.status,200);assert.ok(backupResponse.headers.get('content-disposition').includes('attachment'));const backupBytes=Buffer.from(await backupResponse.arrayBuffer()),backupFile=join(temp,'download.story-backup.json');await writeFile(backupFile,backupBytes);const backup=JSON.parse(backupBytes);assert.ok(backup.files.some(x=>x.path==='world.sqlite'));assert.ok(backup.files.some(x=>x.path.startsWith('cards/')));assert.ok(!backup.files.some(x=>x.path.startsWith('host/')));
 const restoredDir=join(temp,'restored-new-directory');await restoreBackup(backupFile,restoredDir);await server.close();server=null;
 server=await startServer({dataDir:restoredDir,port:0,runtimeDir,demoDelay:0,env:{}});url=server.url;
 const restored=await request(url,worldPath+'?view=author');assert.deepEqual(restored.state,recovered.state);assert.deepEqual(restored.scenes,recovered.scenes);assert.equal(restored.branches.length,2);assert.ok(restored.outbox.every(x=>x.status==='delivered'));assert.deepEqual(await messageIds(server,w,b),idsBefore);assert.equal((await request(url,'/api/cards')).cards.length,4);
 const exportResponse=await fetch(url+worldPath+'/export');assert.equal(exportResponse.status,200);const text=await exportResponse.text();assert.ok(text.includes('前往码头'));assert.ok(!text.includes(secret));
 await server.close();server=null;server=await startServer({dataDir:restoredDir,port:0,runtimeDir,demoDelay:0,env:{}});const twice=await request(server.url,worldPath+'?view=author');assert.deepEqual(twice.scenes,recovered.scenes);assert.deepEqual(await messageIds(server,w,b),idsBefore);
});

test('interrupted durable draft settles on explicit retry without a new model call', {timeout:30000}, async t=>{
 const temp=await mkdtemp(join(tmpdir(),'story-runtime-draft-e2e-'));let server;
 t.after(async()=>{await server?.close();await rm(temp,{recursive:true,force:true});});
 server=await startServer({dataDir:temp,port:0,runtimeDir,demoDelay:0,env:{}});
 const s=await request(server.url,'/api/worlds',{name:'Durable draft recovery'},201),w=s.world.id,b=s.branch.id,runId='interrupted-draft-fixture';
 // Persist the actual pre-commit run boundary, then restart the entire server.
 server.store.saveRun({worldId:w,branchId:b,runId,expectedHead:s.branch.head,sourceRevision:s.branch.sourceRevision,userText:'我点亮信标',mode:'demo',status:'draft',draft:'你点亮了安全归航的信标。',operations:[{op:'set_variable',key:'beacon',value:true}],error:null});
 await server.close();server=null;server=await startServer({dataDir:temp,port:0,runtimeDir,demoDelay:0,env:{}});
 const interrupted=await request(server.url,`/api/worlds/${w}`);assert.equal(interrupted.scenes.length,0);assert.equal(interrupted.state.variables.beacon,undefined);assert.equal(interrupted.runs[0].status,'interrupted');assert.equal(interrupted.runs[0].draft,'你点亮了安全归航的信标。');assert.equal(interrupted.usage.length,0);
 const accepted=await request(server.url,`/api/runs/${interrupted.runs[0].token}/retry`,{},202),recovered=await streamRun(server.url,accepted.runId);assert.equal(recovered.terminal.type,'committed');assert.equal(recovered.terminal.data.snapshot.scenes.length,1);assert.equal(recovered.terminal.data.snapshot.state.variables.beacon,true);assert.equal(recovered.terminal.data.snapshot.usage.length,0);assert.ok(recovered.terminal.data.snapshot.outbox.every(x=>x.status==='delivered'),JSON.stringify({outbox:recovered.terminal.data.snapshot.outbox,projectionError:recovered.terminal.data.snapshot.projectionError,projectionPending:recovered.terminal.data.projectionPending}));
 await request(server.url,`/api/runs/${interrupted.runs[0].token}/retry`,{},400);assert.equal((await request(server.url,`/api/worlds/${w}`)).scenes.length,1);
});

test('bounded autonomy changes due NPC state without chat and pauses on player decisions', {timeout:20000}, async t=>{
 const {expect}=await import('playwright/test');const temp=await mkdtemp(join(tmpdir(),'story-runtime-autonomy-e2e-'));let server;
 t.after(async()=>{await server?.close();await rm(temp,{recursive:true,force:true});});
 server=await startServer({dataDir:temp,port:0,runtimeDir,demoDelay:0,env:{}});const url=server.url;
 const card=await request(url,'/api/import',{filename:'autonomy.json',base64:Buffer.from(JSON.stringify(v2)).toString('base64')},201),s=await request(url,'/api/worlds',{name:'Automatic NPC schedules',cardId:card.card.id},201),w=s.world.id,b=s.branch.id,p=`/api/worlds/${w}`;
 const scheduled=await request(url,p+'/actions',{branchId:b,narrative:'为向导准备三个独立日程。',operations:[1,2,3].map(i=>({op:'schedule',at:0,entityId:'card-main',label:'有界事件 '+i,operations:[{op:'set_variable',key:'scheduled_'+i,value:true}]}))});
 await request(url,p+'/autonomy',{branchId:b,enabled:true,maxEvents:1,durationSeconds:10});
 let after;await expect.poll(async()=>{after=await request(url,p+'?view=author');return after.autonomy.enabled;},{timeout:5000,intervals:[50,100,250,500],message:'autonomy should stop at the one-event budget'}).toBe(false);
 assert.equal(after.scenes.length,scheduled.scenes.length+1);assert.equal(after.state.schedules.filter(x=>x.status==='pending').length,2);assert.equal(after.usage.length,0);assert.equal(after.autonomy.remainingEvents,0);
 const ids=after.state.schedules.filter(x=>x.status==='pending').map(x=>x.id);
 await request(url,p+'/actions',{branchId:b,narrative:'下一步需要玩家决定。',operations:[...ids.map(id=>({op:'cancel_schedule',id})),{op:'schedule',at:after.state.time,entityId:'card-main',label:'玩家必须确认的移动',operations:[{op:'set_location',entityId:'player',value:'不应自动抵达'}]}]});
 await request(url,p+'/autonomy',{branchId:b,enabled:true,maxEvents:3,durationSeconds:10});
 await expect.poll(async()=>{after=await request(url,p+'?view=author');return after.autonomy.lastError?.code;},{timeout:5000,intervals:[50,100,250,500]}).toBe('PLAYER_DECISION_REQUIRED');assert.equal(after.autonomy.enabled,false);assert.equal(after.state.characters.find(x=>x.id==='player').location,null);assert.equal(after.usage.length,0);
});
