#!/bin/bash
# Runs ON the hosting account, sent over SSH by .github/workflows/deploy.yml (`ssh ... bash -s -- MODE ZIP STAGE HELPER SHA256`).
# It does what the update guides ask a person to do in the cPanel Terminal, in the same order and with the same packaged activator:
#   check   unpack the package beside the app and run the activator's --check (the app keeps running; nothing changes)
#   deploy  check, stop the Node.js app, run the activator (backup + switch), start the app, run --verify
#   verify  run --verify only (after a person pressed Start App in cPanel)
# Every STOP from the activator ends the run with the activator's own output; nothing is retried, deleted or restored here.
set -euo pipefail
MODE="${1:?mode}" ZIP="${2:-}" STAGE="${3:?stage folder}" HELPER="${4:?helper file}" SHA="${5:-}"
NODE="${YR_HOSTING_NODE:-/opt/alt/alt-nodejs22/root/usr/bin/node}"
APP_ROOT=yourrest-crm
cd "$HOME"
case "$STAGE$HELPER$ZIP" in *..*|*/*) echo "DEPLOY STOP: names must be plain file names"; exit 2;; esac

selector() { command -v cloudlinux-selector >/dev/null 2>&1; }
activator() { "$NODE" "$HOME/$STAGE/$HELPER" "$@"; }

unpack() {
  [ -n "$ZIP" ] && [ -f "$HOME/$ZIP" ] || { echo "DEPLOY STOP: package $ZIP not uploaded"; exit 2; }
  echo "$SHA  $HOME/$ZIP" | sha256sum -c --quiet - || { echo "DEPLOY STOP: package checksum differs from the one built"; exit 2; }
  if [ -e "$HOME/$STAGE" ]; then
    # A folder from an earlier run of the same package is reused; a different package in the same folder is refused.
    local sums; sums=$(python3 -c 'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read("RELEASE-SHA256SUMS.txt"))' "$HOME/$ZIP" | sha256sum | cut -d' ' -f1)
    [ "$sums" = "$(sha256sum < "$HOME/$STAGE/RELEASE-SHA256SUMS.txt" | cut -d' ' -f1)" ] || { echo "DEPLOY STOP: $STAGE already holds another package"; exit 2; }
    echo "PACKAGE ALREADY UNPACKED IN $STAGE"
  else
    mkdir "$HOME/$STAGE"
    python3 -c 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$HOME/$ZIP" "$HOME/$STAGE"
    echo "PACKAGE UNPACKED IN $STAGE"
  fi
}

case "$MODE" in
  check)
    unpack
    activator --check
    if selector; then echo "CLOUDLINUX SELECTOR: AVAILABLE"; cloudlinux-selector get --json --interpreter nodejs 2>&1 | head -c 2000; echo; else echo "CLOUDLINUX SELECTOR: NOT AVAILABLE (Stop/Start App stay in cPanel)"; fi
    ;;
  deploy)
    unpack
    activator --check
    if selector; then cloudlinux-selector stop --json --interpreter nodejs --app-root "$APP_ROOT"; echo; echo "APP STOPPED THROUGH CLOUDLINUX SELECTOR"
    else echo "CLOUDLINUX SELECTOR NOT AVAILABLE: THE ACTIVATOR STOPS THE RUNNING APP ITSELF"; fi
    out=$(mktemp); activator | tee "$out"
    grep -q '^START APP IN CPANEL$' "$out" || { echo "DEPLOY STOP: the activator did not switch the release"; exit 3; }
    if ! selector; then echo "START APP IN CPANEL NOW, THEN RUN THE WORKFLOW WITH mode=verify"; exit 4; fi
    cloudlinux-selector start --json --interpreter nodejs --app-root "$APP_ROOT"; echo; echo "APP STARTED THROUGH CLOUDLINUX SELECTOR"
    for attempt in 1 2 3 4 5 6; do
      if activator --verify | tee "$out"; then grep -q '^DEPLOYMENT VERIFIED$' "$out" && exit 0; fi
      echo "VERIFY ATTEMPT $attempt DID NOT PASS; WAITING FOR THE APP TO START"; sleep 10
    done
    echo "DEPLOY STOP: --verify did not pass after the start"; exit 5
    ;;
  verify)
    activator --verify
    ;;
  *) echo "DEPLOY STOP: unknown mode $MODE"; exit 2;;
esac
