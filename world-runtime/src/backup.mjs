import {mkdtemp, mkdir, readdir, readFile, writeFile, lstat, rm, rename, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve, dirname, sep, parse as parsePath} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {WorldStore} from './store.mjs';
import {importCard} from './importer.mjs';
import {parseJson, sniffMedia} from './import-formats.mjs';

import {STORAGE_LIMITS} from './storage-limits.mjs';
const MAX=STORAGE_LIMITS.backupBytes, FILE_MAX=STORAGE_LIMITS.backupFileBytes, COUNT=STORAGE_LIMITS.backupFiles;
const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
function validName(name){
 return typeof name==='string'&&name.length<600&&(name==='world.sqlite'||/^assets\/[a-f0-9]{64}$/.test(name)||/^cards\/[a-f0-9]{64}\/(?:card\.json|report\.json|original|resources\/[a-f0-9]{64})$/.test(name));
}
async function noLinks(path){
 const absolute=resolve(path);let current=parsePath(absolute).root;
 for(const part of absolute.slice(current.length).split(sep).filter(Boolean)){
  current=join(current,part);
  try{if((await lstat(current)).isSymbolicLink())fail('BACKUP_PATH','备份路径不能经过符号链接');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return absolute;
}
async function absent(path){
 try{await lstat(path);fail('RESTORE_EXISTS','恢复目录必须尚不存在；不会覆盖原存档。');}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function readRegular(path,max=FILE_MAX){
 let handle;
 try{
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();
  if(!stat.isFile())fail('BACKUP_PATH','备份只读取普通文件');
  if(stat.size>max)fail('BACKUP_LIMIT','备份文件超出安全大小限制');
  const bytes=await handle.readFile();if(bytes.length>max)fail('BACKUP_LIMIT','备份文件超出安全大小限制');return bytes;
 }catch(error){if(error.code==='ELOOP')fail('BACKUP_PATH','备份不读取符号链接');throw error;}finally{await handle?.close();}
}
function validRoster(ids){
 return Array.isArray(ids)&&ids.length<=Math.floor(COUNT/3)&&ids.every(id=>typeof id==='string'&&HASH.test(id))&&new Set(ids).size===ids.length;
}
function closure(message){fail('BACKUP_CLOSURE',message);}
function json(bytes,label){try{return parseJson(bytes,label);}catch(error){closure(`${label} 格式不受支持（${error.code??'INVALID_JSON'}）`);}}

/** Validate references, not merely checksums of the files that happen to be present.
 * Re-import each exact original in a disposable directory using the same bounded,
 * non-executing importer. This independently establishes the expected normalized
 * card, migration report and full resource/media closure, including unknown bytes.
 * No reconstructed file is silently substituted for a missing backup member.
 */
async function validateClosure(files,cardIds,store,scratch){
 const registered=new Set(cardIds),cards=new Map(),used=new Set(['world.sqlite']);
 const required=(path)=>{const value=files.get(path);if(value===undefined)closure(`备份缺少依赖文件：${path}`);used.add(path);return value;};
 for(const name of files.keys())if(name.startsWith('cards/')&&!registered.has(name.split('/')[1]))closure('备份包含未登记的角色卡文件');
 for(const id of cardIds){
  const prefix=`cards/${id}/`,card=json(required(prefix+'card.json'),'card.json'),report=json(required(prefix+'report.json'),'report.json'),original=required(prefix+'original');
  if(!plain(card)||card.id!==id||!plain(card.original)||card.original.sha256!==id||card.original.path!==prefix+'original'||sha(original)!==id)closure('角色卡原件身份或内容哈希不一致');
  let rebuilt,temporary;
  try{
   temporary=await mkdtemp(join(scratch,'.card-check-'));
   try{rebuilt=await importCard({filename:card.original.name,bytes:original,dataDir:temporary,normalizerVersion:card.extensions?._import?.normalizerVersion??1});}catch(error){closure(`角色卡原件无法验证（${error.code??'INVALID_CARD'}）`);}
   if(!isDeepStrictEqual(card,rebuilt.card)||!isDeepStrictEqual(report,rebuilt.report))closure('角色卡、迁移报告或资源声明与原件不一致');
   for(const resource of rebuilt.card.extensions._import.resources){
    const bytes=required(resource.path);
    if(bytes.length!==resource.size||sha(bytes)!==resource.sha256)closure('保留资源的内容哈希或尺寸不一致');
   }
   for(const asset of rebuilt.card.assets){
    const bytes=required(asset.path);
    if(bytes.length!==asset.size||sha(bytes)!==asset.id||asset.sha256!==asset.id)closure('展示资源的内容哈希或尺寸不一致');
   }
  }finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
  cards.set(id,card);
 }
 // An interrupted importer may leave unreferenced immutable media. They are safe
 // to retain only if their path is their actual hash and bytes are already in the
 // importer's sanitized media form. Never expose retained raw/active resources.
 for(const [path,bytes] of files){
  if(path.startsWith('assets/')){
   if(sha(bytes)!==path.slice(7))closure('媒体文件名与内容哈希不一致');
   let media;try{media=sniffMedia(bytes);}catch{closure('备份媒体文件格式损坏');}
   if(!media||!media.bytes.equals(bytes))closure('备份媒体文件不是受支持的安全展示副本');
  }else if(!used.has(path))closure('备份包含未声明的角色卡资源');
 }
 for(const world of store.listWorlds()){
  let snapshot;try{snapshot=store.snapshot(world.id);}catch(error){closure(`世界快照无法读取（${error.code??'INVALID_WORLD'}）`);}
  const worldCard=snapshot.world.card,registeredCard=cards.get(worldCard?.id);
  if(!registeredCard)closure('世界引用未登记的角色卡；请先通过导入流程登记原件');
  // The server copies an explicitly selected alternate greeting into the world.
  // Everything else, including identity, original and resources, stays identical.
  if(![registeredCard.firstMessage,...registeredCard.alternateGreetings].includes(worldCard.firstMessage)||!isDeepStrictEqual({...worldCard,firstMessage:registeredCard.firstMessage},registeredCard))closure('世界角色卡与已登记原件或资源不一致');
 }
}

export async function createBackup(store,dataDir){
 const root=await noLinks(dataDir),temp=await mkdtemp(join(root,'.backup-'));let size=0;const files=[],bytesByPath=new Map(),cardIds=[];let snapshot;
 const add=async(path,name)=>{
  if(!validName(name))fail('BACKUP_PATH','不支持的备份路径');
  const bytes=await readRegular(path);size+=bytes.length;
  if(size>MAX||files.length>=COUNT)fail('BACKUP_LIMIT','备份超出大小限制，请分别导出存档');
  bytesByPath.set(name,bytes);files.push({path:name,size:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')});
 };
 try{
  await store.backup(join(temp,'world.sqlite'));await add(join(temp,'world.sqlite'),'world.sqlite');
  const visit=async(directory,prefix)=>{
   let entries;try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())fail('BACKUP_PATH','备份资源目录必须是普通目录');entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'&&['cards','assets'].includes(prefix))return;throw error;}
   for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(prefix==='cards'&&entry.name.startsWith('.staging-'))continue;
    if(entry.isSymbolicLink())fail('BACKUP_PATH','备份不读取符号链接');
    const path=join(directory,entry.name),name=prefix+'/'+entry.name;
    if(entry.isDirectory()){
     if(prefix==='cards'&&HASH.test(entry.name))cardIds.push(entry.name);
     else if(!/^cards\/[a-f0-9]{64}\/resources$/.test(name))fail('BACKUP_PATH','不支持的备份目录');
     await visit(path,name);
    }else await add(path,name);
   }
  };
  for(const part of ['cards','assets'])await visit(join(root,part),part);
  if(!validRoster(cardIds))fail('BACKUP_LIMIT','角色卡登记数量超限');
  // Validate against the online snapshot, never a later live database state.
  snapshot=new WorldStore(temp);await validateClosure(bytesByPath,cardIds,snapshot,temp);snapshot.close();snapshot=null;
  return {format:'story-runtime-backup',version:1,createdAt:new Date().toISOString(),includes:'world database, imported cards and assets; no model credentials or derived host logs',cardIds,files};
 }finally{snapshot?.close();await rm(temp,{recursive:true,force:true});}
}

export async function restoreBackup(file,destination){
 const target=resolve(destination);await absent(target);await noLinks(dirname(target));await noLinks(file);
 let value;const encoded=await readRegular(file,MAX*1.5);
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(encoded));}catch{fail('BACKUP_FORMAT','无法读取备份JSON');}
 if(!exactKeys(value,['format','version','createdAt','includes','cardIds','files'])||value.format!=='story-runtime-backup'||value.version!==1||!validRoster(value.cardIds)||!Array.isArray(value.files)||value.files.length>COUNT)fail('BACKUP_FORMAT','未知或不完整的备份格式');
 let size=0;const decoded=new Map();
 for(const record of value.files){
  if(!exactKeys(record,['path','size','sha256','base64'])||!validName(record.path)||decoded.has(record.path)||!Number.isSafeInteger(record.size)||record.size<0||record.size>FILE_MAX||typeof record.base64!=='string'||record.base64.length!==Math.ceil(record.size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(record.base64)||typeof record.sha256!=='string'||!HASH.test(record.sha256))fail('BACKUP_FORMAT','备份清单不合法');
  size+=record.size;if(size>MAX)fail('BACKUP_LIMIT','展开备份超出限制');
  const bytes=Buffer.from(record.base64,'base64');
  if(bytes.length!==record.size||sha(bytes)!==record.sha256||bytes.toString('base64')!==record.base64)fail('BACKUP_HASH','备份校验失败，未恢复');
  decoded.set(record.path,bytes);
 }
 if(!decoded.has('world.sqlite'))fail('BACKUP_FORMAT','备份缺少世界数据库');
 if(decoded.get('world.sqlite').subarray(0,16).toString()!=='SQLite format 3\0')fail('BACKUP_FORMAT','备份数据库格式错误');
 await mkdir(dirname(target),{recursive:true,mode:0o700});const staging=await mkdtemp(join(dirname(target),'.story-restore-'));let store;
 try{
  for(const [name,bytes]of decoded){
   const path=resolve(staging,name);if(!path.startsWith(staging+sep))fail('BACKUP_PATH','非法相对路径');
   await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,bytes,{flag:'wx',mode:0o600});
  }
  store=new WorldStore(staging);await validateClosure(decoded,value.cardIds,store,staging);
  store.resetProjectionReceipts();store.close();store=null;
  // Only a fully verified closure is published; original saves are never used as
  // a repair source. Same-volume rename keeps the final directory publication atomic.
  await absent(target);await noLinks(dirname(target));
  await rename(staging,target);return {dataDir:target,files:decoded.size,projection:'pending-explicit-rebuild'};
 }finally{store?.close();await rm(staging,{recursive:true,force:true});}
}
