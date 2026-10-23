import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,validateConfig,relativePath,route,suggestedPath} from '../extension/model.js';
const dirs=[{id:'one',name:'图片',kind:'relative',path:'素材/图片'},{id:'two',name:'项目',kind:'absolute',path:'D:\\项目'}];
function conf(extra={}){return validateConfig({...DEFAULTS,directories:dirs,...extra});}

test('old configurations remain compatible and browser default bypasses rules',()=>{
 const c=conf({browserDefault:true,current:'one',rules:[{type:'extension',value:'zip',directoryId:'two'}]});
 assert.deepEqual(c.roots,[]);assert.equal(route(c,{filename:'a.zip'}),null);
 c.next='one';assert.equal(route(c,{filename:'a.zip'}).directory.id,'one');
});
test('managed browser root and child produce relative browser filenames',()=>{
 const root={id:'root',name:'下载',mode:'browser',path:'C:\\Downloads'};
 const c=validateConfig({...DEFAULTS,roots:[root],directories:[{id:'dir',rootId:'root',kind:'relative',path:'',name:'下载'}],current:'dir'});
 assert.equal(suggestedPath(route(c,{filename:'a.txt'}),{filename:'a.txt'},'job'),'a.txt');
 c.directories[0].path='壁纸/WLOP';assert.equal(suggestedPath(route(c,{}),{filename:'a.txt'},'job'),'壁纸/WLOP/a.txt');
 assert.throws(()=>validateConfig({...c,roots:[]}));
});
test('one-shot takes precedence and explicit current overrides rules',()=>{
 const c=conf({current:'one',next:'two'});assert.equal(route(c,{filename:'a.zip'}).directory.id,'two');assert.equal(route(c,{filename:'a.zip'}).consumeNext,true);
 c.next=null;assert.equal(route(c,{filename:'a.zip'}).directory.id,'one');
});
test('domain rules use label boundaries, referrer and order',()=>{
 const c=conf({rules:[{id:'r',type:'domain',value:'example.com',directoryId:'one',enabled:true},{id:'r2',type:'extension',value:'zip',directoryId:'two',enabled:true}]});
 assert.equal(route(c,{referrer:'https://sub.example.com/page',filename:'x.zip'}).directory.id,'one');
 assert.equal(route(c,{url:'https://notexample.com/x',filename:'x.zip'}).directory.id,'two');
 assert.equal(route(c,{url:'https://notexample.com/x',filename:'README'}),null);
});
test('disabled, incognito and extension downloads are excluded',()=>{
 assert.equal(route(conf({current:'one',enabled:false}),{}),null);
 assert.equal(route(conf({current:'one'}),{incognito:true}),null);
 assert.equal(route(conf({current:'one'}),{byExtensionId:'other'}),null);
});
test('relative destinations reject escaping and invalid Windows names',()=>{
 for(const p of ['../x','C:\\x','/tmp','a/../b','a/.hidden','NUL','a/CON.txt','a?b','a//b','a.'])assert.throws(()=>relativePath(p));
 assert.equal(relativePath('中文\\图片'),'中文/图片');
});
test('absolute files use unique staging directory and preserve extensionless name',()=>{
 const result=suggestedPath({directory:dirs[1]},{filename:'C:\\Downloads\\README'},'uuid');assert.equal(result,'DownloadPort/incoming/uuid/README');
});
test('import validates references and clears deleted selections',()=>{
 assert.throws(()=>conf({rules:[{type:'domain',value:'a.com',directoryId:'missing'}]}));
 assert.equal(conf({current:'missing'}).current,null);
 assert.throws(()=>validateConfig({...DEFAULTS,directories:[dirs[0],dirs[0]]}));
});

test('tree-only mode retains old config but never applies hidden legacy rules',()=>{
 const c=conf({treeOnly:true,rules:[{type:'extension',value:'zip',directoryId:'one'}]});
 assert.equal(c.treeOnly,true);assert.equal(route(c,{filename:'sample.zip'}),null);
 c.current='two';assert.equal(route(c,{filename:'sample.zip'}).directory.id,'two');
});
