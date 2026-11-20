const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const live=require('./fixtures/mcp-1.13-tool-arguments.json');
function validate(name,args){
 const tool=live.tools.find(t=>t.name===name);assert(tool);
 for(const key of tool.required)assert(key in args,`${name}: missing ${key}`);
 for(const[key,value]of Object.entries(args)){
  assert(key in tool.properties,`${name}: unknown ${key}`);
  const type=tool.properties[key].type;
  assert(type==='array'?Array.isArray(value):type==='integer'?Number.isInteger(value):typeof value===type,`${name}: ${key} type`);
 }
}
test('captured 1.13 schema rejects the old implicit-page and singular-upload calls',()=>{
 assert.throws(()=>validate('take_snapshot',{}),/pageId/);
 assert.throws(()=>validate('upload_file',{pageId:7,uid:'x',filePath:'/fixture'}),/filePaths/);
 validate('take_snapshot',{pageId:7});
 validate('take_screenshot',{pageId:7,filePath:'/fixture.png',fullPage:true});
 validate('upload_file',{pageId:7,uid:'x',filePaths:['/fixture.txt']});
});
for(const file of ['browsercontainer/README.md','skills/browser/SKILL.md','skills/browser/references/latex-diagram-workflows.md']){
 test(`documented calls match the captured page/file contract: ${file}`,()=>{
  const source=fs.readFileSync(file,'utf8');let count=0;
  for(const[,name,args]of source.matchAll(/\b(navigate_page|take_snapshot|take_screenshot|upload_file)\(([^)]*)\)/g)){
   count++;assert.match(args,/\bpageId\b/,`${file}: ${name} needs an explicit page ID`);
   if(name==='upload_file'){assert.match(args,/\bfilePaths\s*:\s*\[/);assert.doesNotMatch(args,/\bfilePath\s*:/);}
  }
  assert(count>0);
 });
}
