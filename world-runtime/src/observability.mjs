import {createHash} from 'node:crypto';
export function manualPrices(env={}){
 const keys=['STORY_PRICE_INPUT','STORY_PRICE_CACHED_INPUT','STORY_PRICE_OUTPUT'];if(keys.some(k=>typeof env[k]!=='string'||!env[k].trim()))return null;
 const [input,cachedInput,output]=keys.map(k=>Number(env[k]));if([input,cachedInput,output].some(x=>!Number.isFinite(x)||x<0||x>1000000))return null;
 const currency=env.STORY_PRICE_CURRENCY||'USD';if(!/^[A-Z]{3}$/.test(currency))return null;return {input,cachedInput,output,currency};
}
export function usageReport(attempts=[],prices=null){
 const real=attempts.filter(x=>x.mode!=='demo'),valid=n=>Number.isSafeInteger(n)&&n>=0;
 const all=(key)=>real.every(x=>valid(x[key]));const total=key=>real.reduce((a,x)=>a+(valid(x[key])?x[key]:0),0);
 const input=all('inputTokens')?total('inputTokens'):null,output=all('outputTokens')?total('outputTokens'):null;
 const cached=all('cachedInputTokens')&&real.every(x=>!valid(x.inputTokens)||x.cachedInputTokens<=x.inputTokens)?total('cachedInputTokens'):null;
 const known=real.some(x=>['inputTokens','outputTokens','cachedInputTokens'].some(k=>valid(x[k])));
 const complete=input!==null&&output!==null&&cached!==null;
 const estimatedCost=prices&&complete?((input-cached)*prices.input+cached*prices.cachedInput+output*prices.output)/1000000:null;
 return {modelAttempts:real.length,demoAttempts:attempts.length-real.length,failedAttempts:real.filter(x=>['failed','cancelled'].includes(x.status)).length,inputTokens:input,cachedInputTokens:cached,outputTokens:output,usageCompleteness:complete?'complete':known?'partial':'unknown',cacheHitRatio:input>0&&cached!==null?cached/input:null,estimatedCost,currency:prices?.currency??null,priceBasis:prices?'manual per-million-token rates; estimate, not bill':'not configured',unknownUsageIsFree:false};
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function prefixDiagnostic(previous,messages,scope){
 const bytes=Buffer.from(JSON.stringify(messages)),scopeKey=JSON.stringify([scope.worldId,scope.branchId,scope.actorId,scope.sourceRevision]);let commonPrefixBytes=null,firstChangedMessage=null;
 if(previous&&JSON.stringify([previous.scope.worldId,previous.scope.branchId,previous.scope.actorId,previous.scope.sourceRevision])===scopeKey){const prior=Buffer.from(JSON.stringify(previous.messages));let i=0;while(i<Math.min(prior.length,bytes.length)&&prior[i]===bytes[i])i++;commonPrefixBytes=i;firstChangedMessage=messages.findIndex((m,j)=>JSON.stringify(m)!==JSON.stringify(previous.messages[j]));if(firstChangedMessage===-1&&messages.length!==previous.messages.length)firstChangedMessage=messages.length;}
 return {kind:'local-request-prefix',requestBytes:bytes.length,commonPrefixBytes,firstChangedMessage,requestHash:hash(bytes),scopeHash:hash(scopeKey),messageHashes:messages.map(m=>hash(JSON.stringify(m))),serverCacheHitRate:null,note:'Local byte-prefix similarity only; provider cache hits require actual usage. Restart clears comparison history.'};
}
