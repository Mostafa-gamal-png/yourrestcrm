"""Rebuild the existing canonical package with the tested standalone release.
Run only after a successful web/native build. Runtime settings and private keys
remain external; this script never reads the production server or database.
"""
from pathlib import Path
import hashlib,json,shutil,stat,zipfile

source=Path(__file__).resolve().parents[1]
package=source.parent
release=source/'dist/standalone'
archive=package.parent/'Yourrest-CRM-Namecheap.zip'
if not (release/'server.js').is_file(): raise RuntimeError('Build standalone first')
announcement=json.loads((source/'lib/app-update-release.json').read_text())
for name in ['public/downloads/yourrest-crm-android.apk','dist/client/downloads/yourrest-crm-android.apk']:
 p=release/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=announcement['sha256']: raise RuntimeError('Stale APK in built release: '+name)
if (release/'public/app-update.json').read_bytes()!=(source/'lib/app-update-release.json').read_bytes(): raise RuntimeError('Stale release announcement')
# Replace only this local build output; production backups belong to deployment.
if (package/'release').exists(): shutil.rmtree(package/'release')
shutil.copytree(release,package/'release')
excluded={'node_modules','dist','.git','__pycache__','.vite','build','out','test-results','playwright-report'}
items=[]
for p in sorted(package.rglob('*')):
 rel=p.relative_to(package)
 if rel.parts[0]=='source' and any(part in excluded for part in rel.parts[1:]): continue
 if not p.is_file() or rel.as_posix()=='PACKAGE-CONTENTS.sha256': continue
 if p.is_symlink(): raise RuntimeError('Unexpected symlink: '+str(rel))
 if p.name in {'settings.cjs','.env','storepass.txt'} or p.suffix.lower() in {'.p12','.jks','.keystore','.pem','.sqlite','.db'}: raise RuntimeError('Unexpected private file: '+str(rel))
 items.append((p,rel.as_posix()))
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+name+'\n' for p,name in items)
(package/'PACKAGE-CONTENTS.sha256').write_text(manifest)
temporary=archive.with_suffix('.zip.tmp')
with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p,name in items: z.write(p,name)
 z.write(package/'PACKAGE-CONTENTS.sha256','PACKAGE-CONTENTS.sha256')
with zipfile.ZipFile(temporary) as z:
 if z.testzip() is not None: raise RuntimeError('Archive CRC failure')
 if len(z.namelist())!=len(set(z.namelist())): raise RuntimeError('Duplicate archive paths')
temporary.replace(archive)
print(json.dumps({'archive':str(archive),'files':len(items)+1,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'androidVersion':announcement['versionName'],'apkSha256':announcement['sha256']}))
