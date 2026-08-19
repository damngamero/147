package com.devil.app147;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Sideloaded self-update: downloads the APK attached to the latest GitHub
 * Release and hands it to the system installer. There is no Play Store
 * involved, so this is the only way a sideloaded build can update itself —
 * the version *check* (talking to the GitHub API) happens in plain JS via
 * fetch(); this plugin only does the two things that need native access:
 * writing the downloaded file, and launching the package installer intent.
 */
@CapacitorPlugin(name = "Updater147")
public class UpdaterPlugin extends Plugin {

    private static final String FILE_NAME = "147-update.apk";

    /** Whether this app is currently allowed to trigger the installer. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    private boolean canRequestInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true; // permission is manifest-only pre-8
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    /**
     * Sends the user to the per-app "install unknown apps" toggle. Android
     * gives no reliable completion callback for this screen, so the caller is
     * expected to re-check canInstall() when the app resumes.
     */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (canRequestInstalls()) {
            JSObject ret = new JSObject();
            ret.put("allowed", true);
            call.resolve(ret);
            return;
        }
        saveCall(call);
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "installPermissionResult");
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /** Downloads the given APK URL and hands it straight to the installer. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing url.");
            return;
        }
        if (!canRequestInstalls()) {
            call.reject("Install-from-unknown-sources permission not granted.");
            return;
        }

        // Network + file IO off the UI thread.
        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), FILE_NAME);
                download(url, out);
                getActivity().runOnUiThread(() -> {
                    try {
                        launchInstaller(out);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Could not launch the installer: " + e.getMessage(), e);
                    }
                });
            } catch (Exception e) {
                getActivity().runOnUiThread(() ->
                    call.reject("Download failed: " + e.getMessage(), e));
            }
        }).start();
    }

    private void download(String urlStr, File out) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) fos.write(buf, 0, n);
        } finally {
            conn.disconnect();
        }
    }

    private void launchInstaller(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }
}
