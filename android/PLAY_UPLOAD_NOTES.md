# Google Play Upload Notes

Use the generated release bundle for Google Play:

```text
C:\AI\OTG-Test2\android\app\build\outputs\bundle\release\app-release.aab
```

Repeatable build command:

```powershell
Set-Location C:\AI\OTG-Test2
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-play-release.ps1
```

The release helper also writes:

```text
C:\AI\OTG-Test2\android\release\latest-play-release.json
C:\AI\OTG-Test2\android\release\otg-upload-certificate.pem
```

Important signing note:

Google Play accepts a release only when the app bundle is signed with the upload key registered in Play Console. If Play Console rejects the AAB with a signing-key mismatch, either restore the original upload keystore at:

```text
C:\AI\OTG-Test2\android\release\otg-upload-key.jks
```

or reset the upload key in Play Console and upload:

```text
C:\AI\OTG-Test2\android\release\otg-upload-certificate.pem
```

Do not commit `android\release\`, `android\keystore.properties`, or `android\local.properties`.
