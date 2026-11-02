package com.slr.otg;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeReleaseCompatibilityTest {
    @Test public void retainsSpeechPermissionsWithoutBroadStorageAccess() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
        List<String> permissions = Arrays.asList(info.requestedPermissions);
        assertTrue(permissions.contains(Manifest.permission.INTERNET));
        assertTrue(permissions.contains(Manifest.permission.RECORD_AUDIO));
        assertTrue(permissions.contains(Manifest.permission.MODIFY_AUDIO_SETTINGS));
        assertFalse(permissions.contains(Manifest.permission.MANAGE_EXTERNAL_STORAGE));
        assertFalse(permissions.contains(Manifest.permission.READ_EXTERNAL_STORAGE));
        assertFalse(permissions.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE));
        assertEquals(36, info.applicationInfo.targetSdkVersion);
        assertEquals(24, info.applicationInfo.minSdkVersion);
    }
}
