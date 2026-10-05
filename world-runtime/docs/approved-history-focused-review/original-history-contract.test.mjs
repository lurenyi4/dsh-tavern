import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const root='/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0';
const require=createRequire(root+'/package.json');
const {parse}=require('acorn'), {JSDOM}=require('jsdom');
const source=readFileSync(process.env.REVIEW_SOURCE || root+'/world-runtime/public/app.js','utf8');
const ast=parse(source,{ecmaVersion:'latest'});
function fn(name){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n);return source.slice(n.start,n.end);}
const warning={code:'RUN_PERSISTENCE',storageCode:'EIO',message:'已取消，但取消状态尚未保存。请检查本地存储后再恢复运行。'};
test('current cancelled SSE handler displays unsaved warning',()=>{
 const events=new Map(), calls=[];
 const context={state:{active:null},EventSource:class{addEventListener(k,fn){events.set(k,fn)}},renderActive(){},finishRun(...v){calls.push(v)}};
 vm.createContext(context);vm.runInContext(fn('watchRun'),context);
 context.watchRun('ordinary-token',{});
 events.get('cancelled')({data:JSON.stringify({persisted:false,persistenceWarning:warning})});
 assert.deepEqual(calls,[[warning.message,true]]);
});
test('history renders persistence warning supplied by snapshot after returning to world',()=>{
 const dom=new JSDOM('<div id="runHistory"></div>');
 const document=dom.window.document;
 const context={state:{viewPending:false,snapshot:{runs:[{status:'cancelled',updatedAt:'2026-10-05T00:00:00Z',draft:'ordinary draft',persistenceWarning:warning,canRetrySettlement:false}]}},$:id=>document.getElementById(id),el:(tag,text)=>{const n=document.createElement(tag);n.textContent=text??'';return n;},button:()=>assert.fail('cancelled warning must not offer retry')};
 vm.createContext(context);vm.runInContext((ast.body.some(n=>n.type==='FunctionDeclaration'&&n.id.name==='runStatusMessage')?fn('runStatusMessage')+'\n':'')+fn('renderRuns'),context);context.renderRuns();
 const actual=document.getElementById('runHistory').textContent;
 console.log('Actual cancelled history:',actual);
 assert.ok(actual.includes(warning.message),'Snapshot persistence warning should remain visible in run history');
 dom.window.close();
});
