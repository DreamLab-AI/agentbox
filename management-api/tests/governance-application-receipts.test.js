'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ApplicationReceiptStore } = require('../lib/governance-application-receipts');
const { operationDigest } = require('../lib/governance-correlation');
const operation={kind:'broker-enrichment-decision',case_id:'case-a',payload:{outcome:'approve'}};
const gate={released:true,request_event_id:'req-a',response_event_id:'response-a',operation_sha256:operationDigest(operation)};
function setup(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'governance-receipt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,store:new ApplicationReceiptStore(dir)}; }

test('committed acknowledgement produces a persistent applied receipt and replay is read-only',t=>{
  const {dir,store}=setup(t);const claim=store.begin(gate,operation);
  assert.equal(claim.fresh,true);
  const receipt=store.finish(claim,'applied',{writeback_committed:true});
  assert.equal(receipt.stage,'applied');
  const replay=new ApplicationReceiptStore(dir).begin(gate,operation);
  assert.equal(replay.fresh,false);assert.equal(replay.outcome.stage,'applied');
  assert.equal(fs.readdirSync(dir).length,2);
});

test('crash after received claim requires reconciliation after restart',t=>{
  const {dir,store}=setup(t);store.begin(gate,operation);
  const replay=new ApplicationReceiptStore(dir).begin(gate,operation);
  assert.equal(replay.fresh,false);assert.equal(replay.outcome,null);
});

test('mismatched payload or request cannot reuse an approval',t=>{
  const {store}=setup(t);store.begin(gate,operation);
  assert.throws(()=>store.begin(gate,{...operation,case_id:'case-b'}),/exact approved/);
  assert.throws(()=>store.begin({...gate,request_event_id:'req-b'},operation),/different request/);
});

test('refusal and unknown outcome can never become applied without committed acknowledgement',t=>{
  const {store}=setup(t);const claim=store.begin(gate,operation);
  assert.throws(()=>store.finish(claim,'applied',{writeback_committed:false}),/committed/);
  store.finish(claim,'unknown',{error:'timeout'});
  assert.equal(store.begin(gate,operation).outcome.stage,'unknown');
  assert.throws(()=>store.finish(claim,'applied',{writeback_committed:true}),{code:'EEXIST'});
});

test('receipt storage failure prevents an operation claim',t=>{
  const {dir}=setup(t);const bad=path.join(dir,'not-a-directory');fs.writeFileSync(bad,'x');
  assert.throws(()=>new ApplicationReceiptStore(bad).begin(gate,operation));
});
