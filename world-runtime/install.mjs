#!/usr/bin/env node
import {mkdir,copyFile,readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {join} from 'node:path';
import {npmCommand} from './src/install-command.mjs';
const npm=npmCommand();
const here=fileURLToPath(new URL('.',import.meta.url)),target=join(here,'.runtime');
await mkdir(target,{recursive:true});for(const name of ['package.json','package-lock.json'])await copyFile(new URL('../config/cli-runtime/'+name,import.meta.url),join(target,name));
console.log('Installing exact upstream DSH 0.1.5-rc.2 lock from the official npm registry; lifecycle scripts disabled.');
const result=spawnSync(npm.command,[...npm.prefix,'ci','--prefix',target,'--ignore-scripts','--no-audit','--no-fund','--registry','https://registry.npmjs.org'],{stdio:'inherit',env:{...process.env,npm_config_cache:join(target,'.npm-cache')}});if(result.error)throw result.error;if(result.status)process.exit(result.status);
for(const name of ['dsh-app-boot','dsh-session','dsh-session-persistence','dsh-session-persistence-jsonl']){const pkg=JSON.parse(await readFile(join(target,'node_modules/@deepseek-ai',name,'package.json'),'utf8'));if(pkg.version!=='0.1.5-rc.2')throw new Error('Unexpected runtime version: '+name);}
console.log('Locked runtime ready. Run npm run start:world -- --data-dir /your/new/directory');
