export const $ = id => document.getElementById(id);
export const el = (tag, className, text) => { const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n; };
export async function call(type,data={}) {
  const r=await chrome.runtime.sendMessage({type,...data});
  if(!r?.ok) throw Error(r?.error || '扩展连接不可用，请重新打开页面');return r.value;
}
let toastTimer;
export function toast(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('notice').hidden=true,6000);}
export function action(button,fn){button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{button.disabled=false;}});}
export function connection(snapshot){const n=$('connection');n.textContent=snapshot.connected?'本地服务已连接':'本地服务未连接';n.classList.toggle('off',!snapshot.connected);n.title=snapshot.error||'';}
export const STATUS={downloading:'下载中',queued:'等待归档',archiving:'正在归档',waiting:'等待重试',failed:'需要处理',done:'已完成',cancelled:'已停止归档',interrupted:'下载中断',missing:'记录缺失',blocked:'待浏览器确认'};
export function taskNode(t,refresh,compact=false){
  const row=el('article','task'),body=el('div','task-main');
  body.append(el('span','task-name',t.name),el('div','task-detail',t.destination || t.directory.path));
  if(!compact){body.append(el('div','task-detail',`${new Date(t.created).toLocaleString('zh-CN')} · ${t.reason}`));if(t.error)body.append(el('div','task-detail',t.error));}
  const buttons=el('div','task-actions');
  const add=(label,type)=>{const b=el('button','secondary',label);action(b,async()=>{await call(type,{id:t.id});await refresh();});buttons.append(b);};
  if(t.status==='done'||t.source)add('打开文件夹','reveal');
  if(!compact && ['waiting','failed','interrupted','blocked'].includes(t.status))add('重试','retry');
  if(!compact && !['done','cancelled'].includes(t.status))add('停止归档','cancel');
  body.append(buttons);row.append(body,el('span','task-status'+(['waiting','failed','missing','blocked','interrupted'].includes(t.status)?' problem':''),STATUS[t.status]||t.status));return row;
}
