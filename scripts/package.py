"""Build a release ZIP from an explicit source allowlist."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'extension/manifest.json').read_text('utf-8'))['version']
out = root / 'releases'
out.mkdir(exist_ok=True)
archive = out / f'download-port-{version}.zip'
files = []
patterns = {
    'extension': ('*.html', '*.js', '*.css', 'manifest.json', 'icons/*.png'),
    'native': ('*.py',),
    'docs': ('*.md', 'preview.png'),
    'tests': ('*.py', '*.mjs', '*.cjs'),
    'scripts': ('*.py',),
}
for folder, globs in patterns.items():
    for pattern in globs:
        files.extend((root / folder).glob(pattern))
for name in ('README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'CONTRIBUTORS.md',
             'install.cmd', 'uninstall.cmd', 'package.json', '.gitignore', '.gitattributes'):
    files.append(root / name)
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for path in sorted(set(files)):
        if path.is_file():
            package.write(path, Path('download-port') / path.relative_to(root))
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / 'SHA256.txt').write_text(f'{sha}  {archive.name}\n', 'utf-8')
print(f'{archive.name}: {archive.stat().st_size} bytes; SHA256 {sha}')
