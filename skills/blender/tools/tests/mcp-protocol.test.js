'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const bridge = path.join(__dirname, '..', 'mcp-blender-client.js');
test('MCP handshake, discovery, notifications and invalid typed frame', () => {
  const input = [
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'set_frame',arguments:{frame:'1);bad()'}}}
  ].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const p = spawnSync(process.execPath,[bridge],{input,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  const replies=p.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length,3);
  assert.equal(replies[0].result.protocolVersion,'2025-06-18');
  assert.ok(replies[1].result.tools.some(x=>x.name==='set_frame'));
  assert.equal(replies[2].result.isError,true);
});
