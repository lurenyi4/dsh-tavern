import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const PREFIX='story-runtime-scene-v1:';
const scopeId=(worldId,branchId)=>'story-world-'+Buffer.from(JSON.stringify([worldId,branchId])).toString('base64url');
const digest=scene=>createHash('sha256').update(JSON.stringify([scene.id,scene.userText,scene.narrative,scene.operations])).digest('hex');
function dataFor(worldId,branchId,scene,index){return {turn:index+1,step:1,stream:[],message:{id:PREFIX+Buffer.from(JSON.stringify([worldId,branchId,scene.id,digest(scene)])).toString('base64url'),role:'assistant',content:[{type:'text',text:(scene.userText?'【玩家输入】\n'+scene.userText+'\n\n':'')+scene.narrative}],source:{kind:'model',provider:'story-runtime-world',model:'committed-scene'}}};}
function identity(event){const id=event.data?.message?.id;if(typeof id!=='string'||!id.startsWith(PREFIX))return null;try{const x=JSON.parse(Buffer.from(id.slice(PREFIX.length),'base64url').toString());return Array.isArray(x)&&x.length===4?x:null;}catch{return null;}}
export class HostProjection{
 static async open(dataDir,{runtimeDir=process.env.STORY_DSH_RUNTIME_DIR||fileURLToPath(new URL('../.runtime/',import.meta.url))}={}){
  const packages=pathToFileURL(resolve(runtimeDir,'node_modules/@deepseek-ai')+'/');
  for(const n of ['dsh-app-boot','dsh-session','dsh-session-persistence','dsh-session-persistence-jsonl']){let p;try{p=JSON.parse(await readFile(new URL(n+'/package.json',packages),'utf8'));}catch{fail('HOST_NOT_INSTALLED','缺少锁定DSH运行时，请先运行 npm run install:world-runtime');}if(p.version!=='0.1.5-rc.2')fail('HOST_VERSION','DSH运行时版本不匹配，需要锁定0.1.5-rc.2');}
  const root=resolve(dataDir,'host');await mkdir(root,{recursive:true,mode:0o700});const cfg=join(root,'minimal.yml');
  await writeFile(cfg,['dsh-session','dsh-session-persistence-jsonl'].map(n=>`- name: ${new URL(n+'/lib/index.js',packages).href}`+(n.endsWith('-jsonl')?`\n  config:\n    root: ${JSON.stringify(join(root,'sessions'))}\n    compression: none`:'')).join('\n'),{mode:0o600});
  const {boot}=await import(new URL('dsh-app-boot/lib/index.js',packages));const ctx=await boot('story-runtime-world',cfg);return new HostProjection(ctx,root);
 }
 constructor(ctx,root){this.ctx=ctx;this.root=root;this.handles=new Map();this.queues=new Map();this.pending=new Map();}
 async session(worldId,branchId){const id=scopeId(worldId,branchId);if(this.handles.has(id))return this.handles.get(id);if(this.pending.has(id))return this.pending.get(id);
  const job=(async()=>{let handle,session,detach;try{const exists=(await this.ctx.sessionPersistence.list()).some(x=>x.header.id===id);if(exists){handle=await this.ctx.sessionPersistence.open(id,'write');const stored=await handle.read();session=this.ctx.sessions.prepare(id,{seed:stored.events,meta:handle.header,inheritedEventCount:handle.inheritedEventCount,eventState:stored.eventState});const markers=session.snapshotEvents(stored.events.length);if(markers.length)await handle.append(markers);}else{session=this.ctx.sessions.prepare(id,{meta:{cwd:this.root}});handle=await this.ctx.sessionPersistence.create(session.header);}detach=this.ctx.sessions.enter(session);this.ctx.sessions.announce(session);await handle.flush();const value={id,session,handle,detach};this.handles.set(id,value);return value;}catch(e){await handle?.close();detach?.();throw e;}})();this.pending.set(id,job);try{return await job;}finally{this.pending.delete(id);}}
 drain(store,worldId,branchId){const id=scopeId(worldId,branchId);const prior=this.queues.get(id)||Promise.resolve();const next=prior.catch(()=>{}).then(()=>this.#drain(store,worldId,branchId));this.queues.set(id,next);return next;}
 async #drain(store,worldId,branchId){const host=await this.session(worldId,branchId);const snapshot=store.snapshot(worldId,branchId);const expected=snapshot.scenes.map((scene,i)=>dataFor(worldId,branchId,scene,i));
  const inspect=events=>{const found=[];for(const e of events){const k=identity(e);if(!k||k[0]!==worldId||k[1]!==branchId)continue;const i=found.length;if(i>=expected.length||e.type!=='assistant/message'||e.surfaceOp!=='append'||!isDeepStrictEqual(e.data,expected[i]))fail('HOST_ORDER_CONFLICT','宿主投影顺序或内容冲突，已停止自动写入；原世界保留。');found.push(e);}return found;};
  const visible=(found,count)=>{if(found.length<count)fail('HOST_INCOMPLETE','宿主投影尚未完整保存');if(found.slice(0,count).some(e=>!host.session.surface.nodes.includes(e.seq)))fail('HOST_SURFACE_CHANGED','宿主历史已被替换，需要明确恢复，未自动覆盖。');};
  if(!await this.ctx.sessions.flush(host.session))fail('HOST_DURABILITY','原生持久化监听器缺失');
  const initialReader=await this.ctx.sessionPersistence.open(host.id,'read');let persisted;try{persisted=inspect((await initialReader.read()).events);}finally{await initialReader.close();}
  visible(inspect(host.session.snapshotEvents()),persisted.length);
  for(let i=0;i<snapshot.scenes.length;i++){
   let found=inspect(host.session.snapshotEvents());visible(found,i);
   const scene=snapshot.scenes[i],receipt=snapshot.outbox.find(x=>x.commitId===scene.id);
   if(!receipt)fail('OUTBOX_MISSING','缺少提交的投影记录');
   if(i<persisted.length){visible(inspect(host.session.snapshotEvents()),i+1);if(receipt.status!=='delivered')store.markProjected(worldId,branchId,scene.id);continue;}
   if(found.length===i){if(receipt.status==='delivered')fail('ACKED_PROJECTION_MISSING','曾确认的宿主历史缺失；请在新目录恢复备份或检查数据，未静默重写。');host.session.append('assistant/message',expected[i],{surfaceOp:'append'});}
   if(!await this.ctx.sessions.flush(host.session))fail('HOST_DURABILITY','原生持久化监听器缺失');
   const reader=await this.ctx.sessionPersistence.open(host.id,'read');let stored;try{stored=inspect((await reader.read()).events);}finally{await reader.close();}
   visible(stored,i+1);persisted=stored;visible(inspect(host.session.snapshotEvents()),i+1);
   store.markProjected(worldId,branchId,scene.id);
  }
  return {status:'delivered',scenes:snapshot.scenes.length,sessionId:host.id};
 }
 async close(){await Promise.allSettled([...this.queues.values()]);for(const h of this.handles.values()){await h.handle.close();h.detach();}this.handles.clear();await this.ctx.fiber.dispose();}
}
