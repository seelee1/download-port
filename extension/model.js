export const DEFAULTS = {version: 1, browserDefault: false, enabled: true, current: null, next: null, directories: [], rules: [], roots: []};
export const basename = value => String(value || '').split(/[\\/]/).pop() || 'download';
export function relativePath(value) {
  const p = String(value || '').trim().replaceAll('\\', '/');
  if (!p || p.length > 180 || /^[/.]/.test(p) || /[:<>"|?*\x00-\x1f]/.test(p) || p.split('/').some(s => !s || s.startsWith('.') || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s))) throw Error('请填写下载文件夹内的有效子目录，例如 素材/图片');
  return p;
}
export function validateConfig(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.directories) || !Array.isArray(input.rules)) throw Error('配置格式不正确');
  if (input.directories.length > 200 || input.rules.length > 500) throw Error('目录或规则数量过多');
  const roots = (input.roots || []).map(r=>{
    if(!r || !/^[a-zA-Z0-9-]{1,80}$/.test(r.id) || !['browser','custom'].includes(r.mode) || !/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(r.path || '')) throw Error('主目录配置无效');
    return {id:r.id,name:String(r.name || '主目录').slice(0,80),path:r.path,mode:r.mode};
  });
  if(roots.length>30 || new Set(roots.map(r=>r.id)).size!==roots.length) throw Error('主目录数量过多或重复');
  const ids = new Set();
  const directories = input.directories.map(d => {
    if (!d || !/^[a-zA-Z0-9-]{1,80}$/.test(d.id) || ids.has(d.id)) throw Error('目录标识重复或无效');
    ids.add(d.id);
    if (!['relative', 'absolute'].includes(d.kind)) throw Error('目录类型无效');
    const path = d.kind === 'relative' ? (d.rootId && d.path === '' ? '' : relativePath(d.path)) : String(d.path || '').trim();
    if (d.kind === 'absolute' && !/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path)) throw Error('请选择 Windows 文件夹完整路径');
    if(d.rootId && !roots.some(r=>r.id===d.rootId)) throw Error('分类所属主目录不存在');
    return {rootId:d.rootId || null, subpath:d.subpath || '', id:d.id, name:String(d.name || '').trim().slice(0,80) || basename(path), path, kind:d.kind, group:String(d.group || '').slice(0,60), favorite:!!d.favorite,lastUsed:Number.isFinite(d.lastUsed)?d.lastUsed:0};
  });
  const rules = input.rules.map(r => {
    if (!['domain','extension'].includes(r.type) || !ids.has(r.directoryId)) throw Error('规则目录或类型无效');
    const value = String(r.value || '').trim().toLowerCase().replace(/^\./,'');
    if (!value || value.length > 200 || (r.type === 'domain' && !/^[a-z0-9.-]+$/.test(value)) || (r.type === 'extension' && !/^[a-z0-9]+$/.test(value))) throw Error('规则值无效，请输入域名或扩展名');
    return {id:String(r.id || crypto.randomUUID()),type:r.type,value,directoryId:r.directoryId,enabled:r.enabled !== false};
  });
  return {version:1,treeOnly:!!input.treeOnly,browserDefault:!!input.browserDefault,enabled:input.enabled !== false,current:ids.has(input.current)?input.current:null,next:ids.has(input.next)?input.next:null,directories,rules,roots};
}
export function route(config, item) {
  if (!config.enabled || item.incognito || item.byExtensionId) return null;
  const get = id => config.directories.find(d => d.id === id);
  if (get(config.next)) return {directory:get(config.next),reason:'仅下一次',consumeNext:true};
  if (config.browserDefault) return null;
  if (get(config.current)) return {directory:get(config.current),reason:'当前指定目录'};
  if(config.treeOnly) return null;
  let host = '';
  try { host = new URL(item.referrer || item.finalUrl || item.url).hostname.toLowerCase(); } catch {}
  const ext = basename(item.filename).split('.').slice(1).pop()?.toLowerCase() || '';
  for (const r of config.rules) {
    if (!r.enabled || !get(r.directoryId)) continue;
    if ((r.type === 'domain' && (host === r.value || host.endsWith('.'+r.value))) || (r.type === 'extension' && ext === r.value)) return {directory:get(r.directoryId),reason:`规则：${r.type === 'domain'?'网站':'类型'} ${r.value}`};
  }
  return null;
}
export function suggestedPath(selection, item, id) {
  let name = basename(item.filename).replace(/[<>:"|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'') || 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = '_'+name;
  if(name.startsWith('.')) name='_'+name;
  return selection.directory.kind === 'absolute' ? `DownloadPort/incoming/${id}/${name}` : (selection.directory.rootId && selection.directory.path === '' ? name : `${relativePath(selection.directory.path)}/${name}`);
}
