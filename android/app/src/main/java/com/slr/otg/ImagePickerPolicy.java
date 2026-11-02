package com.slr.otg;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

/** Shared contract with lib/client/imageSources.ts; no storage-wide permissions. */
public final class ImagePickerPolicy {
    public static final String PHONE_STORAGE_MIME = "application/x-otg-phone-storage";

    private ImagePickerPolicy() {}

    public static List<String> acceptTypes(String[] accepts) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        if (accepts != null) {
            for (String value : accepts) {
                if (value == null) continue;
                for (String part : value.split(",")) {
                    String type = part.trim().toLowerCase(Locale.ROOT);
                    if (!type.isEmpty()) result.add(type);
                }
            }
        }
        return new ArrayList<>(result);
    }

    public static boolean isPhoneStorage(String[] accepts) {
        return acceptTypes(accepts).contains(PHONE_STORAGE_MIME);
    }

    public static List<String> originalTypes(String[] accepts) {
        List<String> result = acceptTypes(accepts);
        result.remove(PHONE_STORAGE_MIME);
        return result;
    }
}
