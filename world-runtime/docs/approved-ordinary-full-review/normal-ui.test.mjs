import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {JSDOM} from 'jsdom';
const source=readFileSync('/workspace/scratch/476e99dedb43/dsh-tavern-recovered/Story-Runtime-Linux-0.1.0/world-runtime/public/app.js','utf8');
const ast=parse(source,{ecmaVersion:'latest'});
const fn=name=>{const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end);};
test('ordinary terminal history retains all diagnostics, draft and eligible retry; committed excluded',()=>{
 const dom=new JSDOM('<div id="runHistory"></div>');const d=dom.window.document;
 const runs=['failed','interrupted','draft','cancelled','committed'].map(status=>({status,updatedAt:'2026-10-05',error:{message:status+' diagnostic'},draft:status+' retained draft',canRetrySettlement:['failed','interrupted','draft'].includes(status)}));
 const c={state:{snapshot:{runs}},$:id=>d.getElementById(id),el:(tag,text)=>{const n=d.createElement(tag);n.textContent=text??'';return n;},button:(text,cb)=>{const n=d.createElement('button');n.textContent=text;return n;}};
 vm.createContext(c);vm.runInContext(fn('runStatusMessage')+'\n'+fn('renderRuns'),c);c.renderRuns();
 assert.equal(d.querySelectorAll('details').length,4);assert.equal(d.querySelectorAll('button').length,3);
 for(const status of ['failed','interrupted','draft','cancelled']){assert.ok(d.body.textContent.includes(status+' diagnostic'));assert.ok(d.body.textContent.includes(status+' retained draft'));}
 assert.ok(!d.body.textContent.includes('状态尚未保存'));assert.ok(!d.body.textContent.includes('committed diagnostic'));
 c.state.viewPending=true;c.renderRuns();assert.equal(d.getElementById('runHistory').textContent,'');dom.window.close();
});
test('obsolete normal terminal event does not finish a newer run',()=>{
 const streams=[];const finished=[];
 const c={state:{active:null},EventSource:class{constructor(){this.events=new Map();streams.push(this);}addEventListener(k,f){this.events.set(k,f);}close(){}},renderActive(){},finishRun(...args){finished.push(args);}};
 vm.createContext(c);vm.runInContext(fn('runStatusMessage')+'\n'+fn('watchRun'),c);c.watchRun('first',{});c.watchRun('second',{});
 streams[0].events.get('cancelled')({data:'{"persisted":true}'});assert.equal(finished.length,0);assert.equal(c.state.active.token,'second');
 streams[1].events.get('cancelled')({data:'{"persisted":true}'});assert.equal(finished.length,1);assert.equal(finished[0][1],false);
});
