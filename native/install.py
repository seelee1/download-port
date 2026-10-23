"""Per-user host registration. Run explicitly; does not install browser extension."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

NAME = 'com.yule.download_port'

def main():
    if os.name != 'nt': raise RuntimeError('此安装包适用于 Windows')
    import winreg
    root = Path(os.environ['LOCALAPPDATA'])/'DownloadPort'
    app = root/'app'
    branches = ['Software\\Google\\Chrome\\NativeMessagingHosts\\'+NAME,
                'Software\\Microsoft\\Edge\\NativeMessagingHosts\\'+NAME]
    if '--uninstall' in sys.argv:
        for branch in branches:
            try: winreg.DeleteKey(winreg.HKEY_CURRENT_USER,branch)
            except FileNotFoundError: pass
        print('已取消 Chrome 和 Edge 的本地连接注册。历史、待处理任务与文件均保留在 '+str(root))
        return
    if sys.version_info < (3,10): raise RuntimeError('需要 Python 3.10 或更新版本')
    source = Path(__file__).resolve().parent
    manifest = json.loads((source.parent/'extension'/'manifest.json').read_text('utf-8'))
    raw = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    extension_id = ''.join(chr(ord('a')+int(c,16)) for c in raw)
    origin = f'chrome-extension://{extension_id}/'
    app.mkdir(parents=True,exist_ok=True)
    for name in ['host.py','core.py','folders.py']:
        shutil.copy2(source/name,app/name)
    config = {'allowed_origins':[origin],'data_root':str(root/'data')}
    (app/'host-config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),'utf-8')
    # Chrome's Windows native host launcher supports cmd files. Keep paths quoted.
    if any(c in str(app)+sys.executable for c in '%\r\n"'):
        raise RuntimeError('安装路径包含不支持的字符')
    launcher = app/'launch.cmd'
    launcher.write_text(f'@echo off\r\n"{sys.executable}" -u "{app / "host.py"}" %*\r\n',encoding='utf-8')
    native_manifest = {'name':NAME,'description':'Download Port local archive service','path':str(launcher),'type':'stdio','allowed_origins':[origin]}
    location = app/(NAME+'.json')
    location.write_text(json.dumps(native_manifest,ensure_ascii=False,indent=2),'utf-8')
    for branch in branches:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,branch) as key:
            winreg.SetValueEx(key,'',0,winreg.REG_SZ,str(location))
    print('本地服务已注册。扩展 ID：'+extension_id)
    print('请在 Chrome 或 Edge 扩展页面启用开发者模式，加载 extension 文件夹。')
    print('安装位置：'+str(app))

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('安装失败：'+str(e),file=sys.stderr); sys.exit(1)
