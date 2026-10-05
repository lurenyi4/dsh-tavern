// Ordinary synthetic lorebook, no scripts or external data. End-to-end capacity contract.
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '/workspace/scratch/476e99dedb43/normalized-focused-review-20261005/parent/world-runtime/src/server.mjs';
const dir=await mkdtemp(join(tmpdir(),'media-full-closure-'));let server;
try {
 server=await startServer({dataDir:dir,port:0,runtimeDir:'/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime',env:{}});
 const api=async(path,body)=>{const r=await fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
 const bytes=Buffer.from(JSON.stringify({name:'Ordinary reference book',first_mes:'Good morning.',character_book:{entries:Array.from({length:5000},(_,id)=>({id,keys:['place'+id],content:'A quiet village.',comment:'Local geography',enabled:true,insertion_order:id}))}}));
 const {value:j}=await api('/api/import-jobs',{filename:'reference.json',size:bytes.length});
 const upload=await fetch(server.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes});assert.equal(upload.status,202);
 let p;do{await new Promise(r=>setTimeout(r,10));p=(await api('/api/import-jobs/'+j.id)).value;}while(p.status==='preparing');assert.equal(p.status,'ready');
 const accepted=await api('/api/import-jobs/'+j.id+'/accept',{});assert.equal(accepted.value.status,'completed');
 const card=accepted.value.result.card;assert.deepEqual(await readFile(join(dir,card.original.path)),bytes);
 const world=await api('/api/worlds',{name:'Reference world',cardId:card.id});
 const backup=await api('/api/backup');
 const count=value=>1+(value&&typeof value==='object'?Object.values(value).reduce((n,x)=>n+count(x),0):0);
 console.log(JSON.stringify({originalBytes:bytes.length,normalizedBytes:JSON.stringify(card).length,preview:p.status,accepted:accepted.value.status,world:world.status,worldError:world.value.error,originalNodes:count(JSON.parse(bytes)),normalizedNodes:count(card),backupStatus:backup.status,backupError:backup.value.error}));
 assert.equal(backup.status,200,'Every accepted ordinary card should permit backup');
}finally{await server?.close();await rm(dir,{recursive:true,force:true});}
