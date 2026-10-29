#!/bin/bash
# Runs ON the hosting account, started every minute by the temporary cron line that scripts/deploy-cpanel.mjs adds through cPanel's API
# (the API moves files but runs no command). Nothing happens unless a request waits in ~/yourrest-deploy; then hosting-deploy.sh runs once
# for it, its output goes to log-<run> and its exit code to done-<run>, which the workflow reads back through the API. A start in a later
# minute finds the request already taken and ends at once.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"
D="$HOME/yourrest-deploy"
cd "$D" 2>/dev/null && [ -f request ] || exit 0
claim="taking.$$"
mv request "$claim" 2>/dev/null || exit 0
read -r RUN MODE ZIP STAGE HELPER SHA < "$claim" || true
rm -f "$claim"
case "$RUN" in ''|*[!0-9A-Za-z-]*) exit 0;; esac
echo "$MODE" > "running-$RUN"
trap 'rm -f "$D/running-$RUN"' EXIT
code=0
bash "$D/hosting-deploy.sh" "$MODE" "$ZIP" "$STAGE" "$HELPER" "$SHA" > "log-$RUN" 2>&1 < /dev/null || code=$?
echo "$code" > "done-$RUN.part" && mv "done-$RUN.part" "done-$RUN"
