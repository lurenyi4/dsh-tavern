import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const root='/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0';
const require=createRequire(root+'/package.json');
const {parse}=require('acorn'),{JSDOM}=require('jsdom');
const source=readFileSync(root+'/world-runtime/public/app.js','utf8');
const ast=parse(source,{ecmaVersion:'latest'});
function fn(name){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n);return source.slice(n.start,n.end);}
const elNode=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='el'));
const elSource=source.slice(elNode.start,elNode.end);
const warning={message:'Local storage warning <storage> & details'};
function fixture(runs){
 const dom=new JSDOM('<div id="runHistory"></div>');
 const context={document:dom.window.document,state:{viewPending:false,snapshot:{runs}},$:id=>dom.window.document.getElementById(id),button:()=>assert.fail('unexpected retry')};
 vm.createContext(context);vm.runInContext(elSource+'\n'+fn('runStatusMessage')+'\n'+fn('renderRuns'),context);context.renderRuns();
 return {dom,context,history:dom.window.document.getElementById('runHistory')};
}
test('actual production el preserves diagnostic and draft text literally',()=>{
 const run={status:'cancelled',updatedAt:0,error:{message:'Separate note <error>'},draft:'Draft <draft> & text',persistenceWarning:warning};
 const {dom,history}=fixture([run]);
 assert.equal(history.querySelectorAll('details').length,1);
 assert.equal(history.querySelector('p').textContent,'已取消，未提交草稿不会改变世界。 Separate note <error> '+warning.message);
 assert.equal(history.querySelector('pre').textContent,run.draft);
 assert.equal(history.querySelectorAll('storage,error,draft').length,0);
 dom.window.close();
});
test('other history states retain their previous diagnostics and drafts',()=>{
 for(const status of ['failed','interrupted','draft']){
  const {dom,history}=fixture([{status,updatedAt:0,error:{message:'Existing diagnostic'},draft:'Retained draft'}]);
  assert.equal(history.querySelector('p').textContent,'Existing diagnostic');
  assert.equal(history.querySelector('pre').textContent,'Retained draft');
  assert.equal(history.querySelector('summary').textContent.includes('状态尚未保存'),false);
  dom.window.close();
 }
});
test('SSE and history formatter agree; stale stream cannot finish current run',()=>{
 const events=new Map(),calls=[];
 const context={state:{active:null},EventSource:class{addEventListener(k,f){events.set(k,f)}},renderActive(){},finishRun(...args){calls.push(args)}};
 vm.createContext(context);vm.runInContext(fn('runStatusMessage')+'\n'+fn('watchRun'),context);
 context.watchRun('fixture',{});
 const payload={status:'cancelled',error:{message:'Separate note'},persistenceWarning:warning,persisted:false};
 const expected=context.runStatusMessage(payload);
 events.get('cancelled')({data:JSON.stringify(payload)});
 assert.equal(calls[0][0],expected.message);assert.equal(calls[0][1],expected.warning);
 context.state.active={token:'newer'};
 events.get('cancelled')({data:JSON.stringify(payload)});
 assert.equal(calls.length,1);
});
