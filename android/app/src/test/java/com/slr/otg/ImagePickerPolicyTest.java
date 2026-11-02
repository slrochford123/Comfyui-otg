package com.slr.otg;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.Arrays;

public class ImagePickerPolicyTest {
    @Test public void normalPhotosRemainUnchanged() {
        assertFalse(ImagePickerPolicy.isPhoneStorage(new String[]{"image/*"}));
        assertFalse(ImagePickerPolicy.isPhoneStorage(null));
    }
    @Test public void detectsHintInCommaSeparatedWebviewAccepts() {
        String[] accepts = {"image/*, " + ImagePickerPolicy.PHONE_STORAGE_MIME, ".PNG"};
        assertTrue(ImagePickerPolicy.isPhoneStorage(accepts));
        assertEquals(Arrays.asList("image/*", ".png"), ImagePickerPolicy.originalTypes(accepts));
    }
    @Test public void retainsMixedAudioVideoAndMultipleImageTypes() {
        assertEquals(Arrays.asList("image/*", "video/*", "audio/*"), ImagePickerPolicy.originalTypes(new String[]{"image/*", "video/*,audio/*", ImagePickerPolicy.PHONE_STORAGE_MIME}));
    }
}
