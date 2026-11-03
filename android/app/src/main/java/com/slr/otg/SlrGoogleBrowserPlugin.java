package com.slr.otg;

import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** A browser-owned Custom Tab, never a Google page inside the app's WebView. */
@CapacitorPlugin(name = "SlrGoogleBrowser")
public class SlrGoogleBrowserPlugin extends Plugin {
    private ActivityResultLauncher<Intent> launcher;
    private CustomTabsServiceConnection connection;
    private CustomTabsSession session;
    private String browserPackage;
    private String activeId;
    private boolean tabVisible;
    private boolean closeRequested;
    private boolean bound;

    @Override public void load() {
        launcher = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            String id = activeId;
            activeId = null;
            tabVisible = false;
            closeRequested = false;
            if (id != null) notifyListeners("closed", new JSObject().put("id", id));
        });
        browserPackage = CustomTabsClient.getPackageName(getContext(), null);
        if (browserPackage == null) return;
        connection = new CustomTabsServiceConnection() {
            @Override public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                session = client.newSession(new CustomTabsCallback() {
                    @Override public void onNavigationEvent(int event, Bundle extras) {
                        if (event == TAB_SHOWN) {
                            tabVisible = true;
                            if (closeRequested) returnToApp();
                        } else if (event == TAB_HIDDEN) tabVisible = false;
                    }
                });
            }
            @Override public void onServiceDisconnected(ComponentName name) { session = null; }
        };
        bound = CustomTabsClient.bindCustomTabsService(getContext(), browserPackage, connection);
    }

    @PluginMethod public void open(PluginCall call) {
        String url = call.getString("url"), id = call.getString("id");
        if (!GoogleBrowserPolicy.allows(url) || id == null || !id.matches("[a-zA-Z0-9-]{16,80}")) {
            call.reject("Invalid Google browser request.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (activeId != null) { call.reject("Finish the current Google selection first."); return; }
            // Do not silently send users to an unrelated app or an embedded login.
            if (browserPackage == null || session == null) {
                call.reject("The secure Google panel is not ready. Try again, or enable a browser that supports Custom Tabs.");
                return;
            }
            CustomTabsIntent tab = new CustomTabsIntent.Builder(session)
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(Color.rgb(22, 12, 50)).build())
                .setShowTitle(true).setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                .setInstantAppsEnabled(false).build();
            tab.intent.setPackage(browserPackage);
            tab.intent.setData(Uri.parse(url));
            // No NEW_TASK: Back/X and completion return to this existing app task.
            activeId = id;
            closeRequested = false;
            try { launcher.launch(tab.intent); call.resolve(); }
            catch (RuntimeException error) { activeId = null; call.reject("Could not open the secure Google panel."); }
        });
    }

    @PluginMethod public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (activeId != null && activeId.equals(call.getString("id"))) {
                closeRequested = true;
                // Do not steal focus during a phone call or after the user leaves.
                // If hidden, defer until this Custom Tab is shown again.
                if (tabVisible) returnToApp();
            }
            call.resolve();
        });
    }

    private void returnToApp() {
        if (activeId == null) return;
        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        getActivity().startActivity(intent);
    }

    @Override protected void handleOnDestroy() {
        if (bound) getContext().unbindService(connection);
        if (launcher != null) launcher.unregister();
    }
}
