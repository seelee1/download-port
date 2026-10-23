import {el,call,toast} from './ui.js';
export function mountFolders(container,{refresh=async()=>{},scope=()=> 'current'}={}) {
 let roots=[],root,relative='',generation=0,busy=false,searchTimer,rootStamp='';
 const cache=new Map();
 const top=el('div','browser-tools'),rootSelect=el('select'),add=el('button','quiet','换根文件夹');rootSelect.setAttribute('aria-label','根文件夹');top.append(rootSelect,add);
 const crumbs=el('nav','breadcrumbs');crumbs.setAttribute('aria-label','当前浏览路径');
 const search=el('input');search.type='search';search.placeholder='搜索此根目录中的文件夹…';search.setAttribute('aria-label','搜索文件夹');
 const status=el('p','browse-status');status.setAttribute('role','status');
 const list=el('div','browser-list');list.setAttribute('aria-label','文件夹列表');
 const tools=el('div','browser-tools'),reload=el('button','quiet','刷新当前层'),create=el('button','quiet','新建文件夹');tools.append(reload,create);
 const confirm=el('button','confirm-folder','将下载保存到此文件夹');confirm.disabled=true;
 container.append(top,crumbs,search,status,list,tools,confirm);
 async function snapshot(){return (await call('snapshot')).config;}
 function explain(e){return /未知操作/.test(e.message)?'本地服务需要更新：从资源管理器运行 install.cmd，然后重新加载扩展。':e.message;}
 async function run(fn){if(busy)return;busy=true;add.disabled=true;try{await fn();}catch(e){status.textContent=explain(e);toast(explain(e));}finally{busy=false;add.disabled=false;}}
 function navigation(){crumbs.replaceChildren();if(!root)return;const base=el('button','quiet',root.name);base.onclick=()=>browse('');crumbs.append(base);let path='';for(const part of relative.split('/').filter(Boolean)){path=path?path+'/'+part:part;const dest=path;const button=el('button','quiet',part);button.onclick=()=>browse(dest);crumbs.append(el('span','','›'),button);}confirm.title=root.path+(relative?' / '+relative:'');}
 function row(path,searchResult=false){const line=el('button','browse-row');const name=path.split('/').pop();line.append(el('span','folder-symbol','▱'),el('span','row-name',name));if(searchResult){const detail=el('small','row-path',path);line.querySelector('.row-name').append(detail);}line.append(el('span','chevron','›'));line.title=path;line.onclick=()=>{search.value='';browse(path);};return line;}
 function paint(paths){list.replaceChildren(...paths.map(p=>row(p)));if(!paths.length)list.append(el('p','empty','这里没有子文件夹，可以直接保存到此处。'));}
 async function browse(path){
  clearTimeout(searchTimer);const token=++generation;relative=path;search.value='';navigation();confirm.disabled=true;if(!root)return;
  const selectedRoot=root, key=root.id+':'+path, cached=cache.get(key);let folders=[],offset=0,skipped=0;
  if(cached){paint(cached);status.textContent='正在检查更新…';}else{list.replaceChildren();status.textContent='正在读取文件夹…';}
  try{do{const result=await call('listFolders',{data:{rootId:selectedRoot.id,relative:path,offset}});if(token!==generation)return;folders.push(...result.folders);skipped+=result.skipped||0;offset=result.next;paint(folders);status.textContent=offset===null?'':`已读取 ${folders.length} 个文件夹…`;}while(offset!==null);
   cache.set(key,folders);if(cache.size>100)cache.delete(cache.keys().next().value);confirm.disabled=false;status.textContent=skipped?`已跳过 ${skipped} 个不支持的链接或目录。`:'';
  }catch(e){if(token!==generation)return;list.replaceChildren();status.textContent=explain(e);confirm.disabled=true;cache.delete(key);}
 }
 async function load(){const c=await snapshot();roots=c.roots||[];rootStamp=JSON.stringify(roots);rootSelect.replaceChildren();for(const r of roots){const o=el('option','',r.name);o.value=r.id;rootSelect.append(o);}root=roots.find(r=>r.id===root?.id)||roots[0];if(root)rootSelect.value=root.id;rootSelect.hidden=roots.length<2;add.textContent=root?'换根文件夹':'选择根文件夹';search.disabled=reload.disabled=create.disabled=!root;
  if(root)await browse('');else{++generation;confirm.disabled=true;crumbs.replaceChildren();list.replaceChildren(el('p','empty','先选择根文件夹，再进入想保存到的位置。'));}}
 rootSelect.onchange=()=>{root=roots.find(r=>r.id===rootSelect.value);browse('');};
 reload.onclick=()=>browse(relative);
 create.onclick=()=>run(async()=>{if(!root)return;const name=prompt('在当前文件夹中新建，例如：壁纸/WLOP');if(!name)return;await call('mkdir',{data:{rootId:root.id,relative:[relative,name].filter(Boolean).join('/')}});await browse(relative);});
 confirm.onclick=()=>run(async()=>{if(!root)return;confirm.disabled=true;const chosenGeneration=generation;try{const chosenRoot=root,chosenPath=relative;const resolved=await call('resolveFolder',{data:{rootId:chosenRoot.id,relative:chosenPath}});const c=await snapshot();let d=c.directories.find(d=>d.id===resolved.directoryId);if(!d){d={id:resolved.directoryId,name:chosenRoot.name+(chosenPath?' / '+chosenPath:''),kind:chosenRoot.mode==='browser'?'relative':'absolute',path:chosenRoot.mode==='browser'?chosenPath:resolved.path,rootId:chosenRoot.id,subpath:chosenPath,group:chosenRoot.name};c.directories=c.directories.filter(x=>!x.rootId||x.id===c.current||x.id===c.next||c.rules.some(r=>r.directoryId===x.id));c.directories.push(d);await call('saveConfig',{config:c});}await call('select',{id:d.id,scope:scope()});await refresh();toast('下载位置已更新');}finally{if(chosenGeneration===generation)confirm.disabled=false;}});
 async function find(query){
  const token=++generation;if(!root)return;const selectedRoot=root;confirm.disabled=true;list.replaceChildren();const queue=[{path:'',depth:0}];let examined=0,matches=0,incomplete=false,requests=0;
  status.textContent='正在搜索整个根目录…';
  try{while(queue.length&&examined<10000&&requests<500){const current=queue.shift();let offset=0;do{const result=await call('listFolders',{data:{rootId:selectedRoot.id,relative:current.path,offset}});requests++;if(token!==generation)return;incomplete ||= !!result.skipped;for(const path of result.folders){examined++;if(path.toLowerCase().includes(query)){list.append(row(path,true));matches++;}if(current.depth<31)queue.push({path,depth:current.depth+1});else incomplete=true;}offset=result.next;status.textContent=`搜索中：已检查 ${examined} 个文件夹，找到 ${matches} 个…`;if(examined>=10000||requests>=500){incomplete=true;break;}}while(offset!==null);}
   if(token!==generation)return;incomplete ||= queue.length>0;status.textContent=incomplete?`搜索尚不完整（权限或扫描上限），目前找到 ${matches} 个。可进入具体文件夹浏览。`:matches?`找到 ${matches} 个文件夹，点击进入后确认保存位置。`:'搜索完成，没有匹配的文件夹。';
  }catch(e){if(token===generation)status.textContent=`搜索未完成，目前找到 ${matches} 个。${explain(e)}`;}
 }
 search.oninput=()=>{clearTimeout(searchTimer);++generation;confirm.disabled=true;const q=search.value.trim().toLowerCase();if(!q){browse(relative);return;}status.textContent='准备搜索…';searchTimer=setTimeout(()=>find(q),300);};
  add.onclick=()=>run(async()=>{
    const dialog=el('dialog','');const form=el('form','');
    const name=el('input');name.placeholder='例如：下载目录、素材库';name.required=true;
    const mode=el('select');for(const [v,t] of [['browser','浏览器当前下载目录'],['custom','自定义目录']]){const o=el('option','',t);o.value=v;mode.append(o);}
    const path=el('input');path.placeholder='完整文件夹路径';path.required=true;
    const browse=el('button','secondary','浏览文件夹');browse.type='button';let rootId=crypto.randomUUID();
    const error=el('p','form-error');
    browse.onclick=async()=>{browse.disabled=true;try{const r=await call('directory',{data:{directoryId:rootId}});if(r){rootId=r.directoryId;path.value=r.path;if(!name.value)name.value=r.path.split(/[\\/]/).pop();}}catch(e){error.textContent=e.message;}finally{browse.disabled=false;}};
    function label(t,input){const l=el('label','',t);l.append(input);return l;}
    const submit=el('button','','使用这个文件夹');submit.type='submit';const cancel=el('button','secondary','取消');cancel.type='button';cancel.onclick=()=>dialog.close();
    form.append(el('h2','','选择根文件夹'),label('名称',name),label('文件夹类型',mode),el('p','muted','“浏览器当前下载目录”请选与 Edge 设置一致的位置；本工具不会修改浏览器设置。扫描需要已更新的本地服务。'),label('文件夹路径',path),browse,error,cancel,submit);dialog.append(form);document.body.append(dialog);
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{
      const r=await call('directory',{data:{directoryId:rootId,path:path.value}});
      await call('listFolders',{data:{rootId:r.directoryId,relative:''}});
      const c=await snapshot();c.roots=c.roots||[];
      if(c.roots.some(x=>x.path.toLowerCase()===r.path.toLowerCase()))throw Error('这个主目录已经接入，请直接展开或刷新');
      if(c.roots.length && !confirm('更换根文件夹？原来的磁盘文件不变，后续下载先恢复浏览器默认。'))return;c.roots=[{id:r.directoryId,name:name.value,path:r.path,mode:mode.value}];c.directories=[];c.rules=[];c.current=null;c.next=null;c.browserDefault=true;
      await call('saveConfig',{config:c});dialog.close();await load();status.textContent='';await refresh();
    }catch(e){error.textContent=e.message;}finally{submit.disabled=false;}};
    dialog.onclose=()=>dialog.remove();dialog.showModal();
  });

 load().catch(e=>{status.textContent=explain(e);});
 setInterval(async()=>{if(busy||document.querySelector('dialog[open]'))return;try{const c=await snapshot();if(JSON.stringify(c.roots||[])!==rootStamp)await load();}catch{}},5000);
}
