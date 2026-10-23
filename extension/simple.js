import {$,el,call,toast,action,taskNode} from './ui.js';
import {mountFolders} from './folders.js';
async function refresh(){
 const s=await call('snapshot'),c=s.config,d=c.directories.find(d=>d.id===(c.next||c.current));
 $('current').textContent=!c.enabled?'浏览器默认':d?d.name:'浏览器默认';
 $('current').title=d?.path||'浏览器设置中的下载位置';
 $('currentPath').textContent=d?(c.next?'仅下一次下载':'后续下载使用此文件夹'):'不更改浏览器的下载设置';
 $('connection').hidden=s.connected;
 $('connection').textContent=s.connected?'':'文件夹扫描需要本地连接。可在“更多”中检查连接。';
 if(!$('extras').hidden)$('recent').replaceChildren(...s.tasks.slice(0,10).map(t=>taskNode(t,refresh)));
}
async function start(){
 const s=await call('snapshot');
 if(!s.config.treeOnly){s.config.treeOnly=true;s.config.enabled=true;await call('saveConfig',{config:s.config});}
 mountFolders($('folderManager'),{refresh,scope:()=>$('scope').value});await refresh();
}
action($('browserDefault'),async()=>{await call('select',{id:null,scope:'browser'});await refresh();});
action($('more'),async()=>{
 const open=$('extras').hidden;
 $('extras').hidden=!open;
 document.querySelector('.destination').hidden=open;
 $('folderManager').hidden=open;
 document.querySelector('footer').hidden=open;
 $('more').textContent=open?'返回':'更多';
 $('more').setAttribute('aria-expanded',String(open));
 window.scrollTo(0,0);
 if(open)$('recent').textContent='正在读取下载记录…';
 await refresh();
});
action($('manage'),()=>chrome.runtime.openOptionsPage());
action($('connect'),async()=>{try{await call('connection');$('diagnostics').textContent='连接成功';}catch(e){$('diagnostics').textContent=e.message+'。请从资源管理器运行 install.cmd，然后重新加载扩展。';}await refresh();});
action($('export'),async()=>{const s=await call('snapshot');const url=URL.createObjectURL(new Blob([JSON.stringify(s.config,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='download-port-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
action($('import'),()=>$('importFile').click());
$('importFile').onchange=async()=>{try{
 const file=$('importFile').files[0];if(!file)return;if(file.size>1024*1024)throw Error('文件过大');
 const {validateConfig}=await import('./model.js');const c=validateConfig(JSON.parse(await file.text()));
 if(!confirm('恢复此备份中的根文件夹设置？当前设置将被替换，磁盘文件不变。'))return;
 for(const root of c.roots||[]){const old=root.id;const r=await call('directory',{data:{directoryId:old,path:root.path}});root.id=r.directoryId;root.path=r.path;for(const d of c.directories)if(d.rootId===old)d.rootId=root.id;}
 for(const d of c.directories.filter(d=>d.kind==='absolute')){const old=d.id;const r=await call('directory',{data:{directoryId:old,path:d.path}});d.id=r.directoryId;d.path=r.path;if(c.current===old)c.current=d.id;if(c.next===old)c.next=d.id;for(const rule of c.rules)if(rule.directoryId===old)rule.directoryId=d.id;}
 c.treeOnly=true;c.enabled=true;await call('saveConfig',{config:c});location.reload();
 }catch(e){toast(e.message);}finally{$('importFile').value='';}};
start().catch(e=>toast(e.message));setInterval(()=>refresh().catch(()=>{}),3000);
