import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
const base=process.env.BASELINE?'./baseline/src/':'../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/';
const {ImportJobs}=await import(base+'import-jobs.mjs');
const {startServer}=await import(base+'server.mjs');
const runtimeDir=resolve('dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const pause=()=>new Promise(r=>setTimeout(r,80));
const exists=async p=>fs.stat(p).then(()=>true,()=>false);
const ready=async jobs=>{let bytes=Buffer.from('{"name":"Independent lifecycle"}');let j=await jobs.create({filename:'card.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));await jobs.jobs.get(j.id).work;return j;};
{
const dir=await fs.mkdtemp(join(tmpdir(),'focus-pre-'));const jobs=await ImportJobs.open(dir);const j=await ready(jobs);const save=jobs.save.bind(jobs),entered=gate(),hold=gate();let injected=false;
jobs.save=async r=>{if(r.status==='registering'){entered.resolve();await hold.promise}if(r.status==='cancelled'&&!injected){injected=true;throw Object.assign(Error('one-shot'),{code:'EIO'})}return save(r)};
const a=jobs.accept(j.id);a.catch(()=>{});await entered.promise;const c=jobs.close();c.catch(()=>{});hold.resolve();const results=await Promise.allSettled([a,c]);console.log(JSON.stringify({case:'prepublication',outcomes:results.map(x=>x.status),memory:jobs.get(j.id).status,disk:JSON.parse(await fs.readFile(join(dir,'.import-jobs',j.id+'.json'))).status,repeatedSame:jobs.close()===c}));await fs.rm(dir,{recursive:true,force:true});
}
for(const kind of ['history-close','history-cancel']){
const dir=await fs.mkdtemp(join(tmpdir(),'focus-history-'));const jobs=await ImportJobs.open(dir);for(let i=0;i<49;i++){let j=await jobs.create({filename:'old.json',size:2});await jobs.cancel(j.id)}
const old=[...jobs.jobs.keys()][0],cleanup=jobs.cleanup.bind(jobs),save=jobs.save.bind(jobs),entered=gate(),hold=gate(),saveHold=gate();let first=true,closed=false,late=0;
jobs.cleanup=async j=>{if(j.id===old&&first){first=false;entered.resolve();await hold.promise}return cleanup(j)};
jobs.save=async j=>{if(kind==='history-cancel'&&j.id===old)await saveHold.promise;if(closed)late++;return save(j)};
const creating=jobs.create({filename:'new.json',size:2});await entered.promise;
if(kind==='history-close'){const closing=jobs.close().then(()=>closed=true);await pause();const early=closed;hold.resolve();await Promise.all([creating,closing]);await pause();console.log(JSON.stringify({case:kind,closeResolvedEarly:early,writesAfterClose:late}));}
else{const cancelling=jobs.cancel(old);cancelling.catch(()=>{});await pause();hold.resolve();await creating;saveHold.resolve();const [r]=await Promise.allSettled([cancelling]);console.log(JSON.stringify({case:kind,cancel:r.status,error:r.reason?.code,inMap:jobs.jobs.has(old),journalRecreated:await exists(join(dir,'.import-jobs',old+'.json'))}));await jobs.close()}
await fs.rm(dir,{recursive:true,force:true});
}
for(const persistent of [false,true]){
const dir=await fs.mkdtemp(join(tmpdir(),'focus-http-'));let app=await startServer({dataDir:dir,port:0,runtimeDir,env:{}});const api=async(p,body)=>{let r=await fetch(app.url+p,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()}};
const bytes=Buffer.from('{"name":"HTTP independent"}'),j=await api('/api/import-jobs',{filename:'card.json',size:bytes.length});await fetch(app.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes});while((await api('/api/import-jobs/'+j.id)).status!=='ready')await pause();
const rename=fs.rename,entered=gate(),hold=gate();let faults=0;
fs.rename=async(from,to)=>{if(String(from).includes('/cards/.staging-')){await rename(from,to);entered.resolve();await hold.promise;return}if(String(to).endsWith(j.id+'.json')){let v=JSON.parse(await fs.readFile(from));if(v.status==='completed'&&(!faults||persistent)){faults++;throw Object.assign(Error('real journal EIO'),{code:'EIO'})}}return rename(from,to)};syncBuiltinESMExports();
const accepting=api('/api/import-jobs/'+j.id+'/accept',{});await entered.promise;const closing=app.close();closing.catch(()=>{});hold.resolve();const [c,a]=await Promise.allSettled([closing,accepting]);const repeat=app.close();const [r]=await Promise.allSettled([repeat]);const result={case:'HTTP',persistent,faults,close:c.status,error:c.reason?.code,accept:a.value,listener:app.server.listening,lock:await exists(join(dir,'.server-lock')),warnings:c.value?.warnings,repeatedSame:repeat===closing,repeat:r.status};
fs.rename=rename;syncBuiltinESMExports();if(app.server.listening){await new Promise(r=>app.server.close(r));await app.projection.close();app.store.close();await fs.rm(join(dir,'.server-lock'),{recursive:true,force:true})}
app=await startServer({dataDir:dir,port:0,runtimeDir,env:{}});result.reopenedCards=(await api('/api/cards')).cards.length;result.reopenedStatus=(await api('/api/import-jobs/'+j.id)).status;delete result.accept?.result;console.log(JSON.stringify(result));await app.close();await fs.rm(dir,{recursive:true,force:true});
}
