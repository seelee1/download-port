import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS} from '../extension/model.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const data={};const records=new Map();
globalThis.chrome={
 storage:{local:{async get(key){if(key===null)return structuredClone(data);if(typeof key==='string')return {[key]:structuredClone(data[key])};return Object.fromEntries(key.map(k=>[k,structuredClone(data[k])]))},async set(values){Object.assign(data,structuredClone(values))},async remove(keys){for(const k of keys)delete data[k]}}},
 action:{async setBadgeText(){},async setBadgeBackgroundColor(){},async setTitle(){}},
 downloads:{onDeterminingFilename:event(),onChanged:event(),async search({id}){return records.has(id)?[records.get(id)]:[]},async show(){},async resume(){}},
 alarms:{onAlarm:event(),create(){}},
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onStartup:event(),onInstalled:event(),onMessage:event(),connectNative(){throw Error('test helper offline')}}
};
await import('../extension/background.js');
const message=(type,extra={})=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0]({type,...extra},{id:'test',url:'chrome-extension://test/options.html'},resolve));
const item=id=>({id,startTime:'2026-10-23T10:00:00.000Z',filename:'sample.txt',url:'http://localhost/file',danger:'safe',state:'in_progress'});
function determine(i){records.set(i.id,i);return new Promise(resolve=>chrome.downloads.onDeterminingFilename.listeners[0](i,resolve));}
test('concurrent downloads consume one-shot once; preserve target snapshot',async()=>{
 data.config={...structuredClone(DEFAULTS),directories:[{id:'a',name:'A',kind:'relative',path:'A'},{id:'b',name:'B',kind:'relative',path:'B'}],current:'a',next:'b'};
 const [a,b]=await Promise.all([determine(item(1)),determine(item(2))]);
 assert.equal(a.filename,'B/sample.txt');assert.equal(b.filename,'A/sample.txt');assert.equal(data.config.next,null);
 data.config.directories[0].path='CHANGED';assert.equal(data['task:2'].directory.path,'A');
});
test('relative completion recorded and missing record does not erase intent',async()=>{
 records.get(1).state='complete';records.get(1).filename='C:\\Downloads\\B\\sample.txt';records.delete(2);
 const reply=await message('snapshot');assert.equal(reply.ok,true);assert.equal(data['task:1'].status,'done');assert.equal(data['task:2'].status,'missing');
});
test('native outage retains completed browser download for later retry',async()=>{
 data.config={...structuredClone(DEFAULTS),directories:[{id:'a',name:'Native',kind:'absolute',path:'D:\\Target'}],current:'a'};
 const i=item(3);const choice=await determine(i);assert.match(choice.filename,/DownloadPort\/\incoming\//);
 records.set(3,{...i,state:'complete',filename:'C:\\Downloads\\'+choice.filename.replaceAll('/','\\')});
 const reply=await message('snapshot');assert.equal(reply.ok,true);assert.equal(data['task:3'].status,'waiting');assert.match(data['task:3'].error,/offline/);
 const cancel=await message('cancel',{id:data['task:3'].id});assert.equal(cancel.ok,true);await message('snapshot');assert.equal(data['task:3'].status,'cancelled');
});
test('untrusted sender cannot invoke native operations',()=>{
 let replied=false;chrome.runtime.onMessage.listeners[0]({type:'directory'},{id:'other',url:'https://example.com'},()=>{replied=true;});assert.equal(replied,false);
});

test('delete uses latest config, removes related rules and selections, preserves tasks',async()=>{
 const previous=structuredClone(data['task:1']);
 data.config={...structuredClone(DEFAULTS),directories:[{id:'a',kind:'relative',path:'A'},{id:'b',kind:'relative',path:'B'}],rules:[{id:'ra',directoryId:'a'},{id:'rb',directoryId:'b'}],current:'a',next:'a'};
 const result=await message('deleteDirectory',{id:'a'});
 assert.equal(result.ok,true);assert.deepEqual(data.config.directories.map(d=>d.id),['b']);assert.deepEqual(data.config.rules.map(r=>r.id),['rb']);
 assert.equal(data.config.current,null);assert.equal(data.config.next,null);assert.deepEqual(data['task:1'],previous);
 assert.equal((await message('deleteDirectory',{id:'a'})).ok,true);
});
