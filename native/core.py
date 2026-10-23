"""Durable, no-overwrite download archiving. Standard library only."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
import uuid

TERMINAL = {'done', 'cancelled'}

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def signature(path):
    s = os.stat(path)
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns]

@contextlib.contextmanager
def worker_lock(root):
    f = open(Path(root) / 'worker.lock', 'a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            f.seek(0)
            if not f.read(1):
                f.write(b'0'); f.flush()
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        yield False
        return
    try:
        yield True
    finally:
        f.close()

class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'queue.sqlite3'
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS directories (client TEXT, id TEXT, path TEXT, PRIMARY KEY(client,id))')
            db.execute('CREATE TABLE IF NOT EXISTS jobs (client TEXT, id TEXT, status TEXT, updated REAL, data TEXT, PRIMARY KEY(client,id))')

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=20)
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def directory(self, client, key, path):
        p = Path(path).absolute()
        if not Path(path).is_absolute() or not p.is_dir():
            raise ValueError('目录不存在或当前不可用，请连接磁盘后重试')
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO directories VALUES(?,?,?)', (client, key, str(p.resolve())))
        return str(p.resolve())

    def get(self, client, key):
        with self.connect() as db:
            row = db.execute('SELECT data FROM jobs WHERE client=? AND id=?', (client, key)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, job):
        job['updated'] = time.time()
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?)', (job['client'],job['id'],job['status'],job['updated'],json.dumps(job)))

    def list(self, client, limit=300):
        with self.connect() as db:
            rows = db.execute('SELECT data FROM jobs WHERE client=? ORDER BY updated DESC LIMIT ?', (client,limit)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def enqueue(self, client, key, source, directory_id):
        key = str(uuid.UUID(key))
        old = self.get(client,key)
        if old:
            if old['source'] != str(Path(source).absolute()) or old['directoryId'] != directory_id:
                raise ValueError('任务标识已被其他文件使用')
            return old
        p = Path(source).absolute()
        if p.parent.name != key or p.parent.parent.name != 'incoming' or p.parent.parent.parent.name != 'DownloadPort':
            raise ValueError('只接受下载驿站暂存目录内的文件')
        if str(p.resolve()).casefold() != str(p).casefold() or not p.is_file():
            raise ValueError('源文件不存在或经过符号链接')
        with self.connect() as db:
            row = db.execute('SELECT path FROM directories WHERE client=? AND id=?',(client,directory_id)).fetchone()
        if not row:
            raise ValueError('目标目录尚未授权，请在目录管理中重新连接目录')
        job = {'client':client,'id':key,'source':str(p),'directoryId':directory_id,'target':row[0],
               'status':'queued','phase':'new','attempts':0,'retryAt':0,'error':None,'created':time.time(),
               'sourceSignature':signature(p),'name':p.name}
        # Duplicate enqueue is idempotent even if multiple native hosts receive it.
        job['updated'] = time.time()
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?)',(client,key,job['status'],job['updated'],json.dumps(job)))
        return self.get(client,key)

    def control(self, client, key, action):
        with worker_lock(self.root) as acquired:
            if not acquired:
                raise ValueError('正在归档文件，请稍后重试此操作')
            job = self.get(client,key)
            if not job: raise ValueError('任务不存在')
            if job['status'] in TERMINAL: return job
            if action == 'retry':
                job.update(status='queued',retryAt=0,error=None,attempts=0)
            elif action == 'cancel':
                # Stop future processing; never delete any source or committed target.
                job.update(status='cancelled',error='已停止归档，原文件或已提交副本保留')
            else: raise ValueError('操作无效')
            self.put(job)
            return job

    def run_one(self, client, checkpoint=None):
        with worker_lock(self.root) as acquired:
            if not acquired: return False
            with self.connect() as db:
                rows = db.execute("SELECT data FROM jobs WHERE client=? AND status NOT IN ('done','cancelled','failed') ORDER BY updated",(client,)).fetchall()
            jobs = [json.loads(row[0]) for row in rows]
            job = next((j for j in jobs if j.get('retryAt',0) <= time.time()),None)
            if not job: return False
            try:
                self.archive(job,checkpoint)
            except Exception as e:
                job['attempts'] += 1
                job.update(status='waiting' if job['attempts'] < 5 else 'failed',error=f'{type(e).__name__}: {e}',retryAt=time.time()+min(300,5*2**job['attempts']))
                self.put(job)
            return True

    def archive(self, job, checkpoint=None):
        def save(phase):
            job.update(phase=phase,status='archiving',error=None)
            self.put(job)
            if checkpoint: checkpoint(phase)
        source = Path(job['source'])
        target = Path(job['target'])
        if not target.is_dir(): raise OSError('目标磁盘或文件夹当前不可用')
        if str(target.resolve()).casefold() != str(target).casefold(): raise OSError('目标目录位置发生变化')
        temp = target / ('.downloadport-' + job['id'] + '.part')
        # Crash after commit is recoverable only when file identity matches our copied inode.
        final = Path(job['destination']) if job.get('destination') else None
        committed = False
        if final and final.exists() and job.get('tempIdentity'):
            committed = signature(final)[:2] == job['tempIdentity'] and digest(final) == job.get('sha256')
        if not committed:
            if not source.is_file() or signature(source) != job['sourceSignature']:
                raise OSError('源文件已改变或丢失，已停止自动处理')
            if source.parent.resolve() == target.resolve():
                job.update(status='done',phase='done',destination=str(source)); self.put(job); return
            if not (temp.exists() and job.get('sha256') and signature(temp)[:2] == job.get('tempIdentity') and digest(temp) == job['sha256']):
                if temp.exists():
                    # A partially copied task-owned temp is disposable, source is still intact.
                    if job.get('tempIdentity') != signature(temp)[:2]: raise OSError('暂存文件身份无法确认')
                    temp.unlink()
                if shutil.disk_usage(target).free < source.stat().st_size + 1024*1024:
                    raise OSError('目标磁盘空间不足')
                save('copying')
                with source.open('rb') as src, temp.open('xb') as dst:
                    job['tempIdentity'] = signature(temp)[:2]
                    self.put(job)
                    sha = hashlib.sha256()
                    for block in iter(lambda: src.read(1024*1024),b''):
                        dst.write(block); sha.update(block)
                    dst.flush(); os.fsync(dst.fileno())
                job['sha256'] = sha.hexdigest()
                if signature(source) != job['sourceSignature'] or digest(temp) != job['sha256']:
                    raise OSError('复制校验失败，源文件已保留')
                save('verified')
            # os.rename does not replace existing destinations on Windows. POSIX uses
            # exclusive hard-link creation; never use os.replace for target files.
            for index in range(10000):
                name = source.name if not index else f'{source.stem} ({index}){source.suffix}'
                final = target / name
                job['destination'] = str(final)
                save('committing')
                try:
                    if os.name == 'nt': os.rename(temp,final)
                    else:
                        os.link(temp,final)
                        temp.unlink()
                    break
                except FileExistsError:
                    continue
            else: raise OSError('同名文件过多，请更换目标目录')
            save('committed')
        if digest(final) != job['sha256']: raise OSError('目标文件校验失败，源文件已保留')
        if source.exists():
            if signature(source) != job['sourceSignature'] or digest(source) != job['sha256']:
                raise OSError('源文件已改变，已保留两份文件等待检查')
            source.unlink()
            if checkpoint: checkpoint('source_removed')
        job.update(status='done',phase='done',error=None,retryAt=0)
        self.put(job)
