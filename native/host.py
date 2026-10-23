"""Chrome/Edge native messaging host. No network, no shell command execution."""
import json
import os
from pathlib import Path
import struct
import sys
import threading
import time
import uuid
from core import Store
from folders import inventory, safe_child, create_folder, list_folders

MAX_MESSAGE = 1024*1024

def read_exact(stream, count):
    data = bytearray()
    while len(data) < count:
        block = stream.read(count-len(data))
        if not block:
            if not data: return None
            raise EOFError('Truncated native message')
        data.extend(block)
    return bytes(data)

def read_message(stream):
    header = read_exact(stream,4)
    if header is None: return None
    size = struct.unpack('<I',header)[0]
    if size > MAX_MESSAGE or size == 0: raise ValueError('Invalid message length')
    payload = read_exact(stream,size)
    if payload is None: raise EOFError('Missing message body')
    return json.loads(payload.decode('utf-8'))

def write_message(stream, message):
    data = json.dumps(message,ensure_ascii=False).encode('utf-8')
    if len(data) > MAX_MESSAGE: raise ValueError('Response too large')
    stream.write(struct.pack('<I',len(data))+data); stream.flush()

class Host:
    def __init__(self, root, origin):
        self.store = Store(root)
        self.origin = origin
        self.client = None
        self.stopping = threading.Event()
        self.worker = None

    def loop(self):
        while not self.stopping.is_set():
            try:
                if not self.store.run_one(self.client): self.stopping.wait(1)
            except Exception as e:
                print('Queue temporarily unavailable: '+str(e),file=sys.stderr)
                self.stopping.wait(5)

    def handle(self, request):
        kind = request.get('type')
        if kind == 'hello':
            profile = str(uuid.UUID(request['profile']))
            client = self.origin + ':' + profile
            if self.client and self.client != client: raise ValueError('连接已绑定其他配置')
            self.client = client
            if not self.worker:
                self.worker = threading.Thread(target=self.loop,daemon=False)
                self.worker.start()
            return {'version':'1.0.0','platform':sys.platform,'protocol':1}
        if not self.client: raise ValueError('请先建立连接')
        if kind == 'list': return self.store.list(self.client)
        if kind == 'get': return self.store.get(self.client,request['jobId'])
        if kind == 'enqueue':
            return self.store.enqueue(self.client,request['jobId'],request['source'],request['directoryId'])
        if kind in ('retry','cancel'):
            return self.store.control(self.client,request['jobId'],kind)
        if kind == 'directory':
            key = str(uuid.UUID(request['directoryId']))
            value = request.get('path')
            if not value:
                import tkinter as tk
                from tkinter import filedialog
                ui = tk.Tk(); ui.withdraw(); ui.attributes('-topmost',True)
                try: value = filedialog.askdirectory(title='选择下载归档文件夹',mustexist=True,parent=ui)
                finally: ui.destroy()
                if not value: return None
            canonical = str(Path(value).resolve())
            with self.store.connect() as db:
                old = db.execute('SELECT path FROM directories WHERE client=? AND id=?',(self.client,key)).fetchone()
            # Existing download intents keep their original destination registration.
            if old and old[0].casefold() != canonical.casefold(): key = str(uuid.uuid4())
            return {'path':self.store.directory(self.client,key,value),'directoryId':key}
        if kind in ('scan', 'mkdir', 'resolveFolder', 'listFolders'):
            with self.store.connect() as db:
                row = db.execute('SELECT path FROM directories WHERE client=? AND id=?', (self.client, request['rootId'])).fetchone()
            if not row: raise ValueError('主目录未注册，请重新选择')
            if kind == 'listFolders': return list_folders(row[0], request.get('relative',''), request.get('offset',0))
            if kind == 'scan': return inventory(row[0])
            relative = request.get('relative', '')
            if kind == 'mkdir': return create_folder(row[0], relative)
            target = safe_child(row[0], relative)
            if not target.is_dir(): raise ValueError('子目录已移动或删除，请刷新目录树')
            key = str(uuid.uuid5(uuid.UUID(request['rootId']), relative))
            return {'directoryId': key, 'path': self.store.directory(self.client, key, str(target))}
        if kind == 'check':
            with self.store.connect() as db:
                rows = db.execute('SELECT id,path FROM directories WHERE client=?',(self.client,)).fetchall()
            return [{'id':key,'available':Path(p).is_dir(),'writable':os.access(p,os.W_OK)} for key,p in rows]
        if kind == 'reveal':
            job = self.store.get(self.client,request['jobId'])
            if not job: raise ValueError('任务不存在')
            p = Path(job.get('destination') or job['source'])
            if not p.exists(): p = Path(job['source'])
            if not p.parent.is_dir(): raise ValueError('文件夹不可用')
            if os.name != 'nt': raise ValueError('此安装包只支持 Windows')
            os.startfile(str(p.parent))
            return True
        raise ValueError('未知操作')

def main():
    base = Path(__file__).resolve().parent
    config = json.loads((base/'host-config.json').read_text('utf-8'))
    origin = next((s for s in sys.argv[1:] if s.startswith('chrome-extension://')), '')
    if origin not in config['allowed_origins']:
        raise ValueError('Unauthorized extension origin')
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    host = Host(config['data_root'],origin)
    try:
        while True:
            request = read_message(sys.stdin.buffer)
            if request is None: break
            try:
                value = host.handle(request)
                response = {'id':request.get('id'),'ok':True,'value':value}
            except Exception as e:
                response = {'id':request.get('id'),'ok':False,'error':str(e)}
            write_message(sys.stdout.buffer,response)
    finally:
        host.stopping.set()
        # Finish an in-flight file transaction even if the browser disconnects.
        if host.worker: host.worker.join()

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(str(e),file=sys.stderr)
        sys.exit(1)
