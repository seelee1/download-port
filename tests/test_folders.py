import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from folders import inventory, create_folder, safe_child, list_folders

class FoldersTests(unittest.TestCase):
    def setUp(self):
        base=Path(__file__).resolve().parents[1]/'.test-data';base.mkdir(exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_existing_tree_is_preserved(self):
        create_folder(self.root,'壁纸/WLOP');f=self.root/'壁纸'/'old.txt';f.write_text('keep')
        self.assertEqual(inventory(self.root)['folders'],['壁纸','壁纸/WLOP'])
        self.assertEqual(f.read_text(),'keep')
    def test_invalid_paths(self):
        for p in ['../outside','C:/escape','/absolute','x/../../escape','NUL','a.','a//b']:
            with self.subTest(p=p),self.assertRaises(ValueError):create_folder(self.root,p)
    def test_scan_limits_and_staging_excluded(self):
        for p in ['a/b/c','d','DownloadPort/incoming'] : create_folder(self.root,p)
        scan=inventory(self.root,limit=2)
        self.assertTrue(scan['truncated']);self.assertEqual(len(scan['folders']),2)
        self.assertNotIn('DownloadPort',inventory(self.root)['folders'])
    def test_missing_root(self):
        with self.assertRaises(ValueError): inventory(self.root/'missing')
    def test_existing_file_not_overwritten(self):
        p=self.root/'file';p.write_text('keep')
        with self.assertRaises(OSError):create_folder(self.root,'file')
        self.assertEqual(p.read_text(),'keep')

    def test_shallow_listing_and_pagination(self):
        for p in ['a/hidden-deep','b','c']:create_folder(self.root,p)
        first=list_folders(self.root,limit=2)
        self.assertEqual(len(first['folders']),2)
        second=list_folders(self.root,offset=first['next'],limit=2)
        self.assertEqual(set(first['folders']+second['folders']),{'a','b','c'})
        self.assertEqual(list_folders(self.root,'a')['folders'],['a/hidden-deep'])
        self.assertIsNone(second['next'])
    def test_shallow_rejects_escape_and_missing(self):
        with self.assertRaises(ValueError):list_folders(self.root,'../outside')
        with self.assertRaises(OSError):list_folders(self.root,'missing')
        with self.assertRaises(ValueError):list_folders(self.root,offset=-1)
