"""Only temporary native-host keys for browser integration tests; never production keys."""
import re
import sys
from pathlib import Path

def main():
    import winreg
    action,name,manifest=sys.argv[1:]
    if not re.fullmatch(r'com\.yule\.download_port_test_[a-f0-9]{16}',name):raise ValueError('Not an isolated test host')
    p=Path(manifest).resolve()
    allowed=(Path(__file__).resolve().parents[1]/'.test-data').resolve()
    if not p.is_relative_to(allowed):raise ValueError('Manifest outside test directory')
    for product in ['Microsoft\\Edge','Google\\Chrome','Google\\Chrome for Testing','Chromium']:
        key='Software\\'+product+'\\NativeMessagingHosts\\'+name
        if action=='add':
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key):raise ValueError('Test registry key already exists')
            except FileNotFoundError:pass
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER,key) as handle:winreg.SetValueEx(handle,'',0,winreg.REG_SZ,str(p))
        elif action=='remove':
            try:winreg.DeleteKey(winreg.HKEY_CURRENT_USER,key)
            except FileNotFoundError:pass
        else:raise ValueError('Unknown action')

if __name__=='__main__':main()
