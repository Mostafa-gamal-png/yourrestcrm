#!/bin/bash
# Runs ON the hosting account: scripts/hosting-cron.sh starts it for a request that .github/workflows/deploy.yml left through cPanel's API
# (scripts/deploy-cpanel.mjs). By hand, in cPanel's Terminal: bash hosting-deploy.sh MODE ZIP STAGE HELPER SHA256 (ZIP in the home folder).
# It does what the update guides ask a person to do in the cPanel Terminal, in the same order and with the same packaged activator:
#   check   unpack the package beside the app and run the activator's --check (the app keeps running; nothing changes)
#   deploy  check, stop the Node.js app, run the activator (backup + switch), start the app, run --verify
#   verify  run --verify only (after a person pressed Start App in cPanel)
#   diagnose  run the read-only check uploaded as yourrest-deploy/<HELPER> (no package, the app keeps running)
#   backup  take a daily backup with the live release's own tools, verify it, and print the command of the daily cron job
# Every STOP from the activator ends the run with the activator's own output; nothing is retried, deleted or restored here. One thing is
# put back: when the activator stops BEFORE the switch, the app this script stopped through the selector is started again, unchanged.
set -euo pipefail
MODE="${1:?mode}" ZIP="${2:-}" STAGE="${3:?stage folder}" HELPER="${4:?helper file}" SHA="${5:-}"
NODE="${YR_HOSTING_NODE:-/opt/alt/alt-nodejs22/root/usr/bin/node}"
PAUSE="${YR_VERIFY_PAUSE:-10}"
APP_ROOT=yourrest-crm
cd "$HOME"
case "$STAGE$HELPER$ZIP" in *..*|*/*) echo "DEPLOY STOP: names must be plain file names"; exit 2;; esac

selector() { command -v cloudlinux-selector >/dev/null 2>&1; }
activator() { "$NODE" "$HOME/$STAGE/$HELPER" "$@"; }
has_python() { command -v python3 >/dev/null 2>&1; }
# sel stop|start: what Stop App / Start App do in cPanel's Setup Node.js App, judged by the selector's own answer.
sel() {
  local out; out=$(cloudlinux-selector "$1" --json --interpreter nodejs --app-root "$APP_ROOT" 2>&1) || true
  if printf '%s' "$out" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("result") == "success" else 1)' 2>/dev/null; then return 0; fi
  echo "CLOUDLINUX SELECTOR $1 DID NOT SUCCEED: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1
}
# What the selector says of the app, without its environment variables (they may hold settings).
app_status() {
  cloudlinux-selector get --json --interpreter nodejs 2>/dev/null | python3 -c '
import json, sys
def apps(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "yourrest-crm" and isinstance(item, dict): yield item
            else: yield from apps(item)
    elif isinstance(value, list):
        for item in value: yield from apps(item)
found = next(apps(json.load(sys.stdin)), None)
fields = ("app_status", "nodejs_version", "domain", "app_uri", "startup_file")
print("APP IN SELECTOR: " + (", ".join(f"{k}={found[k]}" for k in fields if k in found) if found is not None else "NOT FOUND"))' 2>/dev/null || echo "APP IN SELECTOR: ITS ANSWER COULD NOT BE READ"
}

unpack() {
  [ -n "$ZIP" ] && [ -f "$HOME/$ZIP" ] || { echo "DEPLOY STOP: package $ZIP not uploaded"; exit 2; }
  echo "$SHA  $HOME/$ZIP" | sha256sum -c --quiet - || { echo "DEPLOY STOP: package checksum differs from the one built"; exit 2; }
  if [ -e "$HOME/$STAGE" ]; then
    # A folder from an earlier run of the same package is reused; a different package in the same folder is refused.
    local sums
    if has_python; then sums=$(python3 -c 'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read("RELEASE-SHA256SUMS.txt"))' "$HOME/$ZIP" | sha256sum | cut -d' ' -f1)
    else sums=$(unzip -p "$HOME/$ZIP" RELEASE-SHA256SUMS.txt | sha256sum | cut -d' ' -f1); fi
    [ "$sums" = "$(sha256sum < "$HOME/$STAGE/RELEASE-SHA256SUMS.txt" | cut -d' ' -f1)" ] || { echo "DEPLOY STOP: $STAGE already holds another package"; exit 2; }
    echo "PACKAGE ALREADY UNPACKED IN $STAGE"
  else
    mkdir "$HOME/$STAGE"
    if has_python; then python3 -c 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$HOME/$ZIP" "$HOME/$STAGE"
    else unzip -q "$HOME/$ZIP" -d "$HOME/$STAGE"; fi
    echo "PACKAGE UNPACKED IN $STAGE"
  fi
  [ -f "$HOME/$STAGE/$HELPER" ] || { echo "DEPLOY STOP: the package has no $HELPER"; exit 2; }
}

case "$MODE" in
  check)
    unpack
    activator --check
    if selector; then echo "CLOUDLINUX SELECTOR: AVAILABLE"; app_status; else echo "CLOUDLINUX SELECTOR: NOT AVAILABLE (Stop App and Start App stay in cPanel)"; fi
    ;;
  deploy)
    unpack
    activator --check
    stopped=0
    if selector; then sel stop; stopped=1; echo "APP STOPPED THROUGH CLOUDLINUX SELECTOR"
    else echo "CLOUDLINUX SELECTOR NOT AVAILABLE: THE ACTIVATOR STOPS THE RUNNING APP ITSELF"; fi
    out=$(mktemp); trap 'rm -f "$out"' EXIT
    set +e; activator | tee "$out"; code=${PIPESTATUS[0]}; set -e
    if [ "$code" != 0 ]; then
      if [ "$stopped" = 1 ] && ! grep -q 'RELEASE SWITCHED' "$out"; then
        echo "THE ACTIVATOR STOPPED BEFORE THE SWITCH: STARTING THE UNCHANGED APP AGAIN"
        sel start && echo "APP STARTED THROUGH CLOUDLINUX SELECTOR"
      fi
      echo "DEPLOY STOP: the activator ended with code $code; its lines above say why"; exit 3
    fi
    grep -qE '^(START APP IN CPANEL|ALREADY SWITCHED: .*)$' "$out" || { echo "DEPLOY STOP: the activator did not switch the release"; exit 3; }
    if [ "$stopped" = 1 ]; then sel start; echo "APP STARTED THROUGH CLOUDLINUX SELECTOR"; fi
    # Without the selector the host starts the app on the next request, unless Stop App was pressed in cPanel: --verify makes requests.
    for attempt in 1 2 3 4 5 6; do
      if activator --verify > "$out" 2>&1; then cat "$out"; grep -q '^DEPLOYMENT VERIFIED$' "$out" && exit 0; else cat "$out"; fi
      echo "VERIFY ATTEMPT $attempt DID NOT PASS; WAITING FOR THE APP TO START"; sleep "$PAUSE"
    done
    if [ "$stopped" = 0 ]; then echo "START APP IN CPANEL NOW, THEN ASK FOR mode=verify"; exit 4; fi
    echo "DEPLOY STOP: --verify did not pass after the start"; exit 5
    ;;
  verify)
    activator --verify
    ;;
  diagnose)
    # A read-only check uploaded beside this script (scripts/diagnose/*.cjs); it prints what it found and changes nothing.
    "$NODE" "$HOME/yourrest-deploy/$HELPER"
    ;;
  backup)
    # docs/PRODUCTION-BACKUP-AR.md by hand: the first backup, its verification, then the command the daily cron job runs. The app keeps
    # running; the backup tool removes only its own older backups beyond the 14 it keeps, after verifying them.
    OPS="$HOME/$APP_ROOT/release/operations" ROOT="$HOME/yourrest-crm-backups"
    json_field() { "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s.trim().split("\n").pop())[process.argv[1]];if(typeof v!=="string"||!v)process.exit(1);console.log(v);})' "$1"; }
    set +e; taken=$("$NODE" "$OPS/backup-scheduled.mjs" "$ROOT" 14 2>&1); code=$?; set -e
    echo "$taken"
    [ "$code" = 0 ] || { echo "BACKUP STOP: the backup did not finish (code $code)"; exit 3; }
    name=$(printf '%s' "$taken" | json_field backupName) || { echo "BACKUP STOP: the backup gave no name"; exit 3; }
    case "$name" in yourrest-backup-*) ;; *) echo "BACKUP STOP: unexpected backup name"; exit 3;; esac
    case "$name" in *[!A-Za-z0-9-]*) echo "BACKUP STOP: unexpected backup name"; exit 3;; esac
    "$NODE" "$OPS/restore.mjs" verify "$ROOT/$name" || { echo "BACKUP STOP: the new backup did not verify"; exit 3; }
    echo "BACKUP VERIFIED: $name"
    echo "SERVER UTC OFFSET: $(date +%z)"
    command=$("$NODE" "$OPS/backup-cron.mjs" "$ROOT" 14 | json_field command) || { echo "BACKUP STOP: the cron command could not be made"; exit 3; }
    echo "BACKUP CRON COMMAND: $command"
    ;;
  *) echo "DEPLOY STOP: unknown mode $MODE"; exit 2;;
esac
