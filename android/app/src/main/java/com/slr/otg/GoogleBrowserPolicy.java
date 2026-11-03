package com.slr.otg;

import java.net.URI;

/** The native bridge is only an opener for Google's trusted picker/sign-in UI. */
final class GoogleBrowserPolicy {
    static boolean allows(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && ("photos.google.com".equals(uri.getHost()) || "accounts.google.com".equals(uri.getHost()));
        } catch (Exception ignored) {
            return false;
        }
    }
}
