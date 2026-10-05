import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,PassThrough} from 'node:stream';
import {ImportJobs} from './head/world-runtime/src/import-jobs.mjs';
import {listCards} from './head/world-runtime/src/importer.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function gate(){let enter,release;return {entered:new Promise(r=>enter=r),held:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()}}
for(const action of ['close','cancel','history'])test(`published terminal ${action} waits and retains card identity`,{timeout:6000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ind-close-'));const jobs=await ImportJobs.open(dir);const g=gate();let pending,accept;
 try{
  const bytes=Buffer.from('{"name":"Independent publication"}');const j=await jobs.create({filename:'good.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));await jobs.jobs.get(j.id).work;
  const save=jobs.save.bind(jobs);let once=false;jobs.save=async record=>{if(record.id===j.id&&record.status==='completed'&&!once){once=true;g.enter();await g.held;}return save(record)};
  accept=jobs.accept(j.id);await g.entered;const id=jobs.get(j.id).cardId;assert.equal((await listCards(dir))[0].id,id);
  if(action==='history')for(let i=0;i<48;i++){const old=await jobs.create({filename:'old.json',size:2});await jobs.cancel(old.id)}
  let done=false;pending=(action==='close'?jobs.close():action==='cancel'?Promise.all([jobs.cancel(j.id),jobs.cancel(j.id)]):jobs.create({filename:'next.json',size:2})).then(()=>done=true);
  if(action==='close'){assert.strictEqual(jobs.close(),jobs.close());await assert.rejects(jobs.cancel(j.id),{code:'IMPORT_CLOSED'})}
  await sleep(30);assert.equal(done,false);g.release();await pending;await accept;await jobs.close();assert.equal((await listCards(dir))[0].id,id);
  const reopened=await ImportJobs.open(dir);if(action!=='history'){assert.equal(reopened.get(j.id).status,'completed');assert.equal(reopened.get(j.id).cardId,id)}else assert.throws(()=>reopened.get(j.id),{code:'IMPORT_NOT_FOUND'});await reopened.close();
 }finally{g.release();await Promise.allSettled([pending,accept]);await jobs.close();await rm(dir,{recursive:true,force:true})}
});
for(const action of ['close','cancel'])test(`receive failure ${action} waits pending failure journal`,{timeout:6000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ind-receive-'));const jobs=await ImportJobs.open(dir);const g=gate();let upload,pending;
 try{const j=await jobs.create({filename:'short.json',size:20});const save=jobs.save.bind(jobs);let once=false;jobs.save=async r=>{if(r.status==='failed'&&!once){once=true;g.enter();await g.held}return save(r)};
 upload=jobs.upload(j.id,Readable.from([Buffer.from('{}')]));upload.catch(()=>{});await g.entered;let done=false;pending=(action==='close'?jobs.close():Promise.all([jobs.cancel(j.id),jobs.cancel(j.id)])).then(()=>done=true);await sleep(30);assert.equal(done,false);g.release();await pending;await assert.rejects(upload,{code:'IMPORT_INCOMPLETE'});await jobs.close();assert.equal(JSON.parse(await readFile(join(dir,'.import-jobs',j.id+'.json'),'utf8')).error.code,'IMPORT_INCOMPLETE');
 }finally{g.release();await Promise.allSettled([upload,pending]);await jobs.close();await rm(dir,{recursive:true,force:true})}
});
test('overlapping active upload cancellations and close settle without deadlock',{timeout:6000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ind-concurrent-'));const jobs=await ImportJobs.open(dir);try{const j=await jobs.create({filename:'slow.json',size:20});const s=new PassThrough();const upload=jobs.upload(j.id,s);upload.catch(()=>{});s.write('{');const a=jobs.cancel(j.id),b=jobs.cancel(j.id),c=jobs.close();await Promise.all([a,b,c,jobs.close()]);await assert.rejects(upload);assert.equal(jobs.get(j.id).status,'cancelled');assert.deepEqual(await listCards(dir),[])}finally{await jobs.close();await rm(dir,{recursive:true,force:true})}
});
test('terminal close retries a finalization journal failure and keeps primary error',{timeout:6000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ind-fault-'));const jobs=await ImportJobs.open(dir);const g=gate();let pending;
 try{const save=jobs.save.bind(jobs);let once=false;jobs.save=async r=>{if(r.status==='failed'&&!once){once=true;g.enter();await g.held;throw Object.assign(new Error('transient'),{code:'EIO'})}return save(r)};const j=await jobs.create({filename:'bad.json',size:4});await jobs.upload(j.id,Readable.from([Buffer.from('{bad')]));await g.entered;pending=jobs.close();g.release();await pending;const r=JSON.parse(await readFile(join(dir,'.import-jobs',j.id+'.json'),'utf8'));assert.equal(r.error.code,'INVALID_JSON');assert.equal(r.persistenceWarning.code,'EIO')}finally{g.release();await pending;await jobs.close();await rm(dir,{recursive:true,force:true})}
});
test('malformed worker close stress leaves no late filesystem writers',{timeout:20000},async()=>{
 for(let i=0;i<60;i++){const dir=await mkdtemp(join(tmpdir(),'ind-stress-'));const jobs=await ImportJobs.open(dir);const j=await jobs.create({filename:'bad.json',size:4});await jobs.upload(j.id,Readable.from([Buffer.from('{bad')]));while(jobs.get(j.id).status!=='failed')await sleep(1);await Promise.all([jobs.close(),jobs.close()]);await rm(dir,{recursive:true,force:true})}
});
