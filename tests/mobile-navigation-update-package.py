"""Verify the actual update ZIP against its build and a simulated installation."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import sqlite3
import stat
import sys
import tempfile
import zipfile


source = Path(__file__).resolve().parent.parent
release = source / "dist" / "standalone"
archive = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else source.parent / "Yourrest-CRM-Mobile-Navigation-Update.zip"
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


with zipfile.ZipFile(archive) as bundle, tempfile.TemporaryDirectory(prefix="yourrest-update-") as work:
    check(bundle.testzip() is None, "Archive CRC failed")
    members = bundle.infolist()
    check(len({entry.filename for entry in members}) == len(members), "Duplicate archive members")
    for entry in members:
        name = PurePosixPath(entry.filename)
        assert not name.is_absolute() and ".." not in name.parts, entry.filename
        assert name.parts[0] == "release" or entry.filename == "UPDATE-MOBILE-NAVIGATION-AR.txt", entry.filename
        assert not stat.S_ISLNK(entry.external_attr >> 16), entry.filename
    checks += 1
    expected = {"release/" + file.relative_to(release).as_posix(): file for file in release.rglob("*") if file.is_file()}
    actual = {entry.filename for entry in members}
    check(actual == set(expected) | {"UPDATE-MOBILE-NAVIGATION-AR.txt"}, "Update must contain exactly the complete release and its guide")
    check(bundle.read("UPDATE-MOBILE-NAVIGATION-AR.txt") == (source / "docs/UPDATE-MOBILE-NAVIGATION-AR.txt").read_bytes(), "Guide differs from source")
    for name, file in expected.items():
        assert hashlib.sha256(bundle.read(name)).hexdigest() == digest(file), name
    checks += 1

    home = Path(work)
    app = home / "yourrest-crm"
    data = home / "yourrest-crm-data"
    app.mkdir()
    data.mkdir(mode=0o700)
    protected = {
        app / "settings.cjs": b"module.exports={YR_AUTH_SECRET:'existing-server-secret'};\n",
        app / "app.cjs": b"existing root launcher\n",
        app / "setup.cjs": b"existing setup script\n",
        app / "package.json": b'{"scripts":{"start":"node app.cjs"}}\n',
        app / "migration/initial.json": b'{"seed":"existing seed must stay unchanged"}\n',
        app / ".htaccess": b"existing Passenger settings\n",
        data / "objects/customer-upload.pdf": b"existing private customer upload\n",
    }
    for file, content in protected.items():
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
        file.chmod(0o600)
    database = data / "database.sqlite"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE production_data (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("INSERT INTO production_data VALUES (1, 'customer changes made after initial installation')")
        db.execute("CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)")
        db.execute("INSERT INTO auth_sessions VALUES ('existing-session-must-survive-file-update', 1790726400000)")
    database.chmod(0o600)
    protected[database] = database.read_bytes()
    old_permissions = {file: stat.S_IMODE(file.stat().st_mode) for file in protected}
    node_environment = home / "node-environment"
    node_environment.mkdir()
    (node_environment / "cpanel-marker").write_text("managed by cPanel")
    (app / "node_modules").symlink_to(node_environment, target_is_directory=True)
    (app / "release").mkdir()
    (app / "release/app.cjs").write_text("previous release entry point")

    bundle.extractall(app)
    for name, file in expected.items():
        assert digest(app / name) == digest(file), name
    checks += 1
    for file, content in protected.items():
        check(file.read_bytes() == content, "Update overwrote protected production file: " + file.name)
        check(stat.S_IMODE(file.stat().st_mode) == old_permissions[file], "Update changed protected file permissions: " + file.name)
    check((app / "node_modules").is_symlink(), "Update replaced cPanel's node_modules symlink")
    check((node_environment / "cpanel-marker").read_text() == "managed by cPanel", "Update changed cPanel's dependency environment")
    with sqlite3.connect(database) as db:
        check(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Production database integrity failed")
        check(db.execute("SELECT payload FROM production_data WHERE id=1").fetchone()[0] == "customer changes made after initial installation", "Production customer data changed")
        check(db.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 1, "Existing sessions were removed")
    check(stat.S_IMODE(data.stat().st_mode) == 0o700, "Production data directory permissions changed")

print(json.dumps({
    "ok": True,
    "checks": checks,
    "archive": archive.name,
    "releaseFiles": len(expected),
    "completeBuildVerified": True,
    "productionDataSettingsAndSessionsPreserved": True,
    "cpanelEnvironmentPreserved": True,
    "realHostingTested": False,
}))
