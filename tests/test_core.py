import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
import subprocess
import shutil
import time
import unittest
import uuid
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from core import Store,digest
from host import Host,read_message,write_message

class Crash(BaseException): pass

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        test_root=Path(__file__).resolve().parents[1]/'.test-data'
        test_root.mkdir(exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=test_root)
        self.root=Path(self.tmp.name)
        self.store=Store(self.root/'state');self.client='test';self.target=self.root/'target';self.target.mkdir()
        self.directory=str(uuid.uuid4());self.store.directory(self.client,self.directory,self.target)
    def tearDown(self): self.tmp.cleanup()
    def job(self,name='a.txt',content=b'original',key=None):
        key=key or str(uuid.uuid4());p=self.root/'Downloads'/'DownloadPort'/'incoming'/key/name
        p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
        j=self.store.enqueue(self.client,key,str(p),self.directory);return j,p
    def test_normal_and_idempotent(self):
        j,p=self.job();self.store.run_one(self.client);result=self.store.get(self.client,j['id'])
        self.assertEqual(result['status'],'done');self.assertFalse(p.exists());self.assertEqual(Path(result['destination']).read_bytes(),b'original')
        self.assertEqual(self.store.enqueue(self.client,j['id'],str(p),self.directory)['status'],'done')
    def test_extensionless_chinese(self):
        j,p=self.job('说明');self.store.run_one(self.client);r=self.store.get(self.client,j['id'])
        self.assertEqual(Path(r['destination']),self.target/'说明');self.assertTrue((self.target/'说明').is_file())
    def test_existing_destination_preserved(self):
        (self.target/'a.txt').write_bytes(b'keep');j,p=self.job();self.store.run_one(self.client)
        self.assertEqual((self.target/'a.txt').read_bytes(),b'keep');self.assertEqual((self.target/'a (1).txt').read_bytes(),b'original')
    def test_collision_created_at_commit_is_not_overwritten(self):
        j,p=self.job();once=[]
        def hook(phase):
            if phase=='committing' and not once:
                (self.target/'a.txt').write_bytes(b'external');once.append(1)
        self.store.run_one(self.client,hook)
        self.assertEqual((self.target/'a.txt').read_bytes(),b'external');self.assertEqual((self.target/'a (1).txt').read_bytes(),b'original')
    def test_parallel_workers_keep_all_files(self):
        for i in range(12): self.job(content=str(i).encode())
        def drain():
            for _ in range(40): self.store.run_one(self.client)
        threads=[threading.Thread(target=drain) for _ in range(3)]
        for t in threads:t.start()
        for t in threads:t.join()
        while self.store.run_one(self.client):pass
        self.assertEqual({p.read_bytes() for p in self.target.glob('*.txt')},{str(i).encode() for i in range(12)})
        self.assertTrue(all(j['status']=='done' for j in self.store.list(self.client)))
    def test_recovery_at_verified_committed_and_source_removed(self):
        for phase in ['verified','committed','source_removed']:
            with self.subTest(phase=phase):
                j,p=self.job(phase+'.txt')
                def crash(actual):
                    if actual==phase:raise Crash()
                with self.assertRaises(Crash):self.store.run_one(self.client,crash)
                reopened=Store(self.root/'state');reopened.run_one(self.client)
                self.assertEqual(reopened.get(self.client,j['id'])['status'],'done');self.assertFalse(p.exists())
                self.assertEqual(len(list(self.target.glob(phase+'*'))),1)
    def test_offline_target_retries_without_deleting_source(self):
        j,p=self.job();self.target.rmdir();self.store.run_one(self.client)
        self.assertEqual(self.store.get(self.client,j['id'])['status'],'waiting');self.assertTrue(p.exists())
        self.target.mkdir();self.store.control(self.client,j['id'],'retry');self.store.run_one(self.client)
        self.assertEqual(self.store.get(self.client,j['id'])['status'],'done')
    def test_copy_failure_preserves_source(self):
        j,p=self.job()
        with patch('core.shutil.disk_usage',return_value=type('Space',(),{'free':0})()):self.store.run_one(self.client)
        self.assertTrue(p.exists());self.assertEqual(self.store.get(self.client,j['id'])['status'],'waiting')
    def test_source_changed_after_enqueue(self):
        j,p=self.job();p.write_bytes(b'changed');self.store.run_one(self.client)
        self.assertEqual(p.read_bytes(),b'changed');self.assertEqual(self.store.get(self.client,j['id'])['status'],'waiting')
    def test_cancel_keeps_file(self):
        j,p=self.job();self.store.control(self.client,j['id'],'cancel');self.assertFalse(self.store.run_one(self.client));self.assertTrue(p.exists())
    def test_untrusted_source_and_unknown_directory_rejected(self):
        p=self.root/'unrelated.txt';p.write_text('keep')
        with self.assertRaises(ValueError):self.store.enqueue(self.client,str(uuid.uuid4()),str(p),self.directory)
        j,p=self.job()
        with self.assertRaises(ValueError):self.store.enqueue('other',j['id'],str(p),self.directory)
    def test_destination_change_keeps_old_registration(self):
        host=Host(self.root/'state','chrome-extension://test/');host.client=self.client
        second=self.root/'second';second.mkdir()
        r=host.handle({'type':'directory','directoryId':self.directory,'path':str(second)})
        self.assertNotEqual(r['directoryId'],self.directory)
        j,p=self.job();self.store.run_one(self.client);self.assertEqual(Path(self.store.get(self.client,j['id'])['destination']).parent,self.target)

