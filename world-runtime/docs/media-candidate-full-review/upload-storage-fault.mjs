import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Readable} from 'node:stream';import assert from 'node:assert/strict';import {ImportJobs} from '../../src/import-jobs.mjs';
const dir=await fs.mkdtemp(join(tmpdir(),'media-upload-io-'));const realOpen=fs.open,realRm=fs.rm;let jobs;
try{jobs=await ImportJobs.open(dir);const bytes=Buffer.from('{"name":"Quiet village"}');const j=await jobs.create({filename:'quiet.json',size:bytes.length});const upload=join(dir,'.import-jobs',j.id+'.upload');let removed=false;
fs.open=async(p,...args)=>{const h=await realOpen(p,...args);if(p===upload)h.sync=async()=>{throw Object.assign(Error('Upload fsync failed'),{code:'EIO'});};return h;};
fs.rm=async(p,...args)=>{if(p===upload&&!removed){removed=true;throw Object.assign(Error('Cleanup temporarily busy'),{code:'EBUSY'});}return realRm(p,...args);};syncBuiltinESMExports();
let error;try{await jobs.upload(j.id,Readable.from([bytes]));}catch(e){error={code:e.code,message:e.message};}fs.open=realOpen;fs.rm=realRm;syncBuiltinESMExports();
const observed=jobs.get(j.id);console.log(JSON.stringify({returnedError:error,status:observed.status,storedError:observed.error??null,cleanupWarning:observed.cleanupWarning??null}));
await jobs.cancel(j.id);assert.equal(jobs.get(j.id).status,'cancelled');console.log('Explicit cancel recovers slot and removes upload');
assert.equal(observed.error?.code,'EIO','Primary storage failure should survive cleanup failure');
}finally{fs.open=realOpen;fs.rm=realRm;syncBuiltinESMExports();await jobs?.close();await fs.rm(dir,{recursive:true,force:true});}
