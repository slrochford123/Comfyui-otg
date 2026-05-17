# Google Play Upload Tutorial

This project publishes Android updates as an Android App Bundle (`.aab`).

## 1. Build the Play release file

From PowerShell:

```powershell
Set-Location C:\AI\OTG-Test2
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-play-release.ps1
```

When the script succeeds, upload this file to Google Play:

```text
C:\AI\OTG-Test2\android\app\build\outputs\bundle\release\app-release.aab
```

The script also saves release details here:

```text
C:\AI\OTG-Test2\android\release\latest-play-release.json
```

## 2. Confirm the signing key

Google Play requires the AAB to be signed with the upload key registered for the app.

Current local upload certificate:

```text
C:\AI\OTG-Test2\android\release\otg-upload-certificate.pem
```

If Play Console says the AAB is signed with the wrong key, the original upload key is missing locally. Use one of these fixes:

- Restore the original upload keystore to:

```text
C:\AI\OTG-Test2\android\release\otg-upload-key.jks
```

- Or reset the upload key in Play Console by uploading:

```text
C:\AI\OTG-Test2\android\release\otg-upload-certificate.pem
```

## 3. Upload in Google Play Console

1. Open Google Play Console.
2. Select the OTG app.
3. Go to **Test and release**.
4. Choose **Internal testing**, **Closed testing**, **Open testing**, or **Production**.
5. Select **Create new release**.
6. Under **App bundles**, click **Upload**.
7. Select:

```text
C:\AI\OTG-Test2\android\app\build\outputs\bundle\release\app-release.aab
```

8. Wait for Play Console to process the bundle.
9. Fill in release notes.
10. Click **Save as draft**.
11. Click **Review release**.
12. Resolve any warnings that Play Console marks as blocking.
13. Click **Start rollout** or **Send for review**.

## 4. If Play rejects the upload key

Use this path:

1. In Play Console, open **App integrity**.
2. Find the upload key section.
3. Choose the upload-key reset/change option.
4. Upload:

```text
C:\AI\OTG-Test2\android\release\otg-upload-certificate.pem
```

5. Wait for Google to approve the reset.
6. Re-run:

```powershell
Set-Location C:\AI\OTG-Test2
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-play-release.ps1
```

7. Upload the new AAB.

## 5. Files that must stay private

Do not commit or share:

```text
C:\AI\OTG-Test2\android\release\
C:\AI\OTG-Test2\android\keystore.properties
C:\AI\OTG-Test2\android\local.properties
```

These are ignored by git.
