"""Bounded directory inventory; never traverse links or move existing files."""
import os
import re
from pathlib import Path

def safe_child(root, relative=''):
    root = Path(root)
    if not root.is_dir() or root.resolve() != root.absolute():
        raise ValueError('主目录离线、已移动或包含链接，请重新选择')
    parts = relative.replace('\\', '/').split('/') if relative else []
    if any(not p or p.startswith('.') or re.search(r'[<>:"|?*\x00-\x1f]', p) or p.endswith((' ', '.')) or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)', p, re.I) for p in parts):
        raise ValueError('子目录名称无效，不能使用绝对路径、隐藏路径或上级路径')
    p = root
    for part in parts:
        p = p / part
        if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()) or p.resolve() != p.absolute():
            raise ValueError('不接管符号链接或目录联接')
    return p

def inventory(root, limit=1500, max_depth=12):
    root = safe_child(root)
    rows, warnings = [], []
    pending = [(root, 0)]
    while pending:
        parent, depth = pending.pop()
        try:
            with os.scandir(parent) as it:
                entries = sorted(it, key=lambda e: e.name.casefold())
            for entry in entries:
                if not entry.is_dir(follow_symlinks=False): continue
                relative = Path(entry.path).relative_to(root).as_posix()
                if relative == 'DownloadPort': continue
                try: safe_child(root, relative)
                except ValueError:
                    warnings.append('已跳过不支持的目录：' + relative); continue
                if len(rows) >= limit:
                    return {'folders': sorted(rows), 'warnings': warnings[:30], 'truncated': True}
                rows.append(relative)
                if depth + 1 < max_depth: pending.append((Path(entry.path), depth + 1))
                else: warnings.append('已达到扫描深度：' + relative)
        except OSError:
            warnings.append('无法读取：' + str(parent))
    return {'folders': sorted(rows), 'warnings': warnings[:30], 'truncated': bool(warnings)}

def create_folder(root, relative):
    if not relative: raise ValueError('请输入子目录名称')
    target = safe_child(root, relative)
    target.mkdir(parents=True, exist_ok=True)
    return str(safe_child(root, relative))

def list_folders(root, relative='', offset=0, limit=200):
    """Read one level in bounded pages. Never descend into children."""
    if not isinstance(offset, int) or offset < 0 or offset > 1000000:
        raise ValueError('分页位置无效')
    if not isinstance(limit, int) or not 1 <= limit <= 200:
        raise ValueError('分页大小无效')
    parent = safe_child(root, relative)
    rows, skipped, consumed = [], 0, offset
    with os.scandir(parent) as entries:
        for index, entry in enumerate(entries):
            if index < offset: continue
            if len(rows) >= limit or index - offset >= 5000:
                return {'folders': sorted(rows, key=str.casefold), 'next': index, 'skipped': skipped}
            consumed = index + 1
            if not entry.is_dir(follow_symlinks=False): continue
            child = '/'.join(filter(None, [relative, entry.name]))
            if child == 'DownloadPort': continue
            try: safe_child(root, child)
            except ValueError:
                skipped += 1
                continue
            rows.append(child)
    return {'folders': sorted(rows, key=str.casefold), 'next': None, 'skipped': skipped}
