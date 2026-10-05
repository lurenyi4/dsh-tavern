// Ordinary durability fault injection: all importer/worker/filesystem operations are real,
// except one EIO from directory sync after card publication. No malicious inputs.
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {ImportJobs} from '../../src/import-jobs.mjs';
import {listCards} from '../../src/importer.mjs';
const realOpen=fs.open;
for(const cancel of [false,true]){
 const dir=await fs.mkdtemp(join(tmpdir(),'publication-review-'));let jobs;
 try{
 jobs=await ImportJobs.open(dir);const bytes=Buffer.from(JSON.stringify({name:'Local durability review',first_mes:'A quiet morning.'}));
 const j=await jobs.create({filename:'guide.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));
 while(jobs.get(j.id).status==='preparing')await new Promise(r=>setTimeout(r,10));assert.equal(jobs.get(j.id).status,'ready');let injected=false;
 fs.open=async function(path,...args){const handle=await realOpen.call(this,path,...args);if(path===join(dir,'cards')&&!injected){handle.sync=async()=>{injected=true;if(cancel)void jobs.cancel(j.id);throw Object.assign(new Error('Injected card directory sync EIO'),{code:'EIO'});};}return handle;};syncBuiltinESMExports();
 const result=await jobs.accept(j.id);fs.open=realOpen;syncBuiltinESMExports();
 const cards=await listCards(dir);assert.equal(cards.length,1);assert.equal(injected,true);
 await jobs.close();jobs=await ImportJobs.open(dir);
 console.log(JSON.stringify({cancelConcurrentWithSyncError:cancel,returnedStatus:result.status,registeredCards:cards.length,reopenedJobStatus:jobs.get(j.id).status}));
 }finally{fs.open=realOpen;syncBuiltinESMExports();await jobs?.close();await fs.rm(dir,{recursive:true,force:true});}
}
