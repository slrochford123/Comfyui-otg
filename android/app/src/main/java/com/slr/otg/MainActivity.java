package com.slr.otg;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.TextUtils;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "SlrOtgDownload";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installDownloadListener();
    }

    private void installDownloadListener() {
        Bridge capacitorBridge = getBridge();
        if (capacitorBridge == null) {
            Log.w(TAG, "Capacitor bridge was unavailable; download listener not installed.");
            return;
        }

        WebView webView = capacitorBridge.getWebView();
        if (webView == null) {
            Log.w(TAG, "Capacitor WebView was unavailable; download listener not installed.");
            return;
        }

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            startDownload(webView, url, userAgent, contentDisposition, mimeType)
        );
    }

    private void startDownload(
        WebView webView,
        String url,
        String userAgent,
        String contentDisposition,
        String mimeType
    ) {
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                Toast.makeText(this, "This download type is not supported.", Toast.LENGTH_SHORT).show();
                return;
            }

            DownloadManager.Request request = new DownloadManager.Request(uri);
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            request.setTitle(fileName);
            request.setDescription("Downloading from SLR OTG");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);

            if (!TextUtils.isEmpty(mimeType)) {
                request.setMimeType(mimeType);
            }

            String cookies = CookieManager.getInstance().getCookie(url);
            if (!TextUtils.isEmpty(cookies)) {
                request.addRequestHeader("Cookie", cookies);
            }

            if (!TextUtils.isEmpty(userAgent)) {
                request.addRequestHeader("User-Agent", userAgent);
            }

            String referer = webView.getUrl();
            if (!TextUtils.isEmpty(referer)) {
                request.addRequestHeader("Referer", referer);
            }

            DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                throw new IllegalStateException("Android DownloadManager is unavailable.");
            }

            downloadManager.enqueue(request);
            Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
        } catch (Exception exception) {
            Log.e(TAG, "Could not start Android download.", exception);
            Toast.makeText(this, "Could not start download.", Toast.LENGTH_LONG).show();
        }
    }
}
