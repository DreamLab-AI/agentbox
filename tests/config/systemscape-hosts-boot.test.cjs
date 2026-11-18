'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const entry=fs.readFileSync(path.resolve(__dirname,'../../config/entrypoint-unified.sh'),'utf8');
const block=entry.match(/^_SS_HOSTS=.*?^unset _SS_HOSTS _SS_LINK$/ms)?.[0];
assert(block,'SystemScape boot projection block exists');
test('actual boot block links private hosts, is idempotent, and preserves operator files',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'systemscape-boot-'));
 const source=path.join(tmp,'mounted/local/hosts.toml'),target=path.join(tmp,'home/.config/systemscape/hosts.toml');
 const run=()=>{
  const code=block.replaceAll('/etc/agentbox/systemscape/local/hosts.toml',source)
   .replaceAll('/home/devuser/.config/systemscape/hosts.toml',target);
  const r=spawnSync('bash',['-eu','-c',code],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 };
 try{
  run();assert(!fs.existsSync(target),'no source creates no config');
  fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,'local = true\n');
  run();assert.equal(fs.readlinkSync(target),source);
  run();assert.equal(fs.readlinkSync(target),source,'idempotent');
  fs.unlinkSync(source);run();assert.throws(()=>fs.lstatSync(target),{code:'ENOENT'});
  fs.writeFileSync(target,'operator config\n');fs.writeFileSync(source,'local = false\n');
  run();assert(!fs.lstatSync(target).isSymbolicLink());assert.equal(fs.readFileSync(target,'utf8'),'operator config\n');
  fs.unlinkSync(target);fs.symlinkSync(path.join(tmp,'operator-missing.toml'),target);
  fs.unlinkSync(source);run();assert.equal(fs.readlinkSync(target),path.join(tmp,'operator-missing.toml'),'unrelated dangling symlink retained');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
