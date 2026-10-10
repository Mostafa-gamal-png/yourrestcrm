#!/usr/bin/env python3
"""Build the dependency-free Android app with separately published open-source tools.

Linux x86_64, Python 3.10+, JDK 17+. Does not install/accept the proprietary Android SDK.
All downloaded build artifacts are pinned by SHA-256. Signing material is external.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

GOOGLE = 'https://dl.google.com/dl/android/maven2/'
ARTIFACTS = {
    'android-all-15-robolectric-12650502.jar': (
        'https://repo.maven.apache.org/maven2/org/robolectric/android-all/15-robolectric-12650502/android-all-15-robolectric-12650502.jar',
        '6c0670454f6fcee9f1b17aa393e81d71bf26e7e6ae7c5777ed3924b062191d5b'),
    'aapt2-linux.jar': (
        GOOGLE + 'com/android/tools/build/aapt2/8.9.2-12782657/aapt2-8.9.2-12782657-linux.jar',
        'ffb7b7d419c7341dd013f2f87bfb0148f8bff0a2a47c222f54935b3b8f233605'),
    'r8-8.9.35.jar': (
        GOOGLE + 'com/android/tools/r8/8.9.35/r8-8.9.35.jar',
        '204b2fc2b0f4e888dc0ef748b58090def1bf4185068d36abbb94841dbc7107a8'),
    'apksig-8.9.2.jar': (
        GOOGLE + 'com/android/tools/build/apksig/8.9.2/apksig-8.9.2.jar',
        'c070ed1394629d74641aa0906f60b2ffa1ee77e6366a1f93437f59717b1aeb89'),
}

def digest(path: Path) -> str:
    with path.open('rb') as f:
        h = hashlib.sha256()
        for block in iter(lambda: f.read(1048576), b''): h.update(block)
        return h.hexdigest()

def source_digest(source: Path, project: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(source.rglob('*')):
        if path.is_file():
            h.update(path.relative_to(project).as_posix().encode())
            h.update(path.read_bytes())
    return h.hexdigest()

def download(cache: Path, name: str) -> Path:
    url, expected = ARTIFACTS[name]
    path = cache / name
    if path.is_file() and digest(path) == expected: return path
    temporary = path.with_suffix(path.suffix + '.download')
    print('Downloading', name, flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as out:
            shutil.copyfileobj(response, out)
        if digest(temporary) != expected: raise RuntimeError('SHA-256 mismatch: ' + name)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path

def run(*args: object) -> None:
    subprocess.run([str(x) for x in args], check=True)

def aligned_zip(destination: Path, entries: dict[str, bytes]) -> None:
    # No native libraries. Stored resource/dex entries require ordinary 4-byte alignment.
    with zipfile.ZipFile(destination, 'w') as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            offset = archive.fp.tell() + 30 + len(name.encode('utf-8'))
            if offset % 4:
                padding = (-offset - 4) % 4
                info.extra = struct.pack('<HH', 0xd935, padding) + bytes(padding)
            archive.writestr(info, data)

def verify_alignment(apk: Path) -> None:
    with zipfile.ZipFile(apk) as z, apk.open('rb') as f:
        for entry in z.infolist():
            if entry.compress_type != zipfile.ZIP_STORED: continue
            f.seek(entry.header_offset + 26)
            names, extras = struct.unpack('<HH', f.read(4))
            if (entry.header_offset + 30 + names + extras) % 4:
                raise RuntimeError('APK entry unaligned: ' + entry.filename)

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jdk', type=Path, required=True, help='Full JDK 17+ root, not just JRE')
    parser.add_argument('--cache', type=Path, required=True, help='External downloaded tool cache')
    parser.add_argument('--out', type=Path, required=True, help='Output directory outside source tree')
    parser.add_argument('--keystore', type=Path, required=True, help='Private PKCS12 release key')
    parser.add_argument('--storepass-file', type=Path, required=True, help='Private UTF-8 key password file')
    parser.add_argument('--alias', default='yourrest-crm')
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    main_source = project / 'app/src/main'
    config = (project / 'app/build.gradle').read_text()
    initial_source_hash = source_digest(main_source, project)
    package = re.search(r"applicationId\s+['\"]([^'\"]+)['\"]", config).group(1)
    version = re.search(r"versionName\s+['\"]([^'\"]+)['\"]", config).group(1)
    version_code = int(re.search(r'versionCode\s+(\d+)', config).group(1))
    minimum = int(re.search(r'minSdk\s+(\d+)', config).group(1))
    target = int(re.search(r'targetSdk\s+(\d+)', config).group(1))
    if target != 35 or minimum < 26: raise RuntimeError('Review pinned framework/tooling before changing SDK levels')
    if args.out.resolve().is_relative_to(project): raise RuntimeError('Keep build output outside source directory')
    for path in [args.cache, args.keystore, args.storepass_file]:
        if path.resolve().is_relative_to(project): raise RuntimeError('Keep downloaded tools and signing material outside source directory')
    for tool in ['java', 'javac']:
        if not (args.jdk / 'bin' / tool).is_file(): raise RuntimeError('Full JDK required: missing ' + tool)
    if not args.keystore.is_file() or not args.storepass_file.is_file(): raise RuntimeError('Separate signing key and password file required')
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    artifacts = {name: download(args.cache, name) for name in ARTIFACTS}
    java, javac = args.jdk / 'bin/java', args.jdk / 'bin/javac'
    framework = artifacts['android-all-15-robolectric-12650502.jar']
    with tempfile.TemporaryDirectory(prefix='yourrest-android-build-') as temp:
        work = Path(temp)
        aapt = work / 'aapt2'
        with zipfile.ZipFile(artifacts['aapt2-linux.jar']) as z: aapt.write_bytes(z.read('aapt2'))
        aapt.chmod(0o755)
        generated, classes, dex = [work / x for x in ['generated', 'classes', 'dex']]
        for p in [generated, classes, dex]: p.mkdir()
        ET.register_namespace('android', 'http://schemas.android.com/apk/res/android')
        manifest = ET.parse(main_source / 'AndroidManifest.xml')
        manifest.getroot().set('package', package)
        manifest_path = work / 'AndroidManifest.xml'
        manifest.write(manifest_path, encoding='utf-8', xml_declaration=True)
        resources, linked = work / 'resources.zip', work / 'resources.apk'
        run(aapt, 'compile', '--dir', main_source / 'res', '-o', resources)
        run(aapt, 'link', '-o', linked, '-I', framework, '--manifest', manifest_path,
            '--java', generated, '--min-sdk-version', minimum, '--target-sdk-version', target,
            '--version-code', version_code, '--version-name', version, resources)
        sources = sorted((main_source / 'java').rglob('*.java')) + sorted(generated.rglob('*.java'))
        run(javac, '--release', '17', '-encoding', 'UTF-8', '-Xlint:deprecation', '-cp', framework, '-d', classes, *sources)
        compiled = work / 'classes.jar'
        with zipfile.ZipFile(compiled, 'w', zipfile.ZIP_DEFLATED) as z:
            for p in sorted(classes.rglob('*.class')): z.write(p, p.relative_to(classes))
        run(java, '-cp', artifacts['r8-8.9.35.jar'], 'com.android.tools.r8.D8', '--release',
            '--min-api', minimum, '--lib', framework, '--lib', args.jdk, '--output', dex, compiled)
        with zipfile.ZipFile(linked) as z:
            entries = {n: z.read(n) for n in z.namelist() if not n.endswith('/')}
        for p in dex.glob('*.dex'): entries[p.name] = p.read_bytes()
        if 'classes.dex' not in entries: raise RuntimeError('D8 produced no classes.dex')
        assets = main_source / 'assets'
        if assets.exists():
            for p in assets.rglob('*'):
                if p.is_file(): entries['assets/' + p.relative_to(assets).as_posix()] = p.read_bytes()
        unsigned = work / 'unsigned-aligned.apk'
        aligned_zip(unsigned, entries)
        verify_alignment(unsigned)
        sign_classes = work / 'sign-classes'
        sign_classes.mkdir()
        run(javac, '--release', '17', '-cp', artifacts['apksig-8.9.2.jar'], '-d', sign_classes, project / 'tools/ApkSign.java')
        apk = args.out / 'Yourrest-CRM-Android.apk'
        run(java, '-cp', str(sign_classes) + os.pathsep + str(artifacts['apksig-8.9.2.jar']), 'ApkSign',
            unsigned, apk, args.keystore, args.storepass_file, args.alias, minimum)
        verify_alignment(apk)
        badging = subprocess.check_output([str(aapt), 'dump', 'badging', str(apk)], text=True)
        (args.out / 'apk-badging.txt').write_text(badging)
        if source_digest(main_source, project) != initial_source_hash or (project / 'app/build.gradle').read_text() != config:
            apk.unlink(missing_ok=True)
            raise RuntimeError('Source changed during build; freeze edits and rebuild')
        report = {'package': package, 'versionCode': version_code, 'versionName': version,
                  'minSdk': minimum, 'targetSdk': target, 'apkSha256': digest(apk),
                  'apkBytes': apk.stat().st_size, 'sourceSha256': initial_source_hash,
                  'buildConfigSha256': hashlib.sha256(config.encode()).hexdigest(),
                  'build': 'Standalone OSS AAPT2, javac, D8, apksig; no proprietary SDK',
                  'deviceTested': False, 'toolSha256': {n: v[1] for n, v in ARTIFACTS.items()}}
        (args.out / 'build-verification.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
