import {actorState} from './actor-view.mjs';
import {clone,applyOperations,checkPrecondition} from './domain-state.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const events=new Set(['input','before_generate','model_output','display','post_commit']);
const own=(obj,key)=>obj&&Object.hasOwn(obj,key)?obj[key]:undefined;
const string=value=>value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);

/** Small data-only template grammar. No eval, JS expressions, imports or dynamic property access. */
export function renderTemplate(input,{card={},state={},max=8000}={}){
 const text=String(input??'').slice(0,Math.min(65536,max*4)),root=[],stack=[{nodes:root}],tags=/\{\{([^{}]+)\}\}/g;let cursor=0,m;
 while((m=tags.exec(text))){let frame=stack.at(-1);frame.nodes.push({text:text.slice(cursor,m.index)});const tag=m[1];
  if(tag.startsWith('#if ')||tag.startsWith('#each ')){if(stack.length>8)fail('TEMPLATE_LIMIT','Template nesting exceeds eight levels');const [type,...name]=tag.slice(1).split(' ');const key=name.join(' ');if(!/^[\w.:-]{1,128}$/.test(key))fail('TEMPLATE_SYNTAX','Invalid template key');const node={type,key,yes:[],no:[]};frame.nodes.push(node);stack.push({node,nodes:node.yes});}
  else if(tag==='else'){if(!frame.node||frame.node.type!=='if'||frame.otherwise)fail('TEMPLATE_SYNTAX','Unexpected else');frame.otherwise=true;frame.nodes=frame.node.no;}
  else if(tag==='/if'||tag==='/each'){if(frame.node?.type!==tag.slice(1))fail('TEMPLATE_SYNTAX','Unbalanced template block');stack.pop();}
  else frame.nodes.push({macro:tag});cursor=tags.lastIndex;
 }
 if(stack.length!==1)fail('TEMPLATE_SYNTAX','Unclosed template block');root.push({text:text.slice(cursor)});
 let visits=0;const scoped=key=>{const parts=key.split(/::|:/);if(parts.length===2&&['world','card','scene'].includes(parts[0]))return own(state[parts[0]==='world'?'variables':parts[0]+'Variables'],parts[1]);return own(state.variables,key);};const lookup=(key,item)=>own(item,key)??scoped(key);
 const render=(nodes,item)=>{let output='';for(const node of nodes){if(++visits>10000)fail('TEMPLATE_LIMIT','Template expansion limit');if(node.text!==undefined)output+=node.text;
   else if(node.type==='if')output+=render(lookup(node.key,item)?node.yes:node.no,item);
   else if(node.type==='each'){const list=own(state,node.key);if(!Array.isArray(list)||!['characters','relations','inventory','facts','goals','plotThreads'].includes(node.key))continue;for(const entry of list.slice(0,100))output+=render(node.yes,entry);}
   else if(node.macro==='char')output+=string(card.name||'角色');else if(node.macro==='user')output+='玩家';
   else if(node.macro.startsWith('getvar::'))output+=string(scoped(node.macro.slice(8))).slice(0,500);
   else if(item&&/^[\w-]+$/.test(node.macro))output+=string(own(item,node.macro)).slice(0,500);
   else output+='{{'+node.macro+'}}';
   if(output.length>max)output=output.slice(0,max);
  }return output;};return render(root).slice(0,max);
}
function regex(rule){
 if(!rule||typeof rule!=='object'||typeof rule.pattern!=='string'||rule.pattern.length>256||typeof rule.replacement!=='string'||rule.replacement.length>4096||!['input','model_output','display'].includes(rule.stage))fail('REGEX_UNSUPPORTED','Invalid staged text rule');
 // Finite-width regular expressions only. Groups, alternation, backreferences and
 // repetition are not this version's contract. This avoids unbounded backtracking.
 const stripped=rule.pattern.replace(/\\[\\.^$\[\]{}()*+?|/\-sdwSDWtnr]/g,'');
 if(/[\\()*+?{}|]/.test(stripped))fail('REGEX_UNSUPPORTED','Only finite-width regex atoms/classes/anchors are supported; migrate repetitions or groups explicitly');
 const flags=rule.flags??'g';if(!/^[giu]*$/.test(flags)||new Set(flags).size!==flags.length)fail('REGEX_UNSUPPORTED','Supported regex flags: g, i, u');
 try{return new RegExp(rule.pattern,flags);}catch{fail('REGEX_UNSUPPORTED','Invalid regular expression');}
}
export function applyTextRules(input,rules=[],stage){
 if(!Array.isArray(rules)||rules.length>32)fail('BEHAVIOR_LIMIT','At most 32 text rules');let output=String(input??'');if(output.length>65536)fail('BEHAVIOR_LIMIT','Text rule input exceeds 64 KiB characters');
 for(const rule of rules){if(rule?.enabled===false||rule?.stage!==stage)continue;output=output.replace(regex(rule),rule.replacement);if(output.length>65536)fail('BEHAVIOR_LIMIT','Text rule output exceeds 64 KiB characters');}return output;
}
export function behaviorReport(card){const rules=card.extensions?.story_runtime?.textRules;if(rules===undefined)return [];if(!Array.isArray(rules)||rules.length>32)return [{field:'extensions.story_runtime.textRules',status:'unsupported',message:'Text rules require an array with at most 32 entries'}];return rules.map((r,i)=>{try{regex(r);return {field:`extensions.story_runtime.textRules[${i}]`,status:'mapped',message:'Finite-width regex mapped to '+r.stage+' stage; display leaves canonical text unchanged'};}catch(e){return {field:`extensions.story_runtime.textRules[${i}]`,status:'unsupported',message:e.message};}});}
export function runBehaviors(card,canonical,event,input,{actorId='player'}={}){
 if(!events.has(event))fail('BEHAVIOR_STAGE','Unknown lifecycle event');if(card.extensions?._import&&!(card.extensions._import.normalizerVersion>=2))return {state:clone(canonical),operations:[],text:String(input??''),trace:[]};const state=clone(canonical),operations=[],trace=[];let text=String(input??'');const rules=card.extensions?.story_runtime?.rules??[];
 if(!Array.isArray(rules)||rules.length>64)fail('BEHAVIOR_LIMIT','At most 64 lifecycle rules');
 for(const [index,rule]of rules.entries()){
  if(rule?.enabled===false||rule?.event!==event)continue;
  if(rule.when!==undefined&&!checkPrecondition(actorState(state,actorId),rule.when,actorId))continue;
  if(rule.operations!==undefined){if(['display','post_commit'].includes(event))fail('BEHAVIOR_STAGE','Display and post-commit events cannot change world state');if(!Array.isArray(rule.operations)||operations.length+rule.operations.length>100)fail('BEHAVIOR_LIMIT','At most 100 staged operations');applyOperations(state,rule.operations,{author:false,dryRun:true});operations.push(...clone(rule.operations));}
  if(rule.append!==undefined){if(typeof rule.append!=='string'||rule.append.length>8000)fail('BEHAVIOR_LIMIT','Invalid lifecycle text');text+=(text?'\n':'')+renderTemplate(rule.append,{card,state:actorState(state,actorId)});}
  if(text.length>65536)fail('BEHAVIOR_LIMIT','Lifecycle text exceeds limit');trace.push({index,event,operations:rule.operations?.length||0});
 }
 text=applyTextRules(text,card.extensions?.story_runtime?.textRules??[],event);
 return {state,operations,text,trace};
}
