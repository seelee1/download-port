const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const http = require('node:http');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
const id=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).split('').map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
(async()=>{
  if(process.platform!=='win32')throw Error('Browser integration requires Windows');
  if(!process.env.CHROME_EXE)throw Error('Set CHROME_EXE to the browser executable path');
  const testDir=path.join(root,'.test-data');fs.mkdirSync(testDir,{recursive:true});
  const profile=fs.mkdtempSync(path.join(testDir,'browser-'));
  const downloads=path.join(profile,'downloads');fs.mkdirSync(downloads,{recursive:true});
  fs.mkdirSync(path.join(profile,'Default'),{recursive:true});
  fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false,directory_upgrade:true}}));
  let testHost,hostManifest,extensionPath=extension;
  {
    testHost='com.yule.download_port_test_'+crypto.randomBytes(8).toString('hex');
    extensionPath=path.join(profile,'extension');fs.cpSync(extension,extensionPath,{recursive:true});
    const bg=path.join(extensionPath,'background.js');fs.writeFileSync(bg,fs.readFileSync(bg,'utf8').replace('com.yule.download_port',testHost));
    const app=path.join(profile,'host');fs.mkdirSync(app);for(const name of ['host.py','core.py','folders.py'])fs.copyFileSync(path.join(root,'native',name),path.join(app,name));
    fs.writeFileSync(path.join(app,'host-config.json'),JSON.stringify({allowed_origins:[`chrome-extension://${id}/`],data_root:path.join(profile,'native-state')}));
    const python=execFileSync('python',['-c','import sys; print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
    fs.writeFileSync(path.join(app,'launch.cmd'),`@echo off\r\n"${python}" -u "${path.join(app,'host.py')}" %*\r\n`);
    hostManifest=path.join(app,'manifest.json');fs.writeFileSync(hostManifest,JSON.stringify({name:testHost,description:'Isolated Download Port integration test',path:path.join(app,'launch.cmd'),type:'stdio',allowed_origins:[`chrome-extension://${id}/`]}));
    execFileSync('python',[path.join(__dirname,'test_registration.py'),'add',testHost,hostManifest],{windowsHide:true});
  }
  let context;
  try {
    context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROME_EXE,headless:true,viewport:{width:1365,height:900},args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,'--disable-features=DisableLoadExtensionCommandLineSwitch']});
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
    assert.equal(new URL(worker.url()).hostname,id);


    const target=path.join(profile,'library');fs.mkdirSync(path.join(target,'图片','照片'),{recursive:true});
    for(const name of ['文档','音乐','视频','压缩包','安装包'])fs.mkdirSync(path.join(target,name));
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.getByRole('button',{name:'选择根文件夹',exact:true}).click();
    await page.getByLabel('名称',{exact:true}).fill('下载目录');await page.getByLabel('文件夹类型').selectOption('custom');await page.getByLabel('文件夹路径').fill(target);
    await page.getByRole('button',{name:'使用这个文件夹',exact:true}).click();
    await page.locator('.browse-row').filter({hasText:'图片'}).waitFor();
    assert.equal(await page.locator('.browse-row').filter({hasText:'照片'}).count(),0);
    await page.locator('.browse-row').filter({hasText:'图片'}).click();
    await page.locator('.browse-row').filter({hasText:'照片'}).click();
    await page.getByText('这里没有子文件夹，可以直接保存到此处。',{exact:true}).waitFor();
    assert.equal(await page.locator('#current').innerText(),'浏览器默认');
    await page.getByRole('button',{name:'将下载保存到此文件夹',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('current').textContent.includes('照片'));
    await page.locator('.breadcrumbs').getByRole('button',{name:'下载目录',exact:true}).click();
    await page.locator('.browse-row').filter({hasText:'文档'}).waitFor();
    const pop=await context.newPage();await pop.setViewportSize({width:420,height:600});await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.locator('.browse-row').filter({hasText:'图片'}).waitFor();
    const buttonBounds=await pop.locator('.confirm-folder').boundingBox();assert.ok(buttonBounds.y+buttonBounds.height<=600,'confirmation must stay in viewport');
    const rowBounds=await pop.locator('.browse-row').first().boundingBox();assert.ok(rowBounds.height>=48);
    await pop.getByRole('searchbox',{name:'搜索文件夹',exact:true}).fill('照片');
    await pop.locator('.browse-row').filter({hasText:'照片'}).waitFor();
    await pop.getByText(/找到 1 个文件夹/).waitFor();
    await pop.locator('.browse-row').filter({hasText:'照片'}).click();
    await pop.getByText('这里没有子文件夹，可以直接保存到此处。',{exact:true}).waitFor();
    await pop.locator('#scope').selectOption('next');await pop.locator('.confirm-folder').click();
    await pop.waitForFunction(()=>document.getElementById('currentPath').textContent.includes('仅下一次'));
    await pop.locator('.breadcrumbs').getByRole('button',{name:'下载目录',exact:true}).click();
    await pop.locator('.browse-row').filter({hasText:'图片'}).waitFor();
    await pop.screenshot({path:path.join(profile,'popup-browser.png'),fullPage:true});
    const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
    const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="browser.txt"'});res.end('folder browser download');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{const site=await context.newPage();await site.goto(`http://127.0.0.1:${server.address().port}/`).catch(()=>{});for(let i=0;i<150;i++){await page.evaluate(()=>chrome.runtime.sendMessage({type:'snapshot'}));if(fs.existsSync(path.join(target,'图片','照片','browser.txt')))break;await new Promise(r=>setTimeout(r,100));}assert.equal(fs.readFileSync(path.join(target,'图片','照片','browser.txt'),'utf8'),'folder browser download');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
    for(const surface of [page,pop]){await surface.locator('#more').click();await surface.locator('#connect').waitFor();await surface.getByRole('button',{name:'返回',exact:true}).click();}
    assert.deepEqual(errors,[]);console.log('PASS: shallow browse, explicit confirmation, breadcrumbs, progressive search, 48px rows, fixed footer, one-shot real download, more/back');
  } finally {if(context)await context.close();if(testHost)execFileSync('python',[path.join(__dirname,'test_registration.py'),'remove',testHost,hostManifest],{windowsHide:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
