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
SCHEMA_BEFORE_TOKEN = "const SCHEMA_BEFORE = 15; // __UI_REFRESH_SCHEMA_BEFORE__"
SCHEMA_TOKEN = "const SCHEMA_AFTER = 15; // __UI_REFRESH_SCHEMA_AFTER__"
MIGRATIONS_TOKEN = "const NEW_MIGRATIONS = []; // __UI_REFRESH_NEW_MIGRATIONS__"
ROUTES_TOKEN = "const EXTRA_ROUTES = []; // __UI_REFRESH_EXTRA_ROUTES__"
BASELINE_MIGRATIONS = 15  # default: the live database holds the 15 migrations of the 2026-10-11 release
MAX_BASELINE = 99
DEFAULTS = {"name": "ui-refresh", "date": "20261008", "stage": "yourrest-ui-update-20261008", "helper": "yourrest-activate-ui-refresh.cjs", "guide_name": "UPDATE-UI-REFRESH-AR.txt"}
RE = __import__("re")
SAFE_NAME = RE.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
MIGRATION_NAME = RE.compile(r"^\d{4}_[a-z0-9_]{1,60}\.sql$")
ROUTE_PATH = RE.compile(r"^/[A-Za-z0-9/_-]{1,80}$")


def package(release, archive, release_name=DEFAULTS["name"], date=DEFAULTS["date"], stage=DEFAULTS["stage"], helper_name=DEFAULTS["helper"], guide_text=None, guide_name=DEFAULTS["guide_name"], new_migrations=(), verify_routes=(), schema_baseline=BASELINE_MIGRATIONS):
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
    if isinstance(schema_baseline, bool) or not isinstance(schema_baseline, int) or not BASELINE_MIGRATIONS <= schema_baseline <= MAX_BASELINE:
        raise RuntimeError("The schema baseline must be a whole number from %d to %d" % (BASELINE_MIGRATIONS, MAX_BASELINE))
    new_migrations = list(new_migrations)
    if any(not MIGRATION_NAME.match(name) for name in new_migrations) or len(set(new_migrations)) != len(new_migrations):
        raise RuntimeError("Unsafe migration name")
    routes = []
    for route in verify_routes:
        path_part, _, status = route.partition("=")
        if not ROUTE_PATH.match(path_part) or not status.isdigit() or not 100 <= int(status) <= 599:
            raise RuntimeError("Unsafe verification route: " + route)
        routes.append([path_part, int(status)])
    schema_after = schema_baseline + len(new_migrations)
    migrations = json.loads((release / "drizzle/manifest.json").read_text())
    names = sorted(entry.get("name", "") for entry in migrations.get("files", []))
    # The live database must already hold the baseline; the package may add only the migrations it declares.
    if migrations.get("format") != "yourrest-migrations-v1" or len(names) != schema_after or names[schema_baseline:] != sorted(new_migrations):
        raise RuntimeError("This update requires the activated %d-migration release plus exactly the declared new migrations" % schema_baseline)
    for name in new_migrations:
        if not (release / "drizzle" / name).is_file():
            raise RuntimeError("Declared migration is missing from the build: " + name)
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
    if any(helper.count(token) != 1 for token in (PIN_TOKEN, COUNT_TOKEN, NAME_TOKEN, DATE_TOKEN, STAGE_TOKEN, SCHEMA_BEFORE_TOKEN, SCHEMA_TOKEN, MIGRATIONS_TOKEN, ROUTES_TOKEN)):
        raise RuntimeError("Unexpected activator template")
    helper = (helper.replace(PIN_TOKEN, pin).replace(COUNT_TOKEN, "const RELEASE_FILES = " + str(len(files)) + ";")
              .replace(NAME_TOKEN, "const RELEASE_NAME = " + json.dumps(release_name) + ";").replace(DATE_TOKEN, "const RELEASE_DATE = " + json.dumps(date) + ";")
              .replace(STAGE_TOKEN, "const STAGE_DIR = " + json.dumps(stage) + ";").replace(SCHEMA_BEFORE_TOKEN, "const SCHEMA_BEFORE = " + str(schema_baseline) + ";").replace(SCHEMA_TOKEN, "const SCHEMA_AFTER = " + str(schema_after) + ";")
              .replace(MIGRATIONS_TOKEN, "const NEW_MIGRATIONS = " + json.dumps(sorted(new_migrations)) + ";").replace(ROUTES_TOKEN, "const EXTRA_ROUTES = " + json.dumps(routes) + ";"))
    guide = guide_text if guide_text is not None else """تحديث واجهة يورست CRM — العدادات والرفع والوضع الليلي والأزرار

الحزمة تخص crm.yourrest.org فقط وتتطلب تفعيل التحديث السابق بنجاح (""" + str(schema_baseline) + """ ترحيلًا).
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
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "schemaBefore": schema_baseline, "schemaAfter": schema_after,
            "newMigrations": sorted(new_migrations), "verifyRoutes": routes,
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
    parser.add_argument("--schema-baseline", type=int, default=BASELINE_MIGRATIONS, help="migrations the live database already holds before this release (default %d); the release must carry exactly these plus the declared new ones" % BASELINE_MIGRATIONS)
    parser.add_argument("--new-migration", action="append", default=[], help="a migration this release adds after the baseline (repeatable)")
    parser.add_argument("--verify-route", action="append", default=[], help="PATH=STATUS probed anonymously by --verify, for routes the release introduces (repeatable)")
    args = parser.parse_args()
    guide_text = None
    guide_name = args.guide_name or DEFAULTS["guide_name"]
    if args.guide:
        guide_text = args.guide.read_text(encoding="utf-8")
        if args.stage_name not in guide_text or args.helper_name not in guide_text:
            raise SystemExit("The guide must mention the stage folder and the helper file name")
        guide_name = args.guide_name or "UPDATE-" + args.release_date + "-AR.txt"
    print(json.dumps(package(args.release.absolute(), args.output.absolute(), args.release_name, args.release_date, args.stage_name, args.helper_name, guide_text, guide_name, args.new_migration, args.verify_route, args.schema_baseline)))
