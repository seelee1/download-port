import { DEFAULTS, validateConfig, route, suggestedPath, basename } from './model.js';
const HOST = 'com.yule.download_port';
let serial = Promise.resolve(), syncPromise, port, ready, sequence = 0;
const requests = new Map();
let connectionError = '本地服务尚未连接';
const locked = fn => { const p = serial.then(fn); serial = p.catch(()=>{}); return p; };
async function config() { return (await chrome.storage.local.get('config')).config || structuredClone(DEFAULTS); }
async function profile() {
  return locked(async()=>{
    let {profileId} = await chrome.storage.local.get('profileId');
    if (!profileId) { profileId = crypto.randomUUID(); await chrome.storage.local.set({profileId}); }
    return profileId;
  });
}
function request(type, data={}, timeout=15000) {
  return new Promise((resolve,reject)=>{
    const id = ++sequence;
    const timer = setTimeout(()=>{requests.delete(id); reject(Error('本地服务响应超时；已提交任务会保留'));},timeout);
    requests.set(id,{resolve,reject,timer});
    try { port.postMessage({id,type,...data}); }
    catch(e) { clearTimeout(timer); requests.delete(id); reject(e); }
  });
}
async function connect() {
  if (ready) return ready;
  ready = (async()=>{
    const id = await profile();
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(message=>{
      const entry=requests.get(message.id); if (!entry) return;
      clearTimeout(entry.timer); requests.delete(message.id);
      message.ok ? entry.resolve(message.value) : entry.reject(Error(message.error));
    });
    port.onDisconnect.addListener(()=>{
      connectionError = chrome.runtime.lastError?.message || '本地连接已断开，任务会保留';
      ready = null; port = null;
      for (const r of requests.values()) { clearTimeout(r.timer); r.reject(Error(connectionError)); }
      requests.clear();
    });
    const result=await request('hello',{profile:id});
    if (result.protocol !== 1) throw Error('本地服务版本不兼容');
    connectionError=''; return result;
  })().catch(e=>{ready=null; connectionError=e.message; throw e;});
  return ready;
}
async function native(type,data={},timeout) { await connect(); return request(type,data,timeout); }
const taskKey = id => `task:${id}`;
async function tasks() { const all=await chrome.storage.local.get(null); return Object.entries(all).filter(([k])=>k.startsWith('task:')).map(([,v])=>v).sort((a,b)=>b.created-a.created); }
async function putTask(t) { const key=taskKey(t.downloadId);const previous=(await chrome.storage.local.get(key))[key];if(previous?.id===t.id && previous.status==='cancelled' && t.status!=='cancelled')return;await chrome.storage.local.set({[key]:t}); }
async function updateBadge(c) {
  const d=c.directories.find(d=>d.id===(c.next || c.current));
  await chrome.action.setBadgeText({text:!c.enabled?'停':c.next?'1':d?d.name.slice(0,2):''});
  await chrome.action.setBadgeBackgroundColor({color:'#18776e'});
  await chrome.action.setTitle({title:!c.enabled?'下载驿站 · 已暂停':d?`下载驿站 · ${d.name} · ${c.next?'仅下一次':'持续生效'}`:'下载驿站 · 自动规则 / 浏览器默认'});
}

chrome.downloads.onDeterminingFilename.addListener((item,suggest)=>{
  let done=false;
  const finish=value=>{if(!done){done=true;suggest(value);}};
  locked(async()=>{
    const c=await config();
    const selected=route(c,item);
    if (!selected) return finish();
    const jobId=crypto.randomUUID();
    const path=suggestedPath(selected,item,jobId);
    const t={id:jobId,downloadId:item.id,startTime:item.startTime,name:basename(item.filename),directory:{...selected.directory},reason:selected.reason,status:'downloading',created:Date.now(),error:null};
    // Persist intent before handing filename control back to the browser.
    await putTask(t);
    selected.directory.lastUsed=Date.now();
    if(selected.consumeNext)c.next=null;
    await chrome.storage.local.set({config:c});
    finish({filename:path,conflictAction:'uniquify'});
    await updateBadge(c);
  }).catch(()=>finish());
  return true;
});

