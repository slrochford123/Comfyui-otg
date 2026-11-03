package com.slr.otg;

import static org.junit.Assert.*;
import org.junit.Test;

public class GoogleBrowserPolicyTest {
    @Test public void permitsOnlyGooglePickerAndSignIn() {
        assertTrue(GoogleBrowserPolicy.allows("https://photos.google.com/picker/session/autoclose"));
        assertTrue(GoogleBrowserPolicy.allows("https://accounts.google.com/o/oauth2/v2/auth?state=example"));
        for (String url : new String[]{null, "", "http://photos.google.com/", "javascript:alert(1)",
                "https://photos.google.com.evil.example/", "https://photos.google.com@evil.example/",
                "https://user@photos.google.com/", "https://photos.google.com:444/", "file:///secret"}) {
            assertFalse(String.valueOf(url), GoogleBrowserPolicy.allows(url));
        }
    }
}
