# Android Update Checklist

Use this when the web app changes need to be pushed into the Capacitor Android project.

1. From `C:\AI\OTG-Test2`, verify the web app:
   ```powershell
   npm run build
   ```

2. Sync the built web app and Capacitor config into Android:
   ```powershell
   npx cap sync android
   ```

3. Open Android Studio for final Gradle validation and device testing:
   ```powershell
   npx cap open android
   ```

4. In Android Studio:
   - Let Gradle sync finish.
   - Build `app`.
   - Run on a physical device or emulator.
   - Verify login, gallery playback, Generate, Production, Edit Video, and ComfyUI connectivity.

5. For release builds, confirm signing settings before creating an APK or AAB. Do not commit local keystore files or `keystore.properties`.
