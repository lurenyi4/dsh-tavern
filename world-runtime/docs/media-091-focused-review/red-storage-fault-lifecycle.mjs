// Isolated ordinary local-storage failures; no external inputs or targets.
import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {Readable} from 'node:stream';import assert from 'node:assert/strict';
import {ImportJobs} from '/workspace/scratch/476e99dedb43/normalized-focused-review-20261005/parent/world-runtime/src/import-jobs.mjs';
const dir=await fs.mkdtemp(join(tmpdir(),'media-full-lifecycle-'));let jobs;const realRm=fs.rm,realOpen=fs.open;
try{
 jobs=await ImportJobs.open(dir);
 const bytes=Buffer.from(JSON.stringify({name:'Quiet village',first_mes:'Hello'}));
 const j=await jobs.create({filename:'ordinary.json',size:bytes.length});await jobs.upload(j.id,Readable.from([bytes]));
 while(jobs.get(j.id).status==='preparing')await new Promise(r=>setTimeout(r,10));assert.equal(jobs.get(j.id).status,'ready');
 const upload=join(dir,'.import-jobs',j.id+'.upload');let fault=false;
 fs.rm=async(p,...args)=>{if(p===upload&&!fault){fault=true;throw Object.assign(Error('Transient local cleanup failure'),{code:'EIO'});}return realRm(p,...args);};syncBuiltinESMExports();
 const cancelled=await jobs.cancel(j.id);assert.equal(cancelled.cleanupWarning.code,'EIO');
 fs.rm=realRm;syncBuiltinESMExports();
 for(let n=0;n<50;n++){const next=await jobs.create({filename:'next.json',size:bytes.length});await jobs.cancel(next.id);}
 const recordRetained=jobs.list().some(x=>x.id===j.id);await jobs.close();jobs=await ImportJobs.open(dir);
 const uploadAfterRestart=(await fs.readdir(join(dir,'.import-jobs'))).includes(j.id+'.upload');
 console.log(JSON.stringify({case:'transient cancel cleanup, then normal record retention',fault,recordRetained,uploadAfterRestart,remainingUploadBytes:(await fs.stat(upload).catch(()=>({size:0}))).size}));
 assert.equal(uploadAfterRestart,false,'Expired job must not lose cleanup ownership');
}finally{fs.rm=realRm;fs.open=realOpen;syncBuiltinESMExports();await jobs?.close();await fs.rm(dir,{recursive:true,force:true});}
