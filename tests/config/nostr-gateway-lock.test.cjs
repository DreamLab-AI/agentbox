'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../../config/nostr-gateway/gateway.cjs');
const source=fs.readFileSync(file,'utf8');
const start=source.indexOf('function alive(pid) {');
const end=source.indexOf('\nfunction acquire()',start);
assert(start>=0&&end>start,'gateway lock helper must remain testable');
function alive(pid,{leader=pid,command='/opt/agentbox/config/nostr-gateway/gateway.cjs',signal=true,proc=true}={}){
 const context={path,__filename:file,process:{pid:100,kill(){if(!signal)throw Error('gone');}},fs:{
  readFileSync(p){if(!proc)throw Error('no proc');return p.endsWith('/status')?`Tgid:\t${leader}\n`:command+'\0';},
  existsSync(){return proc;},
 }};
 return vm.runInNewContext(source.slice(start,end)+';alive('+pid+')',context);
}
test('our own reused pid is stale',()=>assert.equal(alive(100),false));
test('a dead process is stale',()=>assert.equal(alive(200,{signal:false}),false));
test('another process is not a gateway',()=>assert.equal(alive(200,{command:'/usr/bin/python'}),false));
test('a gateway thread is not its process leader',()=>assert.equal(alive(200,{leader:199}),false));
test('a live gateway process retains its lock',()=>assert.equal(alive(200),true));
test('without procfs the signal check remains the fallback',()=>assert.equal(alive(200,{proc:false}),true));
test('System One build context copies sources, never the workspace target',()=>{
 const docker=fs.readFileSync(path.resolve(__dirname,'../../services/laya-engine/Dockerfile'),'utf8');
 assert(!/^COPY --from=crates \. /m.test(docker));
 for(const member of ['core','client','facade','eval','proxy'])assert(docker.includes(`COPY --from=crates system-one-${member} `));
 assert(docker.includes('cargo build --locked --release'));
});
