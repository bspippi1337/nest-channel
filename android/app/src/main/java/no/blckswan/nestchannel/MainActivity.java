package no.blckswan.nestchannel;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String DEVICE_CODE_URL = "https://github.com/login/device/code";
    private static final String ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
    private static final String MODE_PREFERENCES = "nest.sync.mode";

    private WebView webView;
    private SecureStore secureStore;
    private SharedPreferences modePreferences;
    private LocalSyncManager localSyncManager;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(7, 16, 12));
        getWindow().setNavigationBarColor(Color.rgb(7, 16, 12));
        secureStore = new SecureStore(this);
        modePreferences = getSharedPreferences(MODE_PREFERENCES, MODE_PRIVATE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 16, 12));
        setContentView(webView);

        localSyncManager = new LocalSyncManager(this, new LocalSyncManager.Listener() {
            @Override
            public void onStatus(String state, int peers, String detail) {
                callJavaScript("window.NestLocalSync&&window.NestLocalSync.onStatus("
                        + JSONObject.quote(state) + "," + peers + "," + JSONObject.quote(detail) + ")");
            }

            @Override
            public void onWorkspace(String json) {
                callJavaScript("window.NestLocalSync&&window.NestLocalSync.onWorkspace(" + JSONObject.quote(json) + ")");
            }

            @Override
            public void onError(String message) {
                callJavaScript("window.NestLocalSync&&window.NestLocalSync.onError(" + JSONObject.quote(message) + ")");
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " NEST-Channel/main");

        webView.addJavascriptInterface(new NativeBridge(), "NativeHost");
        webView.addJavascriptInterface(new LocalBridge(), "NativeLocal");

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void saveSecret(String key, String value) {
            secureStore.put(key, value);
        }

        @JavascriptInterface
        public String loadSecret(String key) {
            if ("github_token".equals(key) && "local".equals(modePreferences.getString("mode", "github"))) {
                return "";
            }
            return secureStore.get(key);
        }

        @JavascriptInterface
        public void deleteSecret(String key) {
            secureStore.remove(key);
        }

        @JavascriptInterface
        public void setSyncMode(String mode) {
            String safeMode = "local".equals(mode) ? "local" : "github";
            modePreferences.edit().putString("mode", safeMode).apply();
            if ("github".equals(safeMode) && localSyncManager != null) localSyncManager.stop();
        }

        @JavascriptInterface
        public void openExternalUrl(String rawUrl) {
            try {
                Uri uri = Uri.parse(rawUrl);
                if (!"https".equalsIgnoreCase(uri.getScheme())) return;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void requestGitHubDeviceCode(String clientId) {
            if ("local".equals(modePreferences.getString("mode", "github"))) return;
            networkExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", clientId == null ? "" : clientId.trim());
                    form.put("scope", "public_repo read:user");
                    String body = postForm(DEVICE_CODE_URL, form);
                    callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onDeviceCode(" + JSONObject.quote(body) + ")");
                } catch (Exception error) {
                    reportNativeError(error);
                }
            });
        }

        @JavascriptInterface
        public void pollGitHubDeviceToken(String clientId, String deviceCode) {
            if ("local".equals(modePreferences.getString("mode", "github"))) return;
            networkExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", clientId == null ? "" : clientId.trim());
                    form.put("device_code", deviceCode == null ? "" : deviceCode.trim());
                    form.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
                    String body = postForm(ACCESS_TOKEN_URL, form);
                    callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onDeviceToken(" + JSONObject.quote(body) + ")");
                } catch (Exception error) {
                    reportNativeError(error);
                }
            });
        }
    }

    private final class LocalBridge {
        @JavascriptInterface
        public void start() {
            localSyncManager.start();
        }

        @JavascriptInterface
        public void stop() {
            localSyncManager.stop();
        }

        @JavascriptInterface
        public void sendWorkspace(String json) {
            localSyncManager.sendWorkspace(json);
        }

        @JavascriptInterface
        public void addPeer(String host) {
            localSyncManager.addManualPeer(host);
        }

        @JavascriptInterface
        public String getLocalAddress() {
            return localSyncManager.localAddress();
        }
    }

    private String postForm(String endpoint, Map<String, String> values) throws Exception {
        StringBuilder encoded = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (encoded.length() > 0) encoded.append('&');
            encoded.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8));
            encoded.append('=');
            encoded.append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setRequestProperty("User-Agent", "NEST-Channel-Android/main");

        byte[] bytes = encoded.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 400
                ? connection.getInputStream()
                : connection.getErrorStream();
        String response = readStream(stream);
        connection.disconnect();
        if (status < 200 || status >= 400) {
            throw new IllegalStateException("GitHub OAuth svarte " + status + ": " + response);
        }
        return response;
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void reportNativeError(Exception error) {
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onNativeError(" + JSONObject.quote(message) + ")");
    }

    private void callJavaScript(String script) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    private void performDefaultBack() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        webView.evaluateJavascript(
                "(window.NESTBack&&window.NESTBack.handle&&window.NESTBack.handle())?'handled':'pass'",
                result -> {
                    if ("\"handled\"".equals(result)) return;
                    performDefaultBack();
                });
    }

    @Override
    protected void onDestroy() {
        if (localSyncManager != null) localSyncManager.stop();
        networkExecutor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
