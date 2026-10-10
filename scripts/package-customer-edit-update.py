"""Package the built Yourrest customer edit fix with a separately pinned activator.

This script only reads the standalone build. No production settings, seed, data,
root launcher, installers or host modifications are included.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import stat
import zipfile


SOURCE = Path(__file__).resolve().parent.parent
PIN_TOKEN = "__CUSTOMER_EDIT_MANIFEST_SHA256__"
COUNT_TOKEN = "const RELEASE_FILES = 0; // __CUSTOMER_EDIT_RELEASE_FILES__"


def package(release, archive):
    for name in ["app.cjs", "server.js", "package.json", "operations/config.cjs", "operations/initialize.mjs", "drizzle/manifest.json"]:
        if not (release / name).is_file():
            raise RuntimeError("Incomplete standalone build: " + name)
    for name in ["dist/server", "dist/client", "node_modules", "drizzle"]:
        if not (release / name).is_dir():
            raise RuntimeError("Incomplete standalone build: " + name)
    if release.is_symlink() or any(p.is_symlink() for p in release.parents):
        raise RuntimeError("Standalone path must not contain symlinks")
    migrations = json.loads((release / "drizzle/manifest.json").read_text())
    if migrations.get("format") != "yourrest-migrations-v1" or len(migrations.get("files", [])) != 15:
        raise RuntimeError("This update requires the already activated 15-migration security release")
    files = []
    for item in sorted(release.rglob("*")):
        if item.is_symlink():
            raise RuntimeError("Unexpected standalone symlink")
        if item.is_dir():
            continue
        if not item.is_file():
            raise RuntimeError("Unexpected standalone file type")
        if item.name in {"settings.cjs", ".env"} or "storepass" in item.name.lower() or item.suffix.lower() in {".sqlite", ".db", ".pem", ".p12", ".jks", ".keystore"}:
            raise RuntimeError("Unexpected private file in standalone build")
        files.append((item, "release/" + item.relative_to(release).as_posix()))
    manifest = "".join(hashlib.sha256(item.read_bytes()).hexdigest() + "  " + name + "\n" for item, name in files).encode()
    pin = hashlib.sha256(manifest).hexdigest()
    helper = (SOURCE / "portable/activate-customer-edit-update.cjs").read_text()
    if helper.count(PIN_TOKEN) != 1 or helper.count(COUNT_TOKEN) != 1:
        raise RuntimeError("Unexpected activator template")
    helper = helper.replace(PIN_TOKEN, pin).replace(COUNT_TOKEN, "const RELEASE_FILES = " + str(len(files)) + ";")
    guide = """تحديث صلاحية تعديل بيانات العملاء — يورست CRM

الحزمة تخص crm.yourrest.org فقط وتتطلب تفعيل تحديث الأمان السابق بنجاح (15 ترحيلًا).
لا تشغّل setup.cjs ولا تنسخ الملفات فوق التطبيق الحالي.

1. والتطبيق يعمل، ارفع الحزمة وافكها داخل:
/home/youriedx/yourrest-customer-edit-update-20261007
يجب أن يظهر مجلد release والملف yourrest-activate-customer-edit.cjs مباشرة داخل هذا المسار.

2. افحص الحزمة دون إيقاف التطبيق:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-customer-edit-update-20261007/yourrest-activate-customer-edit.cjs --check

3. عند الجاهزية، اضغط Stop App لتطبيق يورست فقط، ثم:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-customer-edit-update-20261007/yourrest-activate-customer-edit.cjs

الأمر يتحقق من توقف التطبيق، ويستخدم نسخة احتياطية سليمة من نفس اليوم بتوقيت السعودية. إذا لم توجد نسخة لليوم، ينسخ التطبيق والبيانات بالكامل مرة واحدة ويتحقق منها. في كل تحديث يفحص البيانات الحالية ويسجل معرفات السجلات قبل تبديل مجلد release، حتى لو كانت النسخة اليومية أقدم من آخر إدخالات اليوم. لا يغيّر إعدادات الجذر أو البيانات ولا يشغّل ترحيلات. هذه سياسة نسخ أثناء التحديث؛ لا تنشئ جدولة Cron تلقائيًا.

4. عند ظهور START APP IN CPANEL اضغط Start App، ثم:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-customer-edit-update-20261007/yourrest-activate-customer-edit.cjs --verify

النجاح النهائي: DEPLOYMENT VERIFIED.
إذا ظهر STOP أو خطأ، احتفظ بالناتج للمراجعة. لا تمسح ملفات الحالة أو القفل ولا تسترجع بيانات قديمة.
"""
    archive.parent.mkdir(parents=True, exist_ok=True)
    temporary = archive.with_suffix(archive.suffix + ".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as result:
            for item, name in files:
                result.write(item, name)
            result.writestr("RELEASE-SHA256SUMS.txt", manifest)
            result.writestr("yourrest-activate-customer-edit.cjs", helper)
            result.writestr("UPDATE-CUSTOMER-EDIT-AR.txt", guide)
        with zipfile.ZipFile(temporary) as result:
            if result.testzip():
                raise RuntimeError("ZIP integrity failure")
            expected = dict(line.split("  ", 1)[::-1] for line in manifest.decode().splitlines())
            for item in result.infolist():
                name = PurePosixPath(item.filename)
                if name.is_absolute() or ".." in name.parts or stat.S_ISLNK(item.external_attr >> 16):
                    raise RuntimeError("Unsafe archive member")
                if item.filename.startswith("release/"):
                    if hashlib.sha256(result.read(item)).hexdigest() != expected.pop(item.filename, None):
                        raise RuntimeError("Standalone build changed during packaging")
            if expected:
                raise RuntimeError("Missing release member")
        os.chmod(temporary, 0o600)
        temporary.replace(archive)
    finally:
        if temporary.exists():
            temporary.unlink()
    return {"archive": str(archive), "bytes": archive.stat().st_size, "files": len(files), "manifestSha256": pin,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "schemaBefore": 15, "schemaAfter": 15,
            "settingsOrProductionDataIncluded": False, "standaloneModified": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=Path, default=SOURCE / "dist/standalone")
    parser.add_argument("--output", type=Path, default=SOURCE.parent / "Yourrest-CRM-Customer-Edit-Update-20261007.zip")
    args = parser.parse_args()
    print(json.dumps(package(args.release.absolute(), args.output.absolute())))
