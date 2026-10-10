# Standalone open-source Android build

This alternative build uses independently published open-source Maven artifacts. It does not install the Android SDK or accept the Android SDK License Agreement. The normal Gradle project remains available for a machine with an installed SDK.

Requirements: Linux x86_64, Python 3.10+, full JDK 17+, network access for the first download, and the private app signing key supplied separately.

```bash
python3 tools/build-oss.py \
  --jdk /absolute/path/to/jdk-17 \
  --cache /absolute/path/to/android-tool-cache \
  --out /absolute/path/to/android-output \
  --keystore /private/path/yourrest-crm-release.p12 \
  --storepass-file /private/path/storepass.txt \
  --alias yourrest-crm
```

Run from `mobile/android`, or use the absolute script path. The output directory must be outside the Android source tree. Password contents are never passed on the command line or logged. Preserve the same private signing key for all updates to `org.yourrest.crm`; do not ship the key or password in the application, web update, or public source archive.

The script validates SHA-256 hashes before execution, compiles resources and Java, converts the app classes to DEX, aligns ZIP entries, signs the APK, and verifies its signature and alignment. It emits `Yourrest-CRM-Android.apk`, `build-verification.json`, and `apk-badging.txt`.

| Build input | Pinned version | Published license |
| --- | --- | --- |
| AAPT2 | 8.9.2-12782657 | Apache 2.0 |
| AOSP API and framework resources via Robolectric android-all | Android 15 / 15-robolectric-12650502 | Apache 2.0 |
| D8 / R8 | 8.9.35 | BSD 3-clause; included dependency notices apply |
| apksig | 8.9.2 | Apache 2.0 |

License provenance is the public artifact POM at the same repository path as each pinned JAR (listed in `build-oss.py`). Downloaded tool archives retain their LICENSE/NOTICE entries. Tools are not bundled into the app. The framework JAR is a compile-time library; only the app's own classes are converted into the APK.

This verifies packaging and signatures, not real-device behavior. The open-source framework includes nonpublic Android APIs, so code review must avoid hidden APIs; validation through the normal official-SDK Gradle build is also recommended before a store release. Background location, permission prompts, lock-screen behavior, reconnection, and battery limits require testing on real company phones.
