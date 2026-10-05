import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const base='/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime';
const {ImportJobs}=await import(base+'/src/import-jobs.mjs');
const {prepareCard,importCard,readCard,listCards}=await import(base+'/src/importer.mjs');
const {initialState}=await import(base+'/src/domain-state.mjs');
const {createBackup,restoreBackup}=await import(base+'/src/backup.mjs');
const nested=n=>n?{next:nested(n-1)}:'星';
const prep=source=>prepareCard({filename:'boundary.json',bytes:Buffer.from(JSON.stringify(source))});
let maxDepth=0;for(let n=0;n<40;n++){try{prep({name:'Depth reference',future:nested(n)});maxDepth=n;}catch{break;}}
const valid={name:'Depth reference',future:nested(maxDepth),extensions:{custom:{unchanged:['甲',null,7,true]}}};
const dir=await fs.mkdtemp(join(tmpdir(),'focused-transition-'));let jobs;const realRm=fs.rm;
try{
 jobs=await ImportJobs.open(dir);
 const keeper=await importCard({dataDir:dir,filename:'keeper.json',bytes:Buffer.from('{"name":"Existing"}')});
 const ingest=async(source)=>{const bytes=Buffer.from(JSON.stringify(source));const job=await jobs.create({filename:'boundary.json',size:bytes.length});await jobs.upload(job.id,Readable.from([bytes]));await jobs.jobs.get(job.id).work;return {job:jobs.get(job.id),bytes};};
 const accepted=await ingest(valid);assert.equal(accepted.job.status,'ready');const result=await jobs.accept(accepted.job.id);assert.equal(result.status,'completed');
 const card=(await readCard(dir,result.cardId)).card;assert.deepEqual(card.extensions._import.unknownData.future,valid.future);assert.deepEqual(card.extensions.custom,valid.extensions.custom);initialState(card);assert.deepEqual(await fs.readFile(join(dir,card.original.path)),accepted.bytes);
 for(const source of [{...valid,future:nested(maxDepth+1)},{name:'Bad native',extensions:{story_runtime:{characters:[{id:'player',name:'duplicate'}]}}}]){const r=await ingest(source);assert.equal(r.job.status,'failed');await assert.rejects(jobs.accept(r.job.id),{code:'IMPORT_NOT_READY'});assert.equal((await listCards(dir)).length,2);}
 const partial=await jobs.create({filename:'partial.json',size:100});const path=join(dir,'.import-jobs',partial.id+'.upload');let injected=false;fs.rm=async(p,...a)=>{if(p===path&&!injected){injected=true;throw Object.assign(Error('busy'),{code:'EBUSY'});}return realRm(p,...a);};syncBuiltinESMExports();
 await assert.rejects(jobs.upload(partial.id,Readable.from([Buffer.from('{"name":')])),{code:'IMPORT_INCOMPLETE'});assert.equal(jobs.get(partial.id).error.code,'IMPORT_INCOMPLETE');assert.equal(jobs.get(partial.id).cleanupWarning.code,'EBUSY');fs.rm=realRm;syncBuiltinESMExports();await jobs.cancel(partial.id);await jobs.close();jobs=await ImportJobs.open(dir);assert.equal(jobs.get(partial.id).error.code,'IMPORT_INCOMPLETE');assert.equal(jobs.get(partial.id).cleanupWarning,undefined);assert.equal((await listCards(dir)).length,2);
 console.log(JSON.stringify({maxUnknownRootNestedDepth:maxDepth,depthPlusOne:'rejected before ready',nativeInvalid:'rejected before ready',unknownFields:'deep equal',exactOriginal:true,registeredKeeperUnchanged:(await readCard(dir,keeper.card.id)).card.name==='Existing',partialCleanupRestart:'primary preserved, upload removed'}));
}finally{fs.rm=realRm;syncBuiltinESMExports();await jobs?.close();await fs.rm(dir,{recursive:true,force:true});}
