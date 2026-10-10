from pathlib import Path
import hashlib, html, json, shutil, zipfile, os, re

source = Path(__file__).resolve().parent.parent
stage = source.parent / 'namecheap-upload'
archive = source.parent / 'Yourrest-CRM-Namecheap.zip'
if stage.exists(): shutil.rmtree(stage)
stage.mkdir(mode=0o700)
shutil.copytree(source/'dist/standalone', stage/'release')
shutil.copy2(source/'portable/launcher.cjs', stage/'app.cjs')
shutil.copy2(source/'portable/setup.cjs', stage/'setup.cjs')
(stage/'migration').mkdir(mode=0o700)
for name in ['initial.json','initial.sha256']:
    shutil.copy2(source/'migration'/name, stage/'migration'/name)
(stage/'package.json').write_text(json.dumps({'name':'yourrest-crm','version':'1.0.0','private':True,'engines':{'node':'>=22.16.0'},'scripts':{'setup':'node setup.cjs','start':'node app.cjs'}}, indent=2)+'\n')
guide = (source/'docs/NAMECHEAP-AR.md').read_text()
(stage/'README-AR.txt').write_text(guide)
shutil.copy2(source/'docs/ERP-SALES-VERIFICATION.json',stage/'VERIFICATION.json')
shutil.copy2(source/'docs/UPDATE-ERP-SALES-AR.txt',stage/'UPDATE-ERP-SALES-AR.txt')
shutil.copy2(source/'docs/LOCATION-NOTICE-VERIFICATION.json',stage/'LOCATION-NOTICE-VERIFICATION.json')
for name in ['WEEKDAYS-VERIFICATION.json','UPDATE-WEEKDAYS-AR.txt']:
    shutil.copy2(source/'docs'/name,stage/name)
for name in ['CUSTOMER-ENTRY-VERIFICATION.json','UPDATE-CUSTOMER-ENTRY-AR.txt','ERP-NAME-MATCH-VERIFICATION.json','UPDATE-ERP-NAME-MATCH-AR.txt','ERP-UNASSIGNED-VERIFICATION.json','UPDATE-ERP-UNASSIGNED-AR.txt','TARGET-GAUGE-VERIFICATION.json','UPDATE-TARGET-GAUGE-AR.txt','UI-NOTES-CLEANUP-VERIFICATION.json','UPDATE-UI-NOTES-AR.txt','TARGETS-PERFORMANCE-AUDIT.json','UPDATE-TARGET-REMAINING-AR.txt','COMPLETE-KPI-VERIFICATION.json','UPDATE-COMPLETE-KPI-AR.txt','COMPETITOR-INTELLIGENCE-VERIFICATION.json','COMPETITOR-INTELLIGENCE-BROWSER-VERIFICATION.json','UPDATE-COMPETITOR-INTELLIGENCE-AR.txt','UPDATE-OFFLINE-AR.txt','OFFLINE-VERIFICATION.json','OFFLINE-BROWSER-VERIFICATION.json','CUSTOMER-EDIT-VERIFICATION.json','CUSTOMER-EDIT-BROWSER-VERIFICATION.json','UPDATE-CUSTOMER-EDIT-AR.txt','ADMIN-DELETE-VERIFICATION.json','ADMIN-DELETE-BROWSER-VERIFICATION.json','UPDATE-ADMIN-DELETE-AR.txt','JOURNEY-TIMING-VERIFICATION.json','UPDATE-JOURNEY-TIMING-AR.txt','OPTIONAL-SALES-VERIFICATION.json','UPDATE-OPTIONAL-SALES-AR.txt','DAILY-REPORT-VERIFICATION.json','DAILY-REPORT-BROWSER-VERIFICATION.json','UPDATE-DAILY-REPORT-AR.txt','UPDATE-OFFLINE-ROUTES-AR.txt','OFFLINE-ROUTES-VERIFICATION.json','ANDROID-OFFLINE-BUILD-VERIFICATION.json']:
    shutil.copy2(source/'docs'/name,stage/name)
shutil.copy2(source/'docs/OFFLINE-ROUTES-VERIFICATION.json',stage/'VERIFICATION.json')
# A self-contained guide: no external assets, tracking or scripts.
lines=[]; block=False; table=False
def inline(value):
    escaped=html.escape(value)
    escaped=re.sub(r'\[([^\]]+)\]\((https://[^\s)]+)\)',r'<a href="\2">\1</a>',escaped)
    escaped=re.sub(r'`([^`]+)`',r'<code dir="ltr">\1</code>',escaped)
    return re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',escaped)