class ProtocolTests(unittest.TestCase):
    def test_round_trip_unicode(self):
        data={'path':'中文/图片','id':2};s=io.BytesIO();write_message(s,data);s.seek(0);self.assertEqual(read_message(s),data)
    def test_partial_and_oversized_frames_rejected(self):
        with self.assertRaises(EOFError):read_message(io.BytesIO(b'\x05\x00'))
        with self.assertRaises(EOFError):read_message(io.BytesIO(struct.pack('<I',5)+b'{}'))
        with self.assertRaises(ValueError):read_message(io.BytesIO(struct.pack('<I',2*1024*1024)))

class NativeProcessTests(unittest.TestCase):
    def test_real_host_process_archive_and_disconnect(self):
        test_root=Path(__file__).resolve().parents[1]/'.test-data';test_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as directory:
            root=Path(directory);app=root/'app';app.mkdir();target=root/'target';target.mkdir()
            origin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'
            for name in ['core.py','host.py','folders.py']:shutil.copy2(Path(__file__).resolve().parents[1]/'native'/name,app/name)
            (app/'host-config.json').write_text(json.dumps({'allowed_origins':[origin],'data_root':str(root/'state')}),'utf-8')
            process=subprocess.Popen([sys.executable,'-u',str(app/'host.py'),origin],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            def rpc(kind,**data):
                write_message(process.stdin,{'id':1,'type':kind,**data})
                response=read_message(process.stdout)
                self.assertTrue(response['ok'],response)
                return response['value']
            try:
                self.assertEqual(rpc('hello',profile=str(uuid.uuid4()))['protocol'],1)
                did=str(uuid.uuid4());rpc('directory',directoryId=did,path=str(target))
                jid=str(uuid.uuid4());source=root/'Downloads'/'DownloadPort'/'incoming'/jid/'真实协议.txt';source.parent.mkdir(parents=True);source.write_bytes(b'pipe test')
                rpc('enqueue',jobId=jid,source=str(source),directoryId=did)
                deadline=time.time()+10
                while time.time()<deadline:
                    job=rpc('get',jobId=jid)
                    if job['status']=='done':break
                    time.sleep(.1)
                self.assertEqual(job['status'],'done');self.assertEqual((target/source.name).read_bytes(),b'pipe test');self.assertFalse(source.exists())
            finally:
                process.stdin.close()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()
                process.stdout.close();process.stderr.close()

if __name__=='__main__':unittest.main(verbosity=2)
