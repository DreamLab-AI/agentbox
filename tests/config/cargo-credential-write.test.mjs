import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const source=fs.readFileSync(new URL('../../config/entrypoint-unified.sh', import.meta.url),'utf8');
test('Cargo credential projection drops privilege and atomically replaces a planted symlink',()=>{
 const match=source.match(/run_as_devuser sh -c '([^']*credential_tmp[^']*)' <<CRATESEOF/);
 assert.ok(match,'credential writes must run as devuser, never the root bootstrap');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cargo-credential-test-'));
 try {
  const victim=path.join(dir,'victim'); const credential=path.join(dir,'credentials.toml');
  fs.writeFileSync(victim,'untouched');fs.symlinkSync(victim,credential);
  const script=match[1].replaceAll('/home/devuser/workspace/.cargo',dir);
  const result=spawnSync('sh',['-c',script],{input:'[registry]\ntoken = "synthetic-test-token"\n',encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(victim,'utf8'),'untouched');
  assert.equal(fs.lstatSync(credential).isSymbolicLink(),false);
  assert.equal(fs.statSync(credential).mode & 0o777,0o600);
  assert.equal(fs.readdirSync(dir).filter(x=>x.startsWith('.credentials.')).length,0);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
