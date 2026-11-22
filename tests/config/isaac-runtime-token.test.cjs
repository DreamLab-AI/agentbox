// js-yaml is already present in this repository's locked Jest dependency graph.
// Do not accidentally resolve the parent estate's unrelated `yaml` package.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),YAML=require('js-yaml');
const read=p=>fs.readFileSync(p,'utf8');
test('the local Agentbox and Isaac runner use the shared runtime dotenv token',()=>{
 const main=YAML.safeLoad(read('docker-compose.override.yml')).services.agentbox;
 const runner=YAML.safeLoad(read('docker-compose.isaac-sim.yml')).services['isaac-sim'];
 assert(main.env_file.includes('.env'));
 assert.equal(runner.environment.ISAAC_RUNNER_TOKEN,'${ISAAC_RUNNER_TOKEN:-}');
 for(const file of ['docker-compose.yml','docker-compose.override.yml']){
  const env=YAML.safeLoad(read(file)).services.agentbox.environment;
  assert(!Array.isArray(env)||!env.some(e=>/^ISAAC_RUNNER_TOKEN=/.test(e)),'explicit empty environment would mask env_file');
 }
 assert.equal(runner.ports,undefined,'no new host control-plane port');
});
test('the example has no credential and the guide distinguishes preparation from activation',()=>{
 assert.match(read('.env.example'),/^ISAAC_RUNNER_TOKEN=$/m);
 const guide=read('docs/developer/isaac-sim.md');
 assert.match(guide,/not a build input/i);
 assert.match(guide,/does not\s+change running process environments/);
 assert.match(guide,/env_file/);
});
