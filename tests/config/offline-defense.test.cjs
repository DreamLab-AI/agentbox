const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('offline defense remains in the MetaHarness rebuild gate, not a new service',()=>{
 const flake=fs.readFileSync('flake.nix','utf8');
 assert.match(flake,/lib\.optionals \(toolchainCfg\.metaharness or false\)\s+\[ metaharnessPkg metaharnessDarwinPkg artexDefensePkg \]/);
 assert.match(flake,/pkgName = "@metaharness\/artex-defense"/);
 assert(!flake.includes('[program:artex-defense]'));assert(!flake.includes('[program:aidefence]'));
 assert(fs.readFileSync('management-api/lib/system-manifest.js','utf8').includes('offline evidence replay'));
 const lock=JSON.parse(fs.readFileSync('config/npm-locks/ruflo-3.77.1.package-lock.json'));
 assert.equal(lock.packages['node_modules/aidefence'].version,'3.2.1');
 assert.equal(lock.packages['node_modules/@claude-flow/aidefence'].version,'3.2.1');
});
const root=process.env.ARTEX_DEFENSE_ROOT;
for(const fixture of ['identity','findings'])for(const mode of ['monitor','simulate']){
 test(`real packaged ARTEX: ${fixture} ${mode}, verified and tamper-rejecting`,{skip:!root},()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'agentbox-artex-proof-'));
  try{
   const bin=path.join(root,'bin/artex-defense'),fixtures=path.join(root,'lib/metaharness-artex-defense/fixtures');
   const manifest=path.join(fixtures,`${fixture}.manifest.json`),input=path.join(fixtures,`${fixture}.${fixture==='identity'?'json':'csv'}`),report=path.join(tmp,'report.json');
   const run=(...args)=>spawnSync(bin,args,{encoding:'utf8',timeout:15000});
   const replay=run('replay',manifest,input,report,mode);assert.equal(replay.status,0,replay.stderr);
   const receipt=JSON.parse(replay.stdout);assert.match(receipt.tailSha256,/^[a-f0-9]{64}$/);assert.equal(receipt.mode,mode);
   const verify=run('verify',manifest,input,report,receipt.tailSha256);assert.equal(verify.status,0,verify.stderr);assert.equal(JSON.parse(verify.stdout).verified,true);
   const overwrite=run('replay',manifest,input,report,mode);assert.notEqual(overwrite.status,0,'existing evidence report overwritten');
   const changed=JSON.parse(fs.readFileSync(report));changed.result.candidate.summary.alerts=999;
   fs.writeFileSync(report,JSON.stringify(changed));
   assert.notEqual(run('verify',manifest,input,report,receipt.tailSha256).status,0,'tampered report accepted');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
}
