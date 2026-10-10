"""Package a built release as a data-preserving Namecheap update.

Run scripts/build-independent.mjs before this script. The archive intentionally
has no root launcher, installer, settings, seed, database, or uploaded files.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import stat
import zipfile


source = Path(__file__).resolve().parent.parent
release = source / "dist" / "standalone"
archive = source.parent / "Yourrest-CRM-Map-Search-Update.zip"
guide = source / "docs" / "UPDATE-MAP-SEARCH-AR.txt"

for required in ["app.cjs", "server.js", "package.json", "operations/config.cjs"]:
    if not (release / required).is_file():
        raise RuntimeError("Build the independent application first: " + required)
for required in ["dist/server", "dist/client", "node_modules", "drizzle"]:
    if not (release / required).is_dir():
        raise RuntimeError("Incomplete standalone build: " + required)

files = []
for item in sorted(release.rglob("*")):
    if item.is_symlink():
        raise RuntimeError("A standalone update cannot contain symlinks: " + str(item))
    if not item.is_file():
        continue
    if item.name in {"settings.cjs", ".env"} or "storepass" in item.name.lower() or item.suffix.lower() in {".sqlite", ".db", ".pem", ".p12", ".jks", ".keystore"}:
        raise RuntimeError("Unexpected runtime/private file: " + str(item))
    files.append((item, "release/" + item.relative_to(release).as_posix()))
files.append((guide, "UPDATE-MAP-SEARCH-AR.txt"))

temporary = archive.with_suffix(".zip.tmp")
try:
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as result:
        for local, destination in files:
            result.write(local, destination)
    with zipfile.ZipFile(temporary) as result:
        bad = result.testzip()
        if bad:
            raise RuntimeError("ZIP corrupt: " + bad)
        for item in result.infolist():
            filename = PurePosixPath(item.filename)
            if filename.is_absolute() or ".." in filename.parts:
                raise RuntimeError("Unsafe archive path: " + item.filename)
            if filename.parts[0] != "release" and item.filename != "UPDATE-MAP-SEARCH-AR.txt":
                raise RuntimeError("Unexpected update member: " + item.filename)
            if stat.S_ISLNK(item.external_attr >> 16):
                raise RuntimeError("Unexpected archive symlink: " + item.filename)
    os.chmod(temporary, 0o600)
    temporary.replace(archive)
finally:
    temporary.unlink(missing_ok=True)

print(json.dumps({
    "archive": str(archive),
    "bytes": archive.stat().st_size,
    "files": len(files),
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "releaseOnly": True,
    "productionSettingsOrDataIncluded": False,
}))
