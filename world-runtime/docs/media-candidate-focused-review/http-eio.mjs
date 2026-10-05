import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/server.mjs';
const runtimeDir=new URL('../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime/',import.meta.url).pathname;
const realOpen=fs.open;
for(const cancel of [false,true]) {
 const dir=await fs.mkdtemp(join(tmpdir(),'focused-http-eio-'));let server, cancellation;
 try {
  server=await startServer({dataDir:dir,port:0,runtimeDir,env:{}});
  const api=async(path,body)=>{const response=await fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  const bytes=Buffer.from(JSON.stringify({name:'HTTP filesystem durability',first_mes:'Morning'}));
  const j=await api('/api/import-jobs',{filename:'local.json',size:bytes.length});
  assert.equal((await fetch(server.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes})).status,202);
  let ready;do {await new Promise(r=>setTimeout(r,10));ready=await api('/api/import-jobs/'+j.id);}while(ready.status==='preparing');assert.equal(ready.status,'ready');
  let injected=false;
  fs.open=async function(path,...args){const handle=await realOpen.call(this,path,...args);if(path===join(dir,'cards')&&!injected){handle.sync=async()=>{injected=true;if(cancel)cancellation=api('/api/import-jobs/'+j.id+'/cancel',{});throw Object.assign(Error('Review post-publication EIO'),{code:'EIO'});};}return handle;};syncBuiltinESMExports();
  const done=await api('/api/import-jobs/'+j.id+'/accept',{});fs.open=realOpen;syncBuiltinESMExports();
  assert.equal(injected,true);assert.equal(done.status,'completed');assert.equal(done.warning.code,'IMPORT_DURABILITY');assert.equal(done.warning.storageCode,'EIO');if(cancellation)assert.equal((await cancellation).status,'completed');
  assert.deepEqual(Buffer.from(await (await fetch(server.url+'/api/cards/'+done.cardId+'/original')).arrayBuffer()),bytes);
  await server.close();server=await startServer({dataDir:dir,port:0,runtimeDir,env:{}});let recovered=await api('/api/import-jobs/'+j.id);assert.equal(recovered.status,'completed');assert.equal(recovered.warning.storageCode,'EIO');
  await server.close();server=null;
  const record=join(dir,'.import-jobs',j.id+'.json'), saved=JSON.parse(await fs.readFile(record,'utf8'));saved.status=cancel?'cancelled':'failed';saved.stage='registering';saved.error={code:'EIO',message:'Old release outcome'};delete saved.warning;await fs.writeFile(record,JSON.stringify(saved));
  server=await startServer({dataDir:dir,port:0,runtimeDir,env:{}});recovered=await api('/api/import-jobs/'+j.id);assert.equal(recovered.status,'completed');assert.equal(recovered.warning.code,'IMPORT_DURABILITY');
  console.log(JSON.stringify({cancel,actualHttp:true,injected,accept:done.status,storageCode:done.warning.storageCode,restart:recovered.status,legacyError:recovered.error}));
 } finally {fs.open=realOpen;syncBuiltinESMExports();await server?.close();await fs.rm(dir,{recursive:true,force:true});}
}
