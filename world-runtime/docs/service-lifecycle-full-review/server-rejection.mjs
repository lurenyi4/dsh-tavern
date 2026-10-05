import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/src/server.mjs';
const dir=await fs.mkdtemp(join(tmpdir(),'audit-server-close-'));
const app=await startServer({dataDir:dir,port:0,runtimeDir:'/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/.runtime',env:{}});
const bytes=Buffer.from('{"name":"Probe"}');const j=await (await fetch(app.url+'/api/import-jobs',{method:'POST',body:JSON.stringify({filename:'card.json',size:bytes.length})})).json();
await fetch(app.url+'/api/import-jobs/'+j.id+'/upload',{method:'PUT',body:bytes});
for(let i=0;i<100;i++){const status=await (await fetch(app.url+'/api/import-jobs/'+j.id)).json();if(status.status==='ready')break;await new Promise(r=>setTimeout(r,10));}
let release,entered;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r),rename=fs.rename;let failed=false;
fs.rename=async(from,to)=>{if(String(from).includes('/cards/.staging-')){await rename(from,to);entered();await gate;return;}if(String(to).endsWith(j.id+'.json')){const value=JSON.parse(await fs.readFile(from,'utf8'));if(value.status==='completed'&&!failed){failed=true;throw Object.assign(Error('one-shot journal EIO'),{code:'EIO'});}}return rename(from,to)};syncBuiltinESMExports();
const accepting=fetch(app.url+'/api/import-jobs/'+j.id+'/accept',{method:'POST'});await entry;
const closing=app.close();closing.catch(()=>{});release();
const result=(await Promise.allSettled([closing]))[0];const response=await accepting;
console.log(JSON.stringify({close:result.status,error:result.reason?.code,acceptHTTP:response.status,serverStillListening:app.server.listening,lockExists:!!(await fs.stat(join(dir,'.server-lock'))),registeredCards:(await (await fetch(app.url+'/api/cards')).json()).cards.length}));
fs.rename=rename;syncBuiltinESMExports();await app.close();console.log('second app.close returned; server still listening:',app.server.listening);
await new Promise(r=>app.server.close(r));await app.projection.close();app.store.close();await fs.rm(dir,{recursive:true,force:true});
