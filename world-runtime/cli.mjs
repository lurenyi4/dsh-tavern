#!/usr/bin/env node
import {resolve} from 'node:path';
const args=process.argv.slice(2);
// Metadata commands must work without installed runtime packages or any data I/O.
if(args[0]==='help'||args.includes('--help')||args.includes('-h')){
 console.log('Story Runtime 0.1.0 (candidate)\nServe: node world-runtime/cli.mjs serve [--port 3089] [--data-dir DIR]\nRestore: node world-runtime/cli.mjs restore FILE --data-dir NEW_DIR\nVersion: node world-runtime/cli.mjs --version\nRequires Node.js >=24.19.0 for serve/restore.\nDefault data: Windows LOCALAPPDATA/Story Runtime; macOS ~/Library/Application Support/Story Runtime; Linux XDG_DATA_HOME/story-runtime.\nSTORY_DATA_DIR overrides the default; --data-dir overrides the environment.\nAndroid native runtime is not yet validated. See PLATFORM_MATRIX.md.');
 process.exit(0);
}
if(args.length===1&&['version','--version','-v'].includes(args[0])){
 console.log('Story Runtime 0.1.0 (candidate)');process.exit(0);
}
try{
 const action=args[0]&&!args[0].startsWith('--')?args.shift():'serve';
 if(!['serve','restore'].includes(action))throw new Error('Unknown command: '+action);
 const file=action==='restore'?args.shift():null;
 if(action==='restore'&&(!file||file.startsWith('--')))throw new Error('Usage: node world-runtime/cli.mjs restore BACKUP --data-dir NEW_DIRECTORY');
 const options={};
 while(args.length){
  const name=args.shift();
  if(!['--data-dir',...(action==='serve'?['--port']:[])].includes(name))throw new Error('Unknown option: '+name);
  if(Object.hasOwn(options,name))throw new Error('Duplicate option: '+name);
  const value=args.shift();
  if(!value||value.startsWith('--'))throw new Error('Missing value for '+name);
  options[name]=value;
 }
 if(action==='restore'&&!options['--data-dir'])throw new Error('Restore requires --data-dir NEW_DIRECTORY');
 const rawPort=options['--port']??process.env.STORY_PORT??'3089';
 if(action==='serve'&&(!/^\d+$/.test(rawPort)||Number(rawPort)>65535))throw new Error('Port must be an integer between 0 and 65535');
 const {dataDirectory,checkNodeVersion}=await import('./src/platform.mjs');
 if(!checkNodeVersion())throw new Error('Story Runtime requires Node.js >=24.19.0 (stable)');
 const dataDir=resolve(options['--data-dir']||dataDirectory());
 process.umask(0o077);
 if(action==='restore'){
  const {restoreBackup}=await import('./src/backup.mjs');
  console.log(JSON.stringify(await restoreBackup(resolve(file),dataDir),null,2));
 }else{
  const {startServer}=await import('./src/server.mjs');
  const app=await startServer({dataDir,port:Number(rawPort)});
  console.log('Story Runtime: '+app.url);console.log('Data: '+dataDir);
  console.log('本地演示可直接使用；真实模型需服务端环境变量配置，默认不会调用远程API。');
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;try{await app.close();process.exit(0);}catch(e){console.error(e.message);process.exit(1);}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }
}catch(e){console.error((e.code?e.code+': ':'')+e.message);process.exitCode=1;}
