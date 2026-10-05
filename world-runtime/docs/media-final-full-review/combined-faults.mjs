import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/server.mjs';
import {charx,silentWav} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/fixtures/import-fixtures.mjs';
const root=await fs.mkdtemp(join(tmpdir(),'review-combined-')),realRm=fs.rm,realRename=fs.rename,realWrite=fs.writeFile;let server;
const options={dataDir:root,port:0,runtimeDir:new URL('../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime',import.meta.url).pathname,env:{}};
const api=async(path,body)=>{const r=await fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()};};
const upload=async(bytes,name)=>{const j=await api('/api/import-jobs',{filename:name,size:bytes.length});assert.equal(j.http,201);assert.equal((await fetch(server.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes})).status,202);return j;};
const poll=async(id,status)=>{for(let i=0;i<500;i++){const j=await api('/api/import-jobs/'+id);if(j.status===status)return j;await new Promise(r=>setTimeout(r,10));}throw Error('poll timeout');};
try{
 server=await startServer(options);
 const broken=Buffer.from('{"name":');const j=await api('/api/import-jobs',{filename:'incomplete.json',size:broken.length});
 let cleanup=0,journal=0;
 fs.rm=async(p,...a)=>{if(p===join(root,'.import-jobs',j.id+'.upload')){cleanup++;throw Object.assign(Error('Busy upload'),{code:'EBUSY'});}return realRm(p,...a);};
 fs.writeFile=async(p,data,...a)=>{if(p===join(root,'.import-jobs',j.id+'.json.tmp')&&JSON.parse(data).status==='failed'){journal++;throw Object.assign(Error('Journal unavailable'),{code:'EIO'});}return realWrite(p,data,...a);};syncBuiltinESMExports();
 await fetch(server.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:broken});await poll(j.id,'failed');await new Promise(r=>setTimeout(r,40));
 const failed=await api('/api/import-jobs/'+j.id);assert.equal(failed.error.code,'INVALID_JSON');assert.equal(failed.cleanupWarning.code,'EBUSY');assert.equal(failed.persistenceWarning.code,'EIO');console.log(JSON.stringify({case:'worker-cleanup-journal-simultaneous',failed,cleanup,journal}));
 fs.rm=realRm;fs.writeFile=realWrite;syncBuiltinESMExports();await api('/api/import-jobs/'+j.id+'/cancel',{});await server.close();server=await startServer(options);assert.equal((await api('/api/import-jobs/'+j.id)).error.code,'INVALID_JSON');
 const bytes=charx([{name:'sound.wav',bytes:silentWav()}]);const k=await upload(bytes,'ordinary.charx');await poll(k.id,'ready');
 fs.rename=async(a,b)=>{if(a.startsWith(join(root,'cards','.staging-')))throw Object.assign(Error('Publication IO failure'),{code:'EIO'});return realRename(a,b);};
 fs.rm=async(p,...a)=>{if(p.startsWith(join(root,'cards','.staging-'))&&!p.slice(join(root,'cards').length+1).includes('/'))throw Object.assign(Error('Staging cleanup busy'),{code:'EBUSY'});return realRm(p,...a);};syncBuiltinESMExports();
 const rejected=await api('/api/import-jobs/'+k.id+'/accept',{});console.log(JSON.stringify({case:'registration-primary-and-staging-cleanup',rejected,cards:await fs.readdir(join(root,'cards')),assets:await fs.readdir(join(root,'assets'))}));assert.equal(rejected.status,'failed');
 fs.rm=realRm;fs.rename=realRename;syncBuiltinESMExports();const retry=await api('/api/import-jobs/'+k.id+'/cancel',{});const leftovers={cards:await fs.readdir(join(root,'cards')),assets:await fs.readdir(join(root,'assets'))};console.log(JSON.stringify({case:'registration-cancel-after-fault-cleared',retry,leftovers}));
 const continued=await api('/api/import',{filename:'continued.json',base64:Buffer.from('{"name":"Continued use"}').toString('base64')});assert.equal(continued.http,201);assert.equal((await api('/api/worlds',{name:'Still usable',cardId:continued.card.id})).http,201);assert.equal((await api('/api/backup')).http,200);console.log('With faults removed and before restart: next legacy import, world creation, and backup all succeed');await server.close();server=await startServer(options);assert.deepEqual((await fs.readdir(join(root,'cards'))).filter(x=>x.startsWith('.staging-')),[]);assert.deepEqual(await fs.readdir(join(root,'assets')),[]);console.log('Startup clears staging/assets; no card publication or original-card corruption');
}finally{fs.rm=realRm;fs.rename=realRename;fs.writeFile=realWrite;syncBuiltinESMExports();await server?.close();await fs.rm(root,{recursive:true,force:true});}
