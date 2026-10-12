Screenshots from `tests/tracking-gate-browser.mjs` (real Chromium, Android app emulated through `scripts/lib/native-bridge.mjs`, synthetic data only, no production data). They are copies from the final verification run of the 2026-10-12 release; the test writes new ones into a temporary folder each time it runs.

- `gate-setup.png`: a representative who has not activated tracking yet (phone viewport).
- `gate-permission.png`: consent given, but the "Allow all the time" permission is missing.
- `gate-phone-GPS-switched-off.png`: the phone's location service is off.
- `gate-outdated-app-version.png`: an app older than 1.0.7.
- `gate-browser-android-chrome.png`: a representative who opened the CRM in a phone browser.
- `report-coverage-panel.png`: the tracking coverage panel in the daily route report.
- `team-tracking-column.png`: the Tracking column on the team page.
