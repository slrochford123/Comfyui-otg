package com.slr.otg;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Only the explicit Phone storage choice changes Capacitor's picker behavior. */
public class LocalImageWebChromeClient extends BridgeWebChromeClient {
    private final Bridge bridge;
    private final ActivityResultLauncher<Intent> localPicker;
    private ValueCallback<Uri[]> pending;
    private boolean allowMultiple;

    public LocalImageWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        localPicker = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            List<Uri> selected = new ArrayList<>();
            Intent data = result.getData();
            if (result.getResultCode() == Activity.RESULT_OK && data != null) {
                ClipData clips = data.getClipData();
                if (clips != null) {
                    for (int index = 0; index < clips.getItemCount(); index++) {
                        addContentUri(selected, clips.getItemAt(index).getUri());
                        if (!allowMultiple && !selected.isEmpty()) break;
                    }
                } else addContentUri(selected, data.getData());
            }
            finish(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        });
    }

    private static void addContentUri(List<Uri> selected, Uri uri) {
        if (uri != null && "content".equalsIgnoreCase(uri.getScheme()) && !selected.contains(uri)) selected.add(uri);
    }

    private void finish(Uri[] selected) {
        ValueCallback<Uri[]> callback = pending;
        pending = null;
        if (callback != null) callback.onReceiveValue(selected);
    }

    public void dispose() {
        finish(null);
        localPicker.unregister();
    }

    public static Intent phoneStorageIntent(String[] accepts, boolean multiple) {
        LinkedHashSet<String> mimeTypes = new LinkedHashSet<>();
        for (String type : ImagePickerPolicy.originalTypes(accepts)) {
            if (type.startsWith(".")) {
                String extension = type.substring(1);
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                if (mime == null && (extension.equals("heic") || extension.equals("heif"))) mime = "image/" + extension;
                // Unknown extensions must remain selectable; the web input's
                // original accept list validates them before the upload handler.
                mimeTypes.add(mime == null ? "*/*" : mime);
            } else if (type.matches("[a-z0-9!#$&^_.+*-]+/[a-z0-9!#$&^_.+*-]+")) mimeTypes.add(type);
        }
        if (mimeTypes.isEmpty()) mimeTypes.add("*/*");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        intent.setType(mimeTypes.size() == 1 ? mimeTypes.iterator().next() : "*/*");
        if (mimeTypes.size() > 1 && !mimeTypes.contains("*/*")) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse("content://com.android.providers.media.documents/root/images_root"));
        }
        return intent;
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (!ImagePickerPolicy.isPhoneStorage(params.getAcceptTypes()) || params.isCaptureEnabled()) {
            return super.onShowFileChooser(webView, callback, params);
        }
        if (pending != null) { callback.onReceiveValue(null); return true; }
        pending = callback;
        allowMultiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
        try {
            localPicker.launch(phoneStorageIntent(params.getAcceptTypes(), allowMultiple));
        } catch (ActivityNotFoundException | SecurityException exception) {
            finish(null);
            Toast.makeText(bridge.getContext(), "Phone storage could not open. Try Photos or enable the Android Files app.", Toast.LENGTH_LONG).show();
        }
        return true;
    }
}
