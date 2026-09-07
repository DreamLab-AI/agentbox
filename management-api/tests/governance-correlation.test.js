'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { responseMatchesRequest, operationDigest } = require('../lib/governance-correlation');
const { GovernanceDecisionWaiter } = require('../lib/governance-decision-waiter');
const { buildAuthorityGate } = require('../lib/authority');
const manifest = { skills: { authority: { classes: { mutate: 'zero-tolerance' } } } };
const request = { kind: 31402, id: 'signed-request-a', tags: [['d','shared-panel']], content: '{"case_id":"case-a"}' };
const response = { kind: 31403, id: 'signed-response', tags: [['e',request.id],['d','shared-panel']], content: '{"outcome":"approve","case_id":"case-a"}' };

test('only an exact unambiguous request reference can release its operation', () => {
  assert.equal(responseMatchesRequest(response, request), true);
  for (const tags of [[['d','shared-panel']], [['e','other'],['d','shared-panel']], [['e',request.id],['e','other']], [['e',request.id],['d','wrong-panel']]]) {
    assert.equal(responseMatchesRequest({...response,tags},request),false);
  }
  assert.equal(responseMatchesRequest({...response,content:'{"case_id":"wrong"}'},request),false);
});

test('two operations sharing a panel never consume each others approval', async () => {
  const waiter = new GovernanceDecisionWaiter();
  const a = waiter.awaitDecision(request,{timeoutMs:40});
  const b = waiter.awaitDecision({...request,id:'signed-request-b'},{timeoutMs:40});
  assert.equal(waiter.notify(response),true);
  assert.equal((await a).id,response.id);
  assert.equal(await b,null);
  assert.equal(waiter.notify(response),false);
});

test('operation digest is stable across object order and sensitive to mutation', () => {
  assert.equal(operationDigest({case:'a',value:1}),operationDigest({value:1,case:'a'}));
  assert.notEqual(operationDigest({case:'a',value:1}),operationDigest({case:'b',value:1}));
  assert.throws(()=>operationDigest({value:NaN}));
});

test('gate signs the concrete operation and refuses changed publisher content', async () => {
  const operation={kind:'write',case_id:'case-a',payload:{value:1}};
  let published;
  const gate=buildAuthorityGate(manifest,{
    publishActionRequest:async unsigned=>{published=unsigned;return {...unsigned,id:request.id};},
    awaitDecision:async req=>({...response,tags:[['e',req.id]]}),verifyEvent:()=>true,
  });
  const accepted=await gate.guard({actionClass:'mutate',operation});
  assert.equal(accepted.decision,'allow');
  assert.deepEqual(JSON.parse(published.content).fields.operation,operation);
  assert.equal(accepted.operation_sha256,operationDigest(operation));
  assert.equal((await gate.guard({actionClass:'mutate'})).reason,'missing-or-invalid-operation');
  const changed=buildAuthorityGate(manifest,{
    publishActionRequest:async unsigned=>({...unsigned,id:request.id,content:'{"fields":{}}'}),
    awaitDecision:async()=>response,verifyEvent:()=>true,
  });
  assert.equal((await changed.guard({actionClass:'mutate',operation})).reason,'request-payload-changed');
});
