# Android Download Test Wrapper

This repo owns the current Capacitor Android wrapper for SLR OTG.

The default Capacitor app id remains:

- `com.slr.otg`

For safe validation without replacing the installed production app, use the side-by-side TEST flavor:

- package id: `com.slr.otg.downloadtest`
- app label: `SLR OTG DOWNLOAD TEST`
- server URL: `https://comf-otg.comfyui-otg.win`

Build the debug TEST APK:

```bash
cd /home/shawn-rochford/AI/work/OTG-H3-Style-Dev/android
./gradlew :app:assembleDownloadtestDebug
```

Output:

```text
android/app/build/outputs/apk/downloadtest/debug/app-downloadtest-debug.apk
```

The native activity extends `com.getcapacitor.BridgeActivity` and installs a WebView `DownloadListener`. Download requests are handed to Android `DownloadManager` with the WebView session cookies, User-Agent, and Referer. This keeps `/api/admin/gallery-file?download=1` protected by normal OTG admin auth and does not expose remote GPU bearer tokens.

Do not build or install the `prod` flavor over `com.slr.otg` until promotion is explicitly approved.