for line in guide.splitlines():
    if table and not line.startswith('|'):
        lines.append('</tbody></table>');table=False
    if line.startswith('```'):
        lines.append('</code></pre>' if block else '<pre dir="ltr"><code>'); block=not block
    elif block: lines.append(html.escape(line)+'\n')
    elif line.startswith('|'):
        cells=[c.strip() for c in line.strip('|').split('|')]
        if all(re.fullmatch(r'[-: ]+',c) for c in cells): continue
        if not table:
            lines.append('<table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in cells)+'</tr></thead><tbody>');table=True
        else: lines.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in cells)+'</tr>')
    elif line.startswith('# '): lines.append('<h1>'+html.escape(line[2:])+'</h1>')
    elif line.startswith('## '): lines.append('<h2>'+html.escape(line[3:])+'</h2>')
    elif line:
        lines.append('<p>'+inline(line)+'</p>')
(stage/'START-HERE.html').write_text('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yourrest CRM — Namecheap</title><style>body{font:17px/1.9 system-ui,sans-serif;max-width:900px;margin:36px auto;padding:0 24px;color:#14332d;background:#f9fbfa}h1,h2{color:#0c6b51;line-height:1.5}h2{margin-top:42px;border-top:1px solid #dce7e3;padding-top:20px}pre{padding:18px;background:#eaf0ee;border-radius:8px;overflow:auto;text-align:left;line-height:1.6}code{unicode-bidi:isolate;font-size:0.9em}a{color:#076caa}p{margin:10px 0}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:10px 14px;border:1px solid #dce7e3;text-align:right}th{background:#eaf0ee}@media print{body{font-size:12px}h2{break-after:avoid}pre{break-inside:avoid}}</style><main>'+''.join(lines)+'</main></html>')
code = stage/'source';code.mkdir()
for folder in ['app','components','db','drizzle','hooks','lib','portable','public','tests','vendor']:
    shutil.copytree(source/folder,code/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
shutil.copytree(source/'mobile/android', code/'mobile/android', ignore=shutil.ignore_patterns('build', '.gradle', 'local.properties', '*.p12', '*.jks', '*.keystore', '*storepass*', '__pycache__'))
(code/'scripts').mkdir()
for name in ['build-independent.mjs','build-offline-shell.mjs','package-namecheap.py','package-session-update.py','package-mobile-update.py','package-permissions-update.py','package-clients-map-update.py','package-journeys-update.py','package-my-targets-update.py','package-add-customer-update.py','package-mobile-navigation-update.py','package-activity-map-update.py','package-branding-update.py','package-compact-report-update.py','package-native-update.py','package-mobile-ux-update.py','package-map-search-update.py','package-rep-controls-update.py','package-customer-search-update.py','package-continuous-tracking-update.py','package-targets-performance-update.py','package-production-update.py','package-tracking-hours-update.py','package-trip-start-update.py','package-maps-fix-update.py','package-followups-update.py','package-rebuild-update.py','package-erp-sales-update.py','test-rebuild.mjs','build-brand-icons.mjs']:
    shutil.copy2(source/'scripts'/name,code/'scripts'/name)
(code/'docs').mkdir()
shutil.copy2(source/'docs/LOCATION-NOTICE-VERIFICATION.json',code/'docs/LOCATION-NOTICE-VERIFICATION.json')
for name in ['WEEKDAYS-VERIFICATION.json','UPDATE-WEEKDAYS-AR.txt']:
    shutil.copy2(source/'docs'/name,code/'docs'/name)
for name in ['CUSTOMER-ENTRY-VERIFICATION.json','UPDATE-CUSTOMER-ENTRY-AR.txt','ERP-NAME-MATCH-VERIFICATION.json','UPDATE-ERP-NAME-MATCH-AR.txt','ERP-UNASSIGNED-VERIFICATION.json','UPDATE-ERP-UNASSIGNED-AR.txt','TARGET-GAUGE-VERIFICATION.json','UPDATE-TARGET-GAUGE-AR.txt','UI-NOTES-CLEANUP-VERIFICATION.json','UPDATE-UI-NOTES-AR.txt','TARGETS-PERFORMANCE-AUDIT.json','UPDATE-TARGET-REMAINING-AR.txt','COMPLETE-KPI-VERIFICATION.json','UPDATE-COMPLETE-KPI-AR.txt','COMPETITOR-INTELLIGENCE-VERIFICATION.json','COMPETITOR-INTELLIGENCE-BROWSER-VERIFICATION.json','UPDATE-COMPETITOR-INTELLIGENCE-AR.txt','UPDATE-OFFLINE-AR.txt','OFFLINE-VERIFICATION.json','OFFLINE-BROWSER-VERIFICATION.json','CUSTOMER-EDIT-VERIFICATION.json','CUSTOMER-EDIT-BROWSER-VERIFICATION.json','UPDATE-CUSTOMER-EDIT-AR.txt','ADMIN-DELETE-VERIFICATION.json','ADMIN-DELETE-BROWSER-VERIFICATION.json','UPDATE-ADMIN-DELETE-AR.txt','JOURNEY-TIMING-VERIFICATION.json','UPDATE-JOURNEY-TIMING-AR.txt','OPTIONAL-SALES-VERIFICATION.json','UPDATE-OPTIONAL-SALES-AR.txt','DAILY-REPORT-VERIFICATION.json','DAILY-REPORT-BROWSER-VERIFICATION.json','UPDATE-DAILY-REPORT-AR.txt','UPDATE-OFFLINE-ROUTES-AR.txt','OFFLINE-ROUTES-VERIFICATION.json','ANDROID-OFFLINE-BUILD-VERIFICATION.json']:
    shutil.copy2(source/'docs'/name,code/'docs'/name)
shutil.copy2(source/'docs/NAMECHEAP-AR.md',code/'docs/NAMECHEAP-AR.md')
for name in ['UPDATE-LOGIN-AR.txt','UPDATE-MOBILE-AR.txt','UPDATE-PERMISSIONS-AR.txt','UPDATE-CLIENTS-MAP-AR.txt','UPDATE-JOURNEYS-AR.txt','UPDATE-MY-TARGETS-AR.txt','UPDATE-ADD-CUSTOMER-AR.txt','UPDATE-MOBILE-NAVIGATION-AR.txt','UPDATE-ACTIVITY-MAP-AR.txt','UPDATE-BRANDING-AR.txt','UPDATE-COMPACT-REPORT-AR.txt','UPDATE-ANDROID-AR.txt','UPDATE-MOBILE-UX-AR.txt','UPDATE-MAP-SEARCH-AR.txt','UPDATE-REP-CONTROLS-AR.txt','UPDATE-CUSTOMER-SEARCH-AR.txt','UPDATE-CONTINUOUS-TRACKING-AR.txt','UPDATE-TARGETS-PERFORMANCE-AR.txt','UPDATE-PRODUCTION-AR.txt','UPDATE-TRACKING-HOURS-AR.txt','PRODUCTION-BACKUP-AR.md','PRODUCTION-LOAD.md','production-load-baseline.json','production-load-first-hardening.json','production-load-tuned-transport.json','production-load-final.json','NAMECHEAP-VERIFICATION.json','ANDROID-TRACKING-HOURS-VERIFICATION.json','UPDATE-TRIP-START-AR.txt','ANDROID-TRIP-START-VERIFICATION.json','UPDATE-GOOGLE-MAPS-AR.txt','ANDROID-MAPS-LAUNCH-VERIFICATION.json','UPDATE-FOLLOWUPS-AR.txt','UPDATE-REBUILD-AR.txt','REBUILD-VERIFICATION.json','REBUILD-REGRESSION-VERIFICATION.json','ANDROID-REBUILD-VERIFICATION.json','rebuild-http-and-load.json','REBUILD-BROWSER-VERIFICATION.json','UPDATE-ERP-SALES-AR.txt','ERP-SALES-VERIFICATION.json','ERP-SALES-BROWSER-VERIFICATION.json','COMPETITORS-BROWSER-VERIFICATION.json']:
    shutil.copy2(source/'docs'/name,code/'docs'/name)
for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','next-env.d.ts','cloudflare-env.d.ts','next.config.ts','vite.config.ts','postcss.config.mjs','eslint.config.mjs','components.json','drizzle.config.ts','.npmrc']:
    shutil.copy2(source/name,code/name)
if (source/'docs/offline-browser-screenshots').is_dir():
    shutil.copytree(source/'docs/offline-browser-screenshots',code/'docs/offline-browser-screenshots',ignore=shutil.ignore_patterns('failure.png'))
if (source/'docs/rebuild-browser-screenshots').is_dir():
    shutil.copytree(source/'docs/rebuild-browser-screenshots',code/'docs/rebuild-browser-screenshots',ignore=shutil.ignore_patterns('failure.png'))
(code/'README.md').write_text('# Yourrest CRM — Namecheap\n\nIndependent email OTP edition. See ../START-HERE.html for deployment.\n\nNode >=22.16; install locked dependencies with pnpm, then pnpm build.\nThe runnable build is dist/standalone. Keep settings and production data outside the release.\nNo production credentials or runtime database are bundled.\n\nMigrations are append-only SQL files applied by portable/initialize.mjs. Startup applies pending migrations only to a recognized existing database after a private schema backup through portable/upgrade.mjs. Do not edit applied files. Migration0009 contains a manually managed authorization trigger. Migration0010 contains manually managed journey tables and indexes. Migration0011 adds continuous mobile workday tables. Preserve these when maintaining the schema. The installation ledger is authoritative, not the original Drizzle generation journal.\n\nRegression tests: node tests/crm-regression.mjs; node tests/email-auth.mjs; node tests/email-auth-ui.mjs; node tests/portable-storage.mjs; node tests/portable-local-mail.mjs; node tests/portable-hosting.mjs; node tests/portable-installer.mjs; node tests/namecheap-http.mjs (after build).\nThe package-install test accepts the absolute ZIP path and requires unzip; it changes only a temporary copy.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nActivity map checks: node tests/customer-map-activity.mjs; node tests/customer-map-ui.mjs; node tests/map-workspace-ui.mjs.\nMobile navigation checks: node tests/mobile-navigation-ui.mjs; node tests/pwa-install-ui.mjs.\nRep customer creation checks: node tests/rep-customer-create.mjs; node tests/rep-customer-ui.mjs.\nOwn targets checks: node tests/own-targets.mjs; node tests/my-targets-ui.mjs.\nJourney checks: node tests/journeys.mjs; node tests/journey-ui.mjs; node tests/startup-upgrade.mjs. The PWA reports GPS gaps explicitly and does not guarantee background location on locked devices.\nMobile app checks: node tests/pwa-foundation.mjs; node tests/pwa-install-ui.mjs.\nThe optional tests/pwa-browser.mjs needs Playwright with a Chromium binary and openssl; browser/device installation was not verified in the release environment.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nNative Android source: mobile/android; reproducible signed APK builder: mobile/android/tools/README.md. The signing key is delivered separately and must never be deployed. Native checks: node tests/mobile-route.mjs; node tests/native-tracking-ui.mjs. Migration0011 is append-only. Actual GPS on a physical phone still requires acceptance testing.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier Mobile UX release: checks include node tests/customer-directory-mobile.mjs; node tests/visit-mobile-ux.mjs; node tests/rep-mobile-shell.mjs; node tests/rep-customer-ui.mjs. The mobile UI loads from the server inside the existing Android APK; this UI release does not require reinstalling it. The cumulative update includes migration0011 for installations that have not received it; no migration was added for this UI release. See docs/UPDATE-MOBILE-UX-AR.txt.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier map search update: see docs/UPDATE-MAP-SEARCH-AR.txt. Search the authorized customer list, select a result, then use Directions to start acknowledged journey tracking before opening Maps. Selection itself opens no visit form. Android 1.0.1 (versionCode 2) adds native directions handoff after asynchronous tracking startup. Update the server, then install the same-signed new APK over the existing app without uninstalling; old APKs retain an extra Open directions link tap. No new database migration was added. Checks: node tests/customer-map-search.mjs; node tests/customer-map-ui.mjs; node tests/map-directions-ui.mjs; node tests/map-workspace-ui.mjs. Physical-phone appearance and GPS handoff still require acceptance testing.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier representative controls update: see docs/UPDATE-REP-CONTROLS-AR.txt. Representative accounts have no general page search or export controls and cannot manually edit or delete existing records. New customer, visit and follow-up creation remain available within the existing scope, with safe repeated saves and append-only follow-ups preserved. Map autocomplete and customer-picker search remain available. Supervisor and manager capabilities are unchanged. This cumulative server release includes the earlier map changes, migration0011 and the unchanged Android 1.0.1 APK (versionCode 2); no new migration or APK was introduced. Existing 1.0.1 installations need no reinstall.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier customer search update: see docs/UPDATE-CUSTOMER-SEARCH-AR.txt. The Clients page offers search for all authorized users, including representatives, by customer name, code, phones, contact names, city, region and address. It reuses the existing normalized map search and searches only supplied authorized customers. Representatives still have no export controls, manual editing/deletion of existing records, or general search on other pages. Map autocomplete, customer-picker search and allowed creation remain available. This is a cumulative server UI update with the unchanged Android 1.0.1 APK (versionCode 2); it adds no database migration, native or backend change. Existing 1.0.1 installations need no reinstall.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier continuous tracking update: see docs/UPDATE-CONTINUOUS-TRACKING-AR.txt. Android 1.0.2/code3 offers explicit 24-hour enrollment, background permission setup, continuous day rollover and permitted boot recovery. Rep manual day-stop is removed and denied server-side. Generic GPS dwell stops remain distinct from customer visits. Reinstall the same-signed APK over the current app and complete disclosure/permissions once. OS force-stop, permission removal and logout remain respected. Actual-phone 24-hour validation remains required.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier Targets & performance update: see docs/UPDATE-TARGETS-PERFORMANCE-AR.txt. A single authorized management page combines targets and KPIs with shared month, member, branch and search filters. Representative My targets remains separate and read-only. Future-month targets remain supported, while future performance is not evaluated. The top summary compares the selected product target, actual quantity, attainment and remaining quantity per member; server weighted attainment, KPI completeness and detail navigation remain scoped. Unknown inputs stay unavailable and future months show targets only. This cumulative server update includes the unchanged Android1.0.2/code3 APK and no new migration.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier production hardening: see docs/UPDATE-PRODUCTION-AR.txt and docs/PRODUCTION-BACKUP-AR.md. GPS reads only authenticated customer roots; visit writes load the selected customer graph, read-only CRM directories hydrate authorized records from compact metadata, regional contexts avoid unrelated history, and identity-only operations skip history. Body streams are bounded before JSON/multipart parsing. Administrative member changes use an optimistic token and commit-time relationship guards. Verified online database/attachment snapshots, safe retention and restore-to-new-directory tools are included. Daily scheduling still requires the documented cPanel cron setup. The load harness uses isolated synthetic data and does not establish Namecheap capacity. No new migration or Android APK is required.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier tracking hours: see docs/UPDATE-TRACKING-HOURS-AR.txt. Route observation is limited to06:00 inclusive through18:00 exclusive Asia/Riyadh. Server acceptance uses capture timestamps and permits later uploads of in-window offline observations. Android1.0.3/code4 releases location subscriptions outside the window and retains scheduled enrollment. Install the same-signed updated APK over the existing app. Historical data and business entry remain available; cutoff does not invent customer departure or visit duration. Physical-phone boundary and background acceptance remains required.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier trip-start fix: see docs/UPDATE-TRIP-START-AR.txt. Healthy tracking is reused; no duplicate postselection outbox drain. Background sync passes are bounded; paused native requests return an error. The Directions button waits at most30seconds and propagates cancellation before subsequent mutations and navigation. Pending points remain ack-only deleted and stay ordered before customer changes. Update both server and same-key Android1.0.4/code5 without uninstalling. Tracking remains06:00–18:00 Asia/Riyadh. No new migration. Controlled JS/native tests are not physical-device validation.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier Google Maps fix: see docs/UPDATE-GOOGLE-MAPS-AR.txt. Android1.0.5/code6 explicitly launches com.google.android.apps.maps with google.navigation after binding and exact-destination checks, then fixedHTTPS fallback on unavailable or denied launch. Narrow trusted main-frame Maps links also tolerate lost WebView gesture metadata. Other links retain gesture guards. Selection failures expose redacted actionable feedback; a post-preflight launch failure alone may expose a fixed retry destination. Phone version is reported without credentials. Upgrade server and install the same-key APK over the existing phone app without uninstalling. Tracking remains06:00–18:00 Riyadh; no migration. Physical-phone Maps launch remains unverified.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier follow-ups: standalone creation controls removed. Execute only open scheduled prior customer contacts; fixed customer, saved previous-source link, stale-source and absent-plan rejection. No new migration or Android build. See docs/UPDATE-FOLLOWUPS-AR.txt.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nEarlier rebuild: Android1.0.6/code7 + complete server. See docs/UPDATE-REBUILD-AR.txt and docs/REBUILD-VERIFICATION.json. Foreground visit GPS is independent of background enrollment; Directions opens immediately while recording is acknowledged separately. Request/location waits are bounded, cold-account loading preserves native enrollment, old evidence keeps immutable captured bindings, and new visits do not infer a stale stop. Same-owner scope changes with pending old-scope evidence halt and preserve the queue. Update server and install the same-signed APK over the existing app. No new server migration. Run node scripts/test-rebuild.mjs for broad local regressions; native, built HTTP, browser, load and package reports retain their exact environment limits.\n')
shutil.copytree(source/'migration',code/'migration')
shutil.copy2(source/'README.md',code/'README.md')
with (code/'README.md').open('a') as readme:
    readme.write('\nCompetitors workspace: management-only, sourced from authorized visit records, with normalized-name grouping, search, customer/contact history and protected quote attachments. New observations use the existing visit form; no new table or migration. See docs/COMPETITORS-BROWSER-VERIFICATION.json and tests/competitors.mjs, tests/competitors-ui.mjs, tests/competitors-browser.mjs.\n')
if (source/'docs/competitors-screenshots').is_dir():
    shutil.copytree(source/'docs/competitors-screenshots',code/'docs/competitors-screenshots',ignore=shutil.ignore_patterns('failure.png'))
if (source/'docs/erp-sales-screenshots').is_dir():
    shutil.copytree(source/'docs/erp-sales-screenshots',code/'docs/erp-sales-screenshots',ignore=shutil.ignore_patterns('failure.png'))
with (code/'README.md').open('a') as readme:
    readme.write('\nCompetitor intelligence update: reusable authorized name picker, optional editable speech-to-text notes and private quote files in visits/new follow-up observations; management profile tabs with distinct customers, quotes and source history, region/date scope, and explicitly observed-customer coverage. Android1.0.8/code9 adds native dictation without location enrollment. Update the same-signed APK for this capability. No additional database migration. See docs/COMPETITOR-INTELLIGENCE-VERIFICATION.json and docs/UPDATE-COMPETITOR-INTELLIGENCE-AR.txt.\n')
with (code/'README.md').open('a') as readme:
    readme.write('\nOffline route recovery: Android 1.0.9/code10 plus the matching server update supports previously authorized offline restarts within a seven-day account/scope-bound lease. Pending samples have no automatic age expiry; only acknowledged IDs are removed. The 100,000-point capacity refuses new samples rather than deleting pending evidence. Logout stops collection and retains pending evidence for the same account to authenticate and upload. See docs/UPDATE-OFFLINE-ROUTES-AR.txt. Physical-device acceptance remains required.\n')
if (source/'docs/competitor-intelligence-screenshots').is_dir():
    shutil.copytree(source/'docs/competitor-intelligence-screenshots',code/'docs/competitor-intelligence-screenshots',ignore=shutil.ignore_patterns('failure.png'))
if (source/'docs/daily-report-screenshots').is_dir():
    shutil.copytree(source/'docs/daily-report-screenshots',code/'docs/daily-report-screenshots',ignore=shutil.ignore_patterns('failure.png'))
files=sorted(p for p in stage.rglob('*') if p.is_file())
for p in files:
    if p.is_symlink() or p.name in ['settings.cjs','.env'] or p.suffix in ['.sqlite','.db','.pem','.p12','.jks','.keystore']:
        raise RuntimeError('Unexpected runtime/private file: '+str(p))
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(stage).as_posix()+'\n' for p in files)
(stage/'PACKAGE-CONTENTS.sha256').write_text(manifest)
temporary = archive.with_suffix('.zip.tmp')
with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(stage.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(stage).as_posix())
with zipfile.ZipFile(temporary) as z:
    bad=z.testzip()
    if bad: raise RuntimeError('ZIP corrupt: '+bad)
os.chmod(temporary,0o600)
temporary.replace(archive)
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'stage':str(stage),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
