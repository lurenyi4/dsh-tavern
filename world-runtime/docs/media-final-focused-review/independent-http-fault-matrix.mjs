import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/server.mjs';
const real={rm:fs.rm,writeFile:fs.writeFile,rename:fs.rename};
for(const mode of ['rm_once','rm_persistent','write_once','write_persistent','rename_once','rename_persistent','combined']) {
 const dir=await fs.mkdtemp(join(tmpdir(),'focus-http-matrix-'));let server;let enabled=true,rmFaults=0,saveFaults=0;
 const options={dataDir:dir,port:0,runtimeDir:new URL('../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime',import.meta.url).pathname,env:{}};
 const api=async(path,body)=>{const r=await fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()};};
 try {
  server=await startServer(options);
  const bytes=Buffer.from('{"name":'),job=await api('/api/import-jobs',{filename:'broken.json',size:bytes.length});
  const upload=join(dir,'.import-jobs',job.id+'.upload'),journal=join(dir,'.import-jobs',job.id+'.json'),url='/api/import-jobs/'+job.id;
  const active=n=>enabled&&(!mode.endsWith('once')||n===0);
  fs.rm=async(p,...args)=>{if(p===upload&&(mode.startsWith('rm')||mode==='combined')&&active(rmFaults)){rmFaults++;throw Object.assign(new Error('probe rm busy'),{code:'EBUSY'});}return real.rm(p,...args);};
  fs.writeFile=async(p,data,...args)=>{if(p===journal+'.tmp'&&(mode.startsWith('write')||mode==='combined')&&JSON.parse(data).status==='failed'&&active(saveFaults)){saveFaults++;throw Object.assign(new Error('probe journal write'),{code:'ENOSPC'});}return real.writeFile(p,data,...args);};
  fs.rename=async(p,to,...args)=>{if(to===journal&&mode.startsWith('rename')&&JSON.parse(await fs.readFile(p,'utf8')).status==='failed'&&active(saveFaults)){saveFaults++;throw Object.assign(new Error('probe journal rename'),{code:'EIO'});}return real.rename(p,to,...args);};syncBuiltinESMExports();
  assert.equal((await fetch(server.url+url+'/upload',{method:'PUT',body:bytes})).status,202);
  let failed;for(let i=0;i<300;i++){failed=await api(url);if(failed.status==='failed'&&(mode.startsWith('rm')?failed.cleanupWarning:failed.persistenceWarning))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(failed.status,'failed');assert.equal(failed.error.code,'INVALID_JSON');assert.equal(failed.preview,undefined);
  assert.equal((await api(url+'/accept',{})).http,400);
  if(mode.startsWith('rm')||mode==='combined'){assert.equal(failed.cleanupWarning.code,'EBUSY');assert.deepEqual(await fs.readFile(upload),bytes);}
  if(!mode.startsWith('rm'))assert.equal(failed.persistenceWarning.code,mode.startsWith('rename')?'EIO':'ENOSPC');
  const retry=await api(url+'/cancel',{});assert.equal(retry.http,mode.endsWith('persistent')&&!mode.startsWith('rm')||mode==='combined'?400:200);
  assert.equal((await api(url)).error.code,'INVALID_JSON');
  enabled=false;
  // Half the paths recover by close alone, the remainder via explicit cancellation.
  if(mode.startsWith('rm')||mode.startsWith('rename')){const fixed=await api(url+'/cancel',{});assert.equal(fixed.status,'failed');assert.equal(fixed.cleanupWarning,undefined);}
  await server.close();server=await startServer(options);
  const reopened=await api(url);assert.equal(reopened.status,'failed');assert.equal(reopened.error.code,'INVALID_JSON');assert.equal(reopened.cleanupWarning,undefined);
  await assert.rejects(fs.stat(upload),{code:'ENOENT'});
  const cards=await fs.readdir(join(dir,'cards')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));assert.deepEqual(cards,[]);
  console.log(JSON.stringify({mode,rmFaults,saveFaults,retryHTTP:retry.http,primary:reopened.error.code,status:reopened.status,cleanupWarning:reopened.cleanupWarning,persistenceWarning:reopened.persistenceWarning?.code,uploadRemoved:true,cards:cards.length}));
 }finally{enabled=false;Object.assign(fs,real);syncBuiltinESMExports();await server?.close();await fs.rm(dir,{recursive:true,force:true});}
}