async function sync() {
  if(syncPromise) return syncPromise;
  syncPromise=(async()=>{
    const list=await tasks();
    let jobs=null;
    if(list.some(t=>t.directory.kind==='absolute' && !['done','cancelled'].includes(t.status))) {
      try {jobs=await native('list');} catch {}
    }
    for(const t of list){
      if(['done','cancelled'].includes(t.status)) continue;
      try {
        if(t.nativeSubmitted){
          const job=jobs?.find(j=>j.id===t.id) || (jobs ? await native('get',{jobId:t.id}) : null);
          if(job){t.status=job.status;t.error=job.error;t.destination=job.destination;t.phase=job.phase;await putTask(t);}
          continue;
        }
        const [item]=await chrome.downloads.search({id:t.downloadId});
        if(!item || item.startTime!==t.startTime){t.status='missing';t.error='浏览器下载记录已删除，暂存文件不会自动删除';await putTask(t);continue;}
        t.source=item.filename;
        if(item.state==='interrupted'){t.status='interrupted';t.error=item.error || '下载已中断';await putTask(t);continue;}
        if(item.state!=='complete') continue;
        if(t.directory.kind==='relative') {t.status='done';t.destination=item.filename;t.error=null;await putTask(t);continue;}
        if(!['safe','accepted','deepScannedSafe','allowlistedByPolicy'].includes(item.danger)){t.status='blocked';t.error='请先在浏览器下载列表中确认文件安全状态';await putTask(t);continue;}
        const job=await native('enqueue',{jobId:t.id,source:item.filename,directoryId:t.directory.id});
        t.nativeSubmitted=true;t.status=job.status;t.error=job.error;t.destination=job.destination;
      }catch(e){t.status='waiting';t.error=e.message;}
      await putTask(t);
    }
    // Bound display history while retaining all unfinished jobs.
    const finished=list.filter(t=>['done','cancelled'].includes(t.status)).slice(500);
    if(finished.length) await chrome.storage.local.remove(finished.map(t=>taskKey(t.downloadId)));
  })().finally(()=>{syncPromise=null;});
  return syncPromise;
}
chrome.downloads.onChanged.addListener(()=>{sync().catch(()=>{});});
chrome.alarms.onAlarm.addListener(()=>{sync().catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{sync().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('recover',{periodInMinutes:1});config().then(updateBadge);});
chrome.alarms.create('recover',{periodInMinutes:1});

async function handle(message) {
  if(message.type==='snapshot') {
    await sync();
    const c=await config();
    return {config:c,tasks:await tasks(),connected:!!port && !connectionError,error:connectionError,extensionId:chrome.runtime.id};
  }
  if(message.type==='connection') {await connect();return native('check');}
  if(['scan','mkdir','resolveFolder','listFolders'].includes(message.type)) return native(message.type,message.data,120000);
  if(message.type==='directory') return native('directory',message.data,120000);
  if(message.type==='deleteDirectory') return locked(async()=>{
    const c=await config();
    c.directories=c.directories.filter(d=>d.id!==message.id);
    c.rules=c.rules.filter(r=>r.directoryId!==message.id);
    if(c.current===message.id)c.current=null;
    if(c.next===message.id)c.next=null;
    await chrome.storage.local.set({config:c});await updateBadge(c);return true;
  });
  if(message.type==='saveConfig') {
    const c=validateConfig(message.config);
    return locked(async()=>{await chrome.storage.local.set({config:c});await updateBadge(c);return c;});
  }
  if(message.type==='select') {
    const selected=(await config()).directories.find(d=>d.id===message.id);
    if(selected?.rootId) await native('resolveFolder',{rootId:selected.rootId,relative:selected.subpath});
    return locked(async()=>{
    const c=await config();
    if(message.id && !c.directories.some(d=>d.id===message.id)) throw Error('目录不存在');
    if(message.scope!=='next') c.browserDefault=message.scope==='browser';
    if(message.scope==='next') c.next=message.id; else {c.current=message.id;c.next=null;}
    const selected=c.directories.find(d=>d.id===message.id);if(selected)selected.lastUsed=Date.now();
    await chrome.storage.local.set({config:c});await updateBadge(c);return c;
  });
  }
  if(message.type==='retry' || message.type==='cancel' || message.type==='reveal') {
    await sync();
    const t=(await tasks()).find(t=>t.id===message.id);if(!t) throw Error('任务不存在');
    if(message.type==='reveal') {
      if(t.nativeSubmitted) return native('reveal',{jobId:t.id});
      return chrome.downloads.show(t.downloadId);
    }
    if(t.nativeSubmitted){
      const job=await native(message.type,{jobId:t.id});t.status=job.status;t.error=job.error;
    }else if(message.type==='cancel'){t.status='cancelled';t.error='已停止归档，浏览器下载和源文件均保留';}
    else {
      if(t.status==='interrupted') await chrome.downloads.resume(t.downloadId);
      t.status='downloading';t.error=null;
    }
    await putTask(t);return true;
  }
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  handle(message).then(value=>reply({ok:true,value}),e=>reply({ok:false,error:e.message}));return true;
});
