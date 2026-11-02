package com.slr.otg;

import static org.junit.Assert.*;
import android.content.Intent;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LocalImageIntentTest {
    @Test public void localImagesUseDocumentPickerWithReadOnlySelection() {
        Intent intent = LocalImageWebChromeClient.phoneStorageIntent(new String[]{"image/*", ImagePickerPolicy.PHONE_STORAGE_MIME}, true);
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.getAction());
        assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE));
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_LOCAL_ONLY, false));
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
        assertEquals("image/*", intent.getType());
        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.getFlags());
        assertEquals("content://com.android.providers.media.documents/root/images_root", intent.getParcelableExtra(DocumentsContract.EXTRA_INITIAL_URI).toString());
    }
    @Test public void mixedAcceptsAndSingleSelectionRemainSupported() {
        Intent intent = LocalImageWebChromeClient.phoneStorageIntent(new String[]{"image/*,video/*,audio/*", ImagePickerPolicy.PHONE_STORAGE_MIME}, false);
        assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, true));
        assertEquals("*/*", intent.getType());
        assertArrayEquals(new String[]{"image/*", "video/*", "audio/*"}, intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES));
    }
}
