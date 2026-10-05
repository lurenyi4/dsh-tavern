import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ImportJobs } from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/import-jobs.mjs';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const err=()=>Object.assign(Error('injected one-shot journal EIO'),{code:'EIO'});
{
 const dir=await mkdtemp(join(tmpdir(),'audit-close-reject-'));const jobs=await ImportJobs.open(dir);
 const bytes=Buffer.from('{"name":"Probe"}');const j=await jobs.create({filename:'card.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));await jobs.jobs.get(j.id).work;
 const save=jobs.save.bind(jobs),entered=gate(),hold=gate();let injected=false;
 jobs.save=async record=>{if(record.status==='registering'){entered.resolve();await hold.promise;}if(record.status==='cancelled'&&!injected){injected=true;throw err();}return save(record)};
 const accept=jobs.accept(j.id);accept.catch(()=>{});await entered.promise;
 const close=jobs.close();close.catch(()=>{});hold.resolve();
 const results=await Promise.allSettled([accept,close]);
 console.log('ACTIVE_REGISTERING_JOURNAL_FAILURE',results.map(x=>[x.status,x.reason?.code]),'memory',jobs.get(j.id).status,'disk',JSON.parse(await readFile(join(dir,'.import-jobs',j.id+'.json'),'utf8')).status);
 const again=jobs.close(); console.log('RETRY_SAME_REJECTED_PROMISE',again===close,(await Promise.allSettled([again]))[0].status);
 await rm(dir,{recursive:true,force:true});
}
{
 const dir=await mkdtemp(join(tmpdir(),'audit-create-close-'));const jobs=await ImportJobs.open(dir);
 for(let i=0;i<49;i++){const j=await jobs.create({filename:'old.json',size:2});await jobs.cancel(j.id);}
 const old=[...jobs.jobs.keys()][0],cleanup=jobs.cleanup.bind(jobs),entered=gate(),hold=gate();let first=true;let closeDone=false;const late=[];
 jobs.cleanup=async record=>{if(record.id===old&&first){first=false;entered.resolve();await hold.promise;}return cleanup(record)};
 const save=jobs.save.bind(jobs);jobs.save=async record=>{if(closeDone)late.push(record.id);return save(record)};
 const creating=jobs.create({filename:'new.json',size:2});await entered.promise;
 await jobs.close();closeDone=true;console.log('CLOSE_RESOLVED_WITH_CREATE_PENDING',true);
 hold.resolve();const created=await creating;console.log('JOURNAL_WRITES_AFTER_CLOSE',late.length,'created status',created.status);
 await rm(dir,{recursive:true,force:true});
}
{
 const dir=await mkdtemp(join(tmpdir(),'audit-history-cancel-'));const jobs=await ImportJobs.open(dir);
 for(let i=0;i<49;i++){const j=await jobs.create({filename:'old.json',size:2});await jobs.cancel(j.id);}
 const old=[...jobs.jobs.keys()][0],cleanup=jobs.cleanup.bind(jobs),inCleanup=gate(),releaseCleanup=gate(),inSave=gate(),releaseSave=gate();let first=true;
 jobs.cleanup=async record=>{if(record.id===old&&first){first=false;inCleanup.resolve();await releaseCleanup.promise;}return cleanup(record)};
 const save=jobs.save.bind(jobs);jobs.save=async record=>{if(record.id===old){inSave.resolve();await releaseSave.promise;}return save(record)};
 const creating=jobs.create({filename:'new.json',size:2});await inCleanup.promise;
 const cancelling=jobs.cancel(old);cancelling.catch(()=>{});await inSave.promise;
 releaseCleanup.resolve();await creating;releaseSave.resolve();
 const result=(await Promise.allSettled([cancelling]))[0];
 console.log('HISTORY_CANCEL_RACE',result.status,result.reason?.code,'inMap',jobs.jobs.has(old),'journalRecreated',!!JSON.parse(await readFile(join(dir,'.import-jobs',old+'.json'),'utf8')));
 await jobs.close();await rm(dir,{recursive:true,force:true});
}
