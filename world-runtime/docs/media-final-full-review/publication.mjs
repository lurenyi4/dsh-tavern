import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
import {startServer} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/server.mjs';
const root=await fs.mkdtemp(join(tmpdir(),'full-contract-http-'));const realOpen=fs.open;let server;
const options={dataDir:root,port:0,runtimeDir:new URL('../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime',import.meta.url).pathname,env:{}};
const api=async(path,body)=>{const r=await fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()};};
try {
 server=await startServer(options);
 let valid;
 for(const length of [512,513]){
 const bytes=Buffer.from(JSON.stringify({name:'名'.repeat(length),extensions:{future:{preserved:[1,'好',false,null]}}}));
 const legacy=await api('/api/import',{filename:'name.json',base64:bytes.toString('base64')});
 const job=await api('/api/import-jobs',{filename:'name.json',size:bytes.length});
 const upload=await fetch(server.url+'/api/import-jobs/'+job.id+'/upload',{method:'PUT',body:bytes});assert.equal(upload.status,202);
 let read;do{await new Promise(r=>setTimeout(r,5));read=await api('/api/import-jobs/'+job.id);}while(read.status==='preparing');
 assert.equal(read.status,length===512?'ready':'failed');assert.equal(legacy.http,length===512?201:400);
 if(length===512){valid=legacy.card;const done=await api('/api/import-jobs/'+job.id+'/accept',{});assert.equal(done.status,'completed');assert.deepEqual(done.result.card.extensions.future,{preserved:[1,'好',false,null]});}
 console.log(JSON.stringify({case:'name-boundary-across-entrypoints',length,legacyHTTP:legacy.http,binaryJob:read.status}));
 }
 const bytes=Buffer.from('{"name":"Independent publication"}');const j=await api('/api/import-jobs',{filename:'published.json',size:bytes.length});await fetch(server.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes});let p;do{await new Promise(r=>setTimeout(r,5));p=await api('/api/import-jobs/'+j.id);}while(p.status==='preparing');assert.equal(p.status,'ready');
 let injected=0;fs.open=async(path,...args)=>{const h=await realOpen(path,...args);if(path===join(root,'cards'))h.sync=async()=>{injected++;throw Object.assign(new Error('Independent cards fsync EIO'),{code:'EIO'});};return h;};syncBuiltinESMExports();
 const done=await api('/api/import-jobs/'+j.id+'/accept',{});fs.open=realOpen;syncBuiltinESMExports();assert.equal(done.status,'completed');assert.equal(done.warning.storageCode,'EIO');assert.equal(injected,1);
 assert.equal((await api('/api/worlds',{name:'Publication world',cardId:done.cardId})).http,201);assert.equal((await api('/api/backup')).http,200);
 await server.close();server=await startServer(options);const reopened=await api('/api/import-jobs/'+j.id);assert.equal(reopened.status,'completed');assert.equal(reopened.warning.storageCode,'EIO');assert.equal(reopened.error,undefined);
 console.log(JSON.stringify({case:'actual-http-publish-fsync-failure-world-backup-reopen',status:done.status,warning:done.warning,reopened:reopened.status}));
}finally{fs.open=realOpen;syncBuiltinESMExports();await server?.close();await fs.rm(root,{recursive:true,force:true});}
