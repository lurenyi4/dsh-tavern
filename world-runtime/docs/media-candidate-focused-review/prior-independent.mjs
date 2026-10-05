import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {ImportJobs} from '/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/import-jobs.mjs';
import {listCards,readCard} from '/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/importer.mjs';
import {charx,silentWav} from '/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/fixtures/import-fixtures.mjs';
import {WorldStore} from '/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/store.mjs';
import {createBackup,restoreBackup} from '/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/backup.mjs';
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'media-independent-'));const jobs=await ImportJobs.open(dir);t.after(async()=>{await jobs.close();await rm(dir,{recursive:true,force:true});});return {dir,jobs};}
async function ready(jobs,id){for(let i=0;i<1000;i++){const j=jobs.get(id);if(!['created','uploading','preparing'].includes(j.status))return j;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
async function upload(jobs,bytes){const j=await jobs.create({filename:'ordinary.charx',size:bytes.length});async function* chunks(){for(let i=0;i<bytes.length;i+=256*1024)yield bytes.subarray(i,i+256*1024);}await jobs.upload(j.id,Readable.from(chunks()));return j;}
test('normal 60 MiB resources: preview remains unregistered, accept and backup restore retain exact bytes',{timeout:60000},async t=>{
 const {dir,jobs}=await setup(t), a=Buffer.alloc(30*1024*1024,13),b=Buffer.alloc(30*1024*1024,29),bytes=charx([{name:'assets/other/a.bin',bytes:a},{name:'assets/other/b.bin',bytes:b},{name:'assets/audio/tone.wav',bytes:silentWav()}]);
 const start=Date.now(),j=await upload(jobs,bytes),p=await ready(jobs,j.id);assert.equal(p.status,'ready');assert.equal(p.preview.card.assets.length,3);assert.equal(p.preview.card.assets.filter(x=>x.mime.startsWith('audio/')).length,1);assert.deepEqual(await listCards(dir),[]);
 const done=await jobs.accept(j.id);assert.equal(done.status,'completed');assert.deepEqual(await readFile(join(dir,done.result.card.original.path)),bytes);for(const [name,value]of [['assets/other/a.bin',a],['assets/other/b.bin',b]]){const asset=done.result.card.extensions._import.resources.find(x=>x.name===name);assert.deepEqual(await readFile(join(dir,asset.path)),value);}
 const store=new WorldStore(dir);let backup;try{backup=await createBackup(store,dir);}finally{store.close();}const file=join(dir,'review-backup.json');await writeFile(file,JSON.stringify(backup));const restored=join(dir,'restored');await restoreBackup(file,restored);const card=(await readCard(restored,done.cardId)).card;assert.deepEqual(await readFile(join(restored,card.original.path)),bytes);assert.deepEqual(await readdir(join(dir,'.import-jobs')),[j.id+'.json']);console.log(JSON.stringify({bytes:bytes.length,elapsedMs:Date.now()-start,rss:process.memoryUsage().rss,restored:true}));
});
test('ordinary preparing cancellation releases worker and staging without registering',async t=>{
 const {dir,jobs}=await setup(t),bytes=charx([{name:'assets/other/normal.bin',bytes:Buffer.alloc(25*1024*1024,4)}]);const j=await upload(jobs,bytes);assert.equal(jobs.get(j.id).status,'preparing');assert.equal((await jobs.cancel(j.id)).status,'cancelled');assert.deepEqual(await listCards(dir),[]);assert.deepEqual(await readdir(join(dir,'assets')),[]);assert.deepEqual(await readdir(join(dir,'.import-jobs')),[j.id+'.json']);assert.equal((await jobs.create({filename:'next.json',size:2})).status,'created');
});
test('ordinary accept followed immediately by cancel is atomic and can be retried',async t=>{
 const {dir,jobs}=await setup(t),bytes=charx([{name:'assets/audio/tone.wav',bytes:silentWav()}]);let j=await upload(jobs,bytes);await ready(jobs,j.id);const accepted=jobs.accept(j.id),cancelled=jobs.cancel(j.id);const [a,c]=await Promise.all([accepted,cancelled]);assert.equal(a.status,'cancelled');assert.equal(c.status,'cancelled');assert.deepEqual(await listCards(dir),[]);assert.deepEqual(await readdir(join(dir,'assets')),[]);j=await upload(jobs,bytes);await ready(jobs,j.id);assert.equal((await jobs.accept(j.id)).status,'completed');assert.equal((await jobs.cancel(j.id)).status,'completed');assert.equal((await listCards(dir)).length,1);
});
test('ordinary 21 MiB accepted resource survives backup and restore',{timeout:30000},async t=>{
 const {dir,jobs}=await setup(t),payload=Buffer.alloc(21*1024*1024,37),bytes=charx([{name:'assets/other/archive.bin',bytes:payload}]);const j=await upload(jobs,bytes);await ready(jobs,j.id);const done=await jobs.accept(j.id);assert.equal(done.status,'completed');const store=new WorldStore(dir);let backup;try{backup=await createBackup(store,dir);}finally{store.close();}const file=join(dir,'review-backup.json');await writeFile(file,JSON.stringify(backup));const restored=join(dir,'restored');await restoreBackup(file,restored);const card=(await readCard(restored,done.cardId)).card;assert.deepEqual(await readFile(join(restored,card.original.path)),bytes);const r=card.extensions._import.resources.find(x=>x.name==='assets/other/archive.bin');assert.deepEqual(await readFile(join(restored,r.path)),payload);
});
test('transient job-record persistence failure must release unregistered upload storage',async t=>{
 const {dir,jobs}=await setup(t),save=jobs.save.bind(jobs);let injected=false;jobs.save=async j=>{if(j.status==='ready'&&!injected){injected=true;throw Object.assign(Error('ordinary simulated disk write failure'),{code:'EIO'});}return save(j);};
 const bytes=charx([{name:'assets/other/ordinary.bin',bytes:Buffer.alloc(1024*1024,8)}]),j=await upload(jobs,bytes);assert.equal((await ready(jobs,j.id)).status,'failed');assert.equal(injected,true);assert.deepEqual(await listCards(dir),[]);await jobs.cancel(j.id);await jobs.close();const remaining=await readdir(join(dir,'.import-jobs'));console.log(JSON.stringify({failure:'ready record save',remaining}));assert.deepEqual(remaining,[j.id+'.json'],'failure/cancel/close should remove source staging, even for a terminal job');
});
