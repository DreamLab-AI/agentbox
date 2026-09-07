import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { createDefaultRetrieval }=require('../../mcp/servers/lib/ontology-retrieval');
const identity=(id='g1',digest='a'.repeat(64))=>({generation:{id},content_digest:digest,atomicity_verified:true});
const report=(id=identity())=>({id:id.generation.id,identity:id,semantic_generation:id.generation,embedding:{model_id:'bge-small-en-v1.5',dimensions:384,metric:'cosine',rejections:[]},drift:{checked:true,ok:true},disk:{matches_loaded:true}});
function setup(){
 const state={report:report(),reads:0,responseIdentity:null};
 const brain=createDefaultRetrieval({loomUrl:'http://fixture',telemetry:{record(){}},loomFetch:async(path,opts)=>{
  if(path==='/loom/generation'){assert.equal(opts.method,'GET');return state.report;}
  state.reads++;
  return {serving_identity:state.responseIdentity||state.report.identity,hits:[{iri:'urn:test:class',label:'Class'}],rows:[]};
 }});
 return {state,brain};
}
test('verified identity precedes cache hits and binds changed content',async()=>{
 const {state,brain}=setup();const q={query:'class',mode:'menu'};
 const first=await brain.ask(q);assert.equal(first.degraded,false);assert.equal((await brain.ask(q)).cache_hit,true);
 state.report=report(identity('g1','b'.repeat(64)));
 const changed=await brain.ask(q);assert.equal(changed.cache_hit,false);assert.notEqual(first.generation,changed.generation);assert.equal(state.reads,2);
});
test('unavailable identity never returns previously cached grounding',async()=>{
 const {state,brain}=setup();await brain.ask({query:'class'});state.report={error:'unavailable'};
 const out=await brain.ask({query:'class'});assert.equal(out.error,'loom_identity_rejected');assert.equal(out.turtle,'');
});
test('model, dimension, drift and explicit generation mismatches fail closed',async()=>{
 for(const mutate of [r=>r.embedding.model_id='other',r=>r.embedding.dimensions=768,r=>r.embedding.metric='euclidean',r=>r.semantic_generation={id:'g2'},r=>r.drift.ok=false,r=>r.disk.matches_loaded=false,r=>r.identity.atomicity_verified=false]){
  const {state,brain}=setup();mutate(state.report);const out=await brain.ask({query:'class'});assert.equal(out.error,'loom_identity_rejected');assert.equal(state.reads,0);
 }
 const {brain}=setup();assert.equal((await brain.ask({query:'class',generation:'g2'})).error,'loom_identity_rejected');
});
test('mixed-generation response cannot enter grounding or cache',async()=>{
 const {state,brain}=setup();state.responseIdentity=identity('g2');const out=await brain.ask({query:'class'});assert.equal(out.degraded,true);assert.equal(out.turtle,'');
});
test('HTTP transport keeps Rust array hits and checks response identity headers',async()=>{
 const { makeLoomFetch }=require('../../mcp/servers/lib/ontology-retrieval');
 const fetcher=makeLoomFetch({loomUrl:'http://fixture',fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'POST');
  return new Response(JSON.stringify([{iri:'urn:test:class',label:'Class'}]),{headers:{'x-loom-generation':'g1','x-loom-content-digest':'a'.repeat(64),'x-loom-atomicity-verified':'true'}});
 }});
 const out=await fetcher('/loom/search',{body:'{}'});assert.equal(out.hits[0].iri,'urn:test:class');assert.deepEqual(out.serving_identity,identity());
});
test('an expansion response from another bundle discards even valid seeds',async()=>{
 const brain=createDefaultRetrieval({loomUrl:'http://fixture',telemetry:{record(){}},loomFetch:async(path)=>{
  if(path==='/loom/generation') return report();
  if(path==='/loom/search') return {hits:[{iri:'urn:test:class',label:'Class'}],serving_identity:identity()};
  return {rows:[],serving_identity:identity('g2')};
 }});
 const out=await brain.ask({query:'class',mode:'expand',model_tier:'sonnet'});assert.equal(out.error,'loom_identity_rejected');assert.equal(out.turtle,'');
});
