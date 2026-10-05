// Deliberate fault seam, enabled only by Node's built-in test runner.
const faults=new WeakMap();
export function injectStoreFaultForTests(store, callback){
  if(!process.env.NODE_TEST_CONTEXT)throw new Error('Fault injection is available only in node:test');
  if(callback!==null&&typeof callback!=='function')throw new TypeError('callback');
  if(callback===null)faults.delete(store);
  else faults.set(store, callback);
}
export function storeFault(store, stage){
  if(process.env.NODE_TEST_CONTEXT)faults.get(store)?.(stage);
}
