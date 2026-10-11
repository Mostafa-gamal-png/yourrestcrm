"""Package the built Yourrest UI refresh with a separately pinned activator.

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
PIN_TOKEN = "__UI_REFRESH_MANIFEST_SHA256__"
COUNT_TOKEN = "const RELEASE_FILES = 0; // __UI_REFRESH_RELEASE_FILES__"
NAME_TOKEN = "const RELEASE_NAME = 'ui-refresh'; // __UI_REFRESH_RELEASE_NAME__"
DATE_TOKEN = "const RELEASE_DATE = '20261008'; // __UI_REFRESH_RELEASE_DATE__"
STAGE_TOKEN = "const STAGE_DIR = 'yourrest-ui-update-20261008'; // __UI_REFRESH_STAGE_DIR__"
DEFAULTS = {"name": "ui-refresh", "date": "20261008", "stage": "yourrest-ui-update-20261008", "helper": "yourrest-activate-ui-refresh.cjs", "guide_name": "UPDATE-UI-REFRESH-AR.txt"}
SAFE_NAME = __import__("re").compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def package(release, archive, release_name=DEFAULTS["name"], date=DEFAULTS["date"], stage=DEFAULTS["stage"], helper_name=DEFAULTS["helper"], guide_text=None, guide_name=DEFAULTS["guide_name"]):
    if not SAFE_NAME.match(release_name) or not date.isdigit() or len(date) != 8 or not SAFE_NAME.match(stage.replace("yourrest-", "", 1)) or "/" in helper_name or not helper_name.endswith(".cjs"):
        raise RuntimeError("Unsafe release name, date, stage folder or helper name")
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
    helper = (SOURCE / "portable/activate-ui-refresh-update.cjs").read_text()
    if any(helper.count(token) != 1 for token in (PIN_TOKEN, COUNT_TOKEN, NAME_TOKEN, DATE_TOKEN, STAGE_TOKEN)):
        raise RuntimeError("Unexpected activator template")
    helper = (helper.replace(PIN_TOKEN, pin).replace(COUNT_TOKEN, "const RELEASE_FILES = " + str(len(files)) + ";")
              .replace(NAME_TOKEN, "const RELEASE_NAME = " + json.dumps(release_name) + ";").replace(DATE_TOKEN, "const RELEASE_DATE = " + json.dumps(date) + ";")
              .replace(STAGE_TOKEN, "const STAGE_DIR = " + json.dumps(stage) + ";"))
    guide = guide_text if guide_text is not None else """تحديث واجهة يورست CRM — العدادات والرفع والوضع الليلي والأزرار

الحزمة تخص crm.yourrest.org فقط وتتطلب تفعيل تحديث الأمان السابق بنجاح (15 ترحيلًا).
لا تشغّل setup.cjs ولا تنسخ الملفات فوق التطبيق الحالي. الحزمة لا تحتوي إعدادات أو بيانات تشغيل أو حسابات أو نسخة APK جديدة.
الرفع وفحص الحزمة يمكن تنفيذهما والتطبيق متاح. يلزم إيقاف يورست فقط لفترة تبديل الإصدار النهائي والتحقق من الملفات؛ لا توقف أي تطبيق آخر.

1. والتطبيق يعمل، ارفع الحزمة وافكها داخل:
/home/youriedx/yourrest-ui-update-20261008
يجب أن يظهر مجلد release والملف yourrest-activate-ui-refresh.cjs مباشرة داخل هذا المسار.

2. افحص الحزمة دون إيقاف التطبيق:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-ui-update-20261008/yourrest-activate-ui-refresh.cjs --check

3. عند الجاهزية، اضغط Stop App لتطبيق يورست فقط، ثم:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-ui-update-20261008/yourrest-activate-ui-refresh.cjs

الأمر يتحقق من توقف التطبيق، ويستخدم نسخة احتياطية سليمة من نفس اليوم بتوقيت السعودية. إذا لم توجد نسخة لليوم، ينسخ التطبيق والبيانات بالكامل مرة واحدة ويتحقق منها. في كل تحديث يفحص البيانات الحالية ويسجل معرفات السجلات قبل تبديل مجلد release، حتى لو كانت النسخة اليومية أقدم من آخر إدخالات اليوم. لا يغيّر إعدادات الجذر أو البيانات ولا يشغّل ترحيلات. هذه سياسة نسخ أثناء التحديث؛ لا تنشئ جدولة Cron تلقائيًا.

4. عند ظهور START APP IN CPANEL اضغط Start App، ثم:
cd /home/youriedx && /opt/alt/alt-nodejs22/root/usr/bin/node /home/youriedx/yourrest-ui-update-20261008/yourrest-activate-ui-refresh.cjs --verify

النجاح النهائي: DEPLOYMENT VERIFIED.
بعد التحقق افتح crm.yourrest.org وأعد تحميل الصفحة. اختبر الدخول والحفظ بحساب مخوّل، وتأكد من الوضع الليلي والمستهدفات. تغييرات الواجهة في الويب لا تتطلب إرسال APK جديد؛ تحقق من وصول نسخة الويب الجديدة داخل التطبيق المثبّت.
إذا ظهر STOP أو خطأ، احتفظ بالناتج للمراجعة. لا تمسح ملفات الحالة أو القفل ولا تسترجع بيانات قديمة.
"""
    archive.parent.mkdir(parents=True, exist_ok=True)
    temporary = archive.with_suffix(archive.suffix + ".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as result:
            for item, name in files:
                result.write(item, name)
            result.writestr("RELEASE-SHA256SUMS.txt", manifest)
            result.writestr(helper_name, helper)
            result.writestr(guide_name, guide)
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
            "settingsOrProductionDataIncluded": False, "standaloneModified": False,
            "releaseName": release_name, "releaseDate": date, "stageDir": stage, "helper": helper_name, "guide": guide_name}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=Path, default=SOURCE / "dist/standalone")
    parser.add_argument("--output", type=Path, default=SOURCE.parent / "Yourrest-CRM-UI-Refresh-Update-20261008.zip")
    parser.add_argument("--release-name", default=DEFAULTS["name"])
    parser.add_argument("--release-date", default=DEFAULTS["date"])
    parser.add_argument("--stage-name", default=DEFAULTS["stage"], help="folder under the hosting home where the package is unpacked")
    parser.add_argument("--helper-name", default=DEFAULTS["helper"])
    parser.add_argument("--guide", type=Path, help="Arabic guide text file to embed; must mention the stage folder and helper name")
    parser.add_argument("--guide-name", default=None)
    args = parser.parse_args()
    guide_text = None
    guide_name = args.guide_name or DEFAULTS["guide_name"]
    if args.guide:
        guide_text = args.guide.read_text(encoding="utf-8")
        if args.stage_name not in guide_text or args.helper_name not in guide_text:
            raise SystemExit("The guide must mention the stage folder and the helper file name")
        guide_name = args.guide_name or "UPDATE-" + args.release_date + "-AR.txt"
    print(json.dumps(package(args.release.absolute(), args.output.absolute(), args.release_name, args.release_date, args.stage_name, args.helper_name, guide_text, guide_name)))
