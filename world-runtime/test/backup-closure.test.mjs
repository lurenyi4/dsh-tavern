import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, readFile, writeFile, rm, lstat, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {WorldStore} from '../src/store.mjs';
import {importCard, readCard, assetPath} from '../src/importer.mjs';
import {createBackup, restoreBackup} from '../src/backup.mjs';
import {v2, png, charx, mappedCharx} from '../fixtures/import-fixtures.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{archive=false,world=true}={}){
 const root=await mkdtemp(join(tmpdir(),'backup-closure-')),dataDir=join(root,'data');
 const store=new WorldStore(dataDir);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const bytes=archive?charx():png([['chara',v2]]),filename=archive?'complete.charx':'complete.png';
 const imported=await importCard({dataDir,filename,bytes});
 const snapshot=world?store.createWorld({name:'Closure fixture',card:imported.card}):null;
 return {root,dataDir,store,bytes,...imported,snapshot,backup:await createBackup(store,dataDir)};
}
async function restoreValue(f,value,target='restored'){
 const file=join(f.root,`${target}.json`);await writeFile(file,JSON.stringify(value));
 return restoreBackup(file,join(f.root,target));
}
async function rejectsClean(f,value,code='BACKUP_CLOSURE'){
 const target=`rejected-${randomUUID()}`;
 await assert.rejects(restoreValue(f,value,target),{code});
 await assert.rejects(lstat(join(f.root,target)),{code:'ENOENT'});
 assert.ok(!(await readdir(f.root)).some(x=>x.startsWith('.story-restore-')),'failed restore removed staging');
 if(f.snapshot)assert.equal(f.store.snapshot(f.snapshot.world.id).world.card.id,f.card.id);
}
function replaceFile(value,path,bytes){const entry=value.files.find(f=>f.path===path);assert.ok(entry,path);Object.assign(entry,{size:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')});}
function editJson(value,path,edit){const entry=value.files.find(f=>f.path===path),json=JSON.parse(Buffer.from(entry.base64,'base64'));edit(json);replaceFile(value,path,Buffer.from(JSON.stringify(json)));}
async function editDatabase(f,value,edit){
 const file=join(f.root,`edit-${randomUUID()}.sqlite`);await writeFile(file,Buffer.from(value.files.find(x=>x.path==='world.sqlite').base64,'base64'));
 const db=new DatabaseSync(file);try{edit(db);}finally{db.close();}
 replaceFile(value,'world.sqlite',await readFile(file));await rm(file);
}

test('B04: deleting only a PNG asset manifest entry rejects before target publication',async t=>{
 const f=await fixture(t),value=structuredClone(f.backup),asset=f.card.assets[0];
 value.files=value.files.filter(x=>x.path!==asset.path);
 await rejectsClean(f,value);
});
test('each registered card requires card, report, original, and every preserved resource',async t=>{
 const f=await fixture(t,{archive:true}),prefix=`cards/${f.card.id}/`;
 for(const path of [`${prefix}card.json`,`${prefix}report.json`,`${prefix}original`,...f.card.extensions._import.resources.map(x=>x.path)])await t.test(path.split('/').at(-1),async()=>{
  const value=structuredClone(f.backup);value.files=value.files.filter(x=>x.path!==path);await rejectsClean(f,value);
 });
});
test('standalone cards retain a complete registration and dependency closure',async t=>{
 const f=await fixture(t,{world:false}),prefix=`cards/${f.card.id}/`;
 assert.deepEqual(f.backup.cardIds,[f.card.id]);
 for(const omit of [x=>x.path===f.card.assets[0].path,x=>x.path.startsWith(prefix)]){
  const value=structuredClone(f.backup);value.files=value.files.filter(x=>!omit(x));await rejectsClean(f,value);
 }
 const value=structuredClone(f.backup);value.cardIds=[];await rejectsClean(f,value);
});
test('rehashing modified normalized paths, identities, declarations, reports, or source still fails closure',async t=>{
 const f=await fixture(t,{archive:true}),prefix=`cards/${f.card.id}/`;
 for(const [label,edit] of [
  ['card identity',c=>{c.id='f'.repeat(64);}],
  ['original identity',c=>{c.original.sha256='f'.repeat(64);}],
  ['original path',c=>{c.original.path='../original';}],
  ['asset path',c=>{c.assets[0].path='../outside';}],
  ['asset hash',c=>{c.assets[0].sha256='f'.repeat(64);}],
  ['asset MIME',c=>{c.assets[0].mime='text/html';}],
  ['resource path',c=>{c.extensions._import.resources[0].path='assets/'+c.extensions._import.resources[0].sha256;}],
  ['resource size',c=>{c.extensions._import.resources[0].size++;}],
  ['removed resource declaration',c=>{c.extensions._import.resources=[];}],
  ['removed media declaration',c=>{c.assets=[];}]
 ])await t.test(label,async()=>{const value=structuredClone(f.backup);editJson(value,`${prefix}card.json`,edit);await rejectsClean(f,value);});
 const report=structuredClone(f.backup);editJson(report,`${prefix}report.json`,r=>{r.length=0;});await rejectsClean(f,report);
 const source=structuredClone(f.backup);replaceFile(source,`${prefix}original`,Buffer.from('different source'));await rejectsClean(f,source);
 const resource=structuredClone(f.backup);replaceFile(resource,f.card.extensions._import.resources[0].path,Buffer.from('different resource'));await rejectsClean(f,resource);
});
test('dangling world card registrations and changed world resource metadata reject',async t=>{
 const f=await fixture(t);
 for(const change of [c=>{c.id='a'.repeat(64);},c=>{c.assets[0].path='../unexpected';},c=>{c.firstMessage='not a registered greeting';}]){
  const value=structuredClone(f.backup);await editDatabase(f,value,db=>{
   const row=db.prepare('SELECT id,card_json FROM worlds').get(),card=JSON.parse(row.card_json);change(card);
   db.prepare('UPDATE worlds SET card_json=? WHERE id=?').run(JSON.stringify(card),row.id);
  });await rejectsClean(f,value);
 }
 const value=structuredClone(f.backup);value.files=value.files.filter(x=>!x.path.startsWith(`cards/${f.card.id}/`));value.cardIds=[];await rejectsClean(f,value);
});
test('complete PNG/CharX/unsupported resources roundtrip preserves bytes, greetings, branches and resets receipts',async t=>{
 const f=await fixture(t),other=await importCard({dataDir:f.dataDir,filename:'mapped.charx',bytes:mappedCharx()}),unsupported=await importCard({dataDir:f.dataDir,filename:'unsupported.charx',bytes:charx()});
 const alternative={...other.card,firstMessage:other.card.alternateGreetings[1]};
 const alt=f.store.createWorld({name:'Alternate empty greeting',card:alternative}),s=f.snapshot;
 const committed=f.store.commit({worldId:s.world.id,branchId:s.branch.id,runId:randomUUID(),expectedHead:null,sourceRevision:s.branch.sourceRevision,userText:'next',narrative:'Preserved scene',operations:[]});
 f.store.markProjected(s.world.id,s.branch.id,committed.commitId);f.store.fork({worldId:s.world.id,branchId:s.branch.id,commitId:committed.commitId,name:'Fork'});
 await mkdir(join(f.dataDir,'host'),{recursive:true});await writeFile(join(f.dataDir,'host','derived.log'),'do not archive');
 const value=await createBackup(f.store,f.dataDir);assert.ok(!value.files.some(x=>x.path.startsWith('host/')));
 const result=await restoreValue(f,value),restored=new WorldStore(result.dataDir);
 try{
  assert.equal(restored.snapshot(alt.world.id).world.card.firstMessage,'');
  for(const branch of restored.snapshot(s.world.id).branches){const snapshot=restored.snapshot(s.world.id,branch.id);assert.equal(snapshot.scenes[0].narrative,'Preserved scene');assert.ok(snapshot.outbox.every(x=>x.status==='pending'));}
  for(const card of [f.card,other.card,unsupported.card]){
   assert.deepEqual((await readCard(result.dataDir,card.id)).card,card);
   assert.deepEqual(await readFile(join(result.dataDir,card.original.path)),await readFile(join(f.dataDir,card.original.path)));
   for(const resource of card.extensions._import.resources)assert.deepEqual(await readFile(join(result.dataDir,resource.path)),await readFile(join(f.dataDir,resource.path)));
   for(const asset of card.assets)assert.equal((await assetPath(result.dataDir,asset.id)).sha256,asset.sha256);
  }
 }finally{restored.close();}
});
test('manifest corruption, unknown schema, missing roster and unsafe extra paths fail without artifacts',async t=>{
 const f=await fixture(t);
 const hash=structuredClone(f.backup);hash.files[0].sha256='0'.repeat(64);await rejectsClean(f,hash,'BACKUP_HASH');
 const path=structuredClone(f.backup);path.files[1].path='../escape';await rejectsClean(f,path,'BACKUP_FORMAT');
 const roster=structuredClone(f.backup);delete roster.cardIds;await rejectsClean(f,roster,'BACKUP_FORMAT');
 const schema=structuredClone(f.backup);await editDatabase(f,schema,db=>db.exec('PRAGMA user_version=999'));await rejectsClean(f,schema,'UNSUPPORTED_SCHEMA');
});
test('creating an app backup rejects minimal unregistered WorldStore fixture cards',async t=>{
 const f=await fixture(t);f.store.createWorld({name:'Minimal card',card:{name:'No registered source'}});
 await assert.rejects(createBackup(f.store,f.dataDir),{code:'BACKUP_CLOSURE'});
 assert.ok(!(await readdir(f.dataDir)).some(x=>x.startsWith('.backup-')));
});
test('backup creation detects missing source dependencies and empty registrations, and skips unfinished import staging',async t=>{
 const f=await fixture(t),staging=join(f.dataDir,'cards','.staging-unfinished');await mkdir(staging);await writeFile(join(staging,'media-pending'),'partial');
 assert.ok(!(await createBackup(f.store,f.dataDir)).files.some(x=>x.path.includes('.staging-')));
 await mkdir(join(f.dataDir,'cards','f'.repeat(64)));await assert.rejects(createBackup(f.store,f.dataDir),{code:'BACKUP_CLOSURE'});await rm(join(f.dataDir,'cards','f'.repeat(64)),{recursive:true});
 await rm(join(f.dataDir,f.card.assets[0].path));await assert.rejects(createBackup(f.store,f.dataDir),{code:'BACKUP_CLOSURE'});
});
test('existing directories and dangling destination links are never replaced',async t=>{
 const f=await fixture(t),target=join(f.root,'existing');await mkdir(target);await writeFile(join(target,'keep'),'original');
 await assert.rejects(restoreValue(f,f.backup,'existing'),{code:'RESTORE_EXISTS'});assert.equal(await readFile(join(target,'keep'),'utf8'),'original');
 await symlink(join(f.root,'missing-link-target'),join(f.root,'linked'));
 await assert.rejects(restoreValue(f,f.backup,'linked'),{code:'RESTORE_EXISTS'});assert.ok((await lstat(join(f.root,'linked'))).isSymbolicLink());
});

test('unreferenced media must remain hash-addressed sanitized safe media, while undeclared raw resources reject',async t=>{
 const f=await fixture(t);
 const record=bytes=>({path:'assets/'+sha(bytes),size:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')});
 const safe=structuredClone(f.backup),safeBytes=png();
 // The fixture already references this raster, so use different valid pixel bytes.
 const wav=Buffer.alloc(44);wav.write('RIFF');wav.writeUInt32LE(36,4);wav.write('WAVE',8);
 safe.files.push(record(wav));await restoreValue(f,safe,'safe-orphan');
 for(const bytes of [Buffer.from('<svg>active format</svg>'),png([['chara',v2]])]){
  const value=structuredClone(f.backup);value.files.push(record(bytes));await rejectsClean(f,value);
 }
 const undeclared=structuredClone(f.backup),bytes=Buffer.from('unlisted preserved bytes');
 undeclared.files.push({...record(bytes),path:`cards/${f.card.id}/resources/${sha(bytes)}`});await rejectsClean(f,undeclared);
 const wrongHash=structuredClone(f.backup);wrongHash.files.push({...record(safeBytes),path:'assets/'+'f'.repeat(64)});await rejectsClean(f,wrongHash);
});
test('unknown manifest fields, duplicate registrations and members, and symbolic-link input are refused',async t=>{
 const f=await fixture(t);
 for(const edit of [value=>{value.future={};},value=>{value.cardIds.push(value.cardIds[0]);},value=>{value.files.push(value.files[0]);},value=>{value.files[0].future=true;}]){
  const value=structuredClone(f.backup);edit(value);await rejectsClean(f,value,'BACKUP_FORMAT');
 }
 const file=join(f.root,'real-backup.json'),link=join(f.root,'backup-link');await writeFile(file,JSON.stringify(f.backup));await symlink(file,link);
 await assert.rejects(restoreBackup(link,join(f.root,'link-restored')),{code:'BACKUP_PATH'});
 await symlink(join(f.root,'data'),join(f.root,'parent-link'));
 await assert.rejects(restoreBackup(file,join(f.root,'parent-link','restored')),{code:'BACKUP_PATH'});
});
test('empty-world backups are valid but incomplete standalone card registrations cannot be exported',async t=>{
 const root=await mkdtemp(join(tmpdir(),'backup-empty-')),store=new WorldStore(join(root,'data'));
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const value=await createBackup(store,join(root,'data'));assert.deepEqual(value.cardIds,[]);
 const result=await restoreValue({root},value),restored=new WorldStore(result.dataDir);try{assert.deepEqual(restored.listWorlds(),[]);}finally{restored.close();}
 await mkdir(join(root,'data','cards','b'.repeat(64)),{recursive:true});await assert.rejects(createBackup(store,join(root,'data')),{code:'BACKUP_CLOSURE'});
});
