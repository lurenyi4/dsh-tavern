import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
test('CLI and Linux wrapper help exit without runtime install, listener or user state',()=>{
 const temp=mkdtempSync(join(tmpdir(),'story-help-'));
 try {
  mkdirSync(join(temp,'world-runtime'));
  copyFileSync(fileURLToPath(new URL('../cli.mjs',import.meta.url)),join(temp,'world-runtime/cli.mjs'));
  copyFileSync(fileURLToPath(new URL('../../start-story-runtime-linux.sh',import.meta.url)),join(temp,'start-story-runtime-linux.sh'));
  const guard=join(temp,'guard.cjs');writeFileSync(guard,"require('node:net').Server.prototype.listen=function(){throw Error('HELP_MUST_NOT_LISTEN')};\n");
  const before=readdirSync(temp).sort();
  for(const form of [['help'],['--help'],['-h'],['serve','--help'],['--port','0','-h']]){
   for(const wrapper of [false,true]){
    const out=execFileSync(wrapper?'bash':process.execPath,[join(temp,wrapper?'start-story-runtime-linux.sh':'world-runtime/cli.mjs'),...form,'--data-dir',join(temp,'user-state'),'--port','0'],{cwd:temp,env:{...process.env,STORY_DSH_RUNTIME_DIR:'',NODE_OPTIONS:'--require='+guard},encoding:'utf8',timeout:5000});
    assert.match(out,/Serve:.*cli\.mjs serve/);assert.doesNotMatch(out,/http:\/\//);assert.equal(existsSync(join(temp,'user-state')),false);assert.equal(existsSync(join(temp,'world-runtime/.runtime')),false);
   }
  }
  assert.deepEqual(readdirSync(temp).sort(),before);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('CLI version and invalid invocations do not load runtime or create state',()=>{
 const temp=mkdtempSync(join(tmpdir(),'story-cli-'));
 try {
  mkdirSync(join(temp,'src'));copyFileSync(fileURLToPath(new URL('../cli.mjs',import.meta.url)),join(temp,'cli.mjs'));
  copyFileSync(fileURLToPath(new URL('../src/platform.mjs',import.meta.url)),join(temp,'src/platform.mjs'));
  for(const form of [['version'],['--version'],['-v']])assert.match(execFileSync(process.execPath,[join(temp,'cli.mjs'),...form],{encoding:'utf8'}),/Story Runtime 0\.1\.0/);
  for(const form of [['serve','--port','oops'],['serve','--port','65536'],['serve','--typo'],['unknown'],['restore'],['serve','--data-dir']]){
   assert.throws(()=>execFileSync(process.execPath,[join(temp,'cli.mjs'),...form],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&!/ERR_MODULE_NOT_FOUND/.test(error.stderr));
  }
  assert.deepEqual(readdirSync(temp).sort(),['cli.mjs','src']);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('POSIX desktop wrappers forward arguments and exit status from any working directory',()=>{
 const temp=mkdtempSync(join(tmpdir(),'story launch 中文 '));
 try{
  mkdirSync(join(temp,'world-runtime'));
  writeFileSync(join(temp,'world-runtime/cli.mjs'),"console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;\n");
  for(const wrapper of ['start-story-runtime-linux.sh','start-story-runtime-macos.command']){
   copyFileSync(fileURLToPath(new URL('../../'+wrapper,import.meta.url)),join(temp,wrapper));
   for(const args of [['serve','--data-dir','/tmp/故事 空间'],['restore','backup file.zip','--data-dir','/tmp/new'],['--version']]){
    assert.throws(()=>execFileSync('bash',[join(temp,wrapper),...args],{cwd:tmpdir(),encoding:'utf8',stdio:'pipe'}),e=>e.status===7&&JSON.stringify(JSON.parse(e.stdout))===JSON.stringify(args));
   }
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('restore imports only backup module and preserves Unicode paths',()=>{
 const temp=mkdtempSync(join(tmpdir(),'story-restore-'));
 try{
  mkdirSync(join(temp,'src'));
  for(const file of ['cli.mjs','src/platform.mjs'])copyFileSync(fileURLToPath(new URL('../'+file,import.meta.url)),join(temp,file));
  writeFileSync(join(temp,'src/backup.mjs'),'export async function restoreBackup(file,dataDir){return {file,dataDir};}\n');
  const out=execFileSync(process.execPath,[join(temp,'cli.mjs'),'restore','故事 备份.zip','--data-dir','新 目录'],{cwd:temp,encoding:'utf8'});
  assert.deepEqual(JSON.parse(out),{file:join(temp,'故事 备份.zip'),dataDir:join(temp,'新 目录')});
  assert.equal(existsSync(join(temp,'新 目录')),false);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
