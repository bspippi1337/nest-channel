package no.blckswan.nestchannel;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String DEVICE_CODE_URL = "https://github.com/login/device/code";
    private static final String ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
    private static final String AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
    private static final String OAUTH_REDIRECT = "nestchannel://oauth/callback";
    private static final String MODE_PREFERENCES = "nest.sync.mode";
    private static final String PKCE_VERIFIER_KEY = "github_pkce_verifier";
    private static final String PKCE_STATE_KEY = "github_pkce_state";
    private static final SecureRandom RANDOM = new SecureRandom();

    private WebView webView;
    private SecureStore secureStore;
    private SharedPreferences modePreferences;
    private LocalSyncManager localSyncManager;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean pageReady = false;
    private volatile String pendingPkceResult = "";

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
            public void onPairingStatus(String state, int trustedPeers, String detail) {
                callJavaScript("window.NestLocalPairing&&window.NestLocalPairing.onStatus("
                        + JSONObject.quote(state) + "," + trustedPeers + "," + JSONObject.quote(detail) + ")");
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
        settings.setUserAgentString(settings.getUserAgentString() + " NEST-Channel/0.7");

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

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageReady = true;
                deliverPendingPkceResult();
            }
        });

        if (savedInstanceState == null) webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        else webView.restoreState(savedInstanceState);

        handleOAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void saveSecret(String key, String value) { secureStore.put(key, value); }

        @JavascriptInterface
        public String loadSecret(String key) {
            if ("github_token".equals(key) && "local".equals(modePreferences.getString("mode", "auto"))) return "";
            return secureStore.get(key);
        }

        @JavascriptInterface
        public void deleteSecret(String key) { secureStore.remove(key); }

        @JavascriptInterface
        public void setSyncMode(String mode) {
            String safeMode = "local".equals(mode) ? "local" : "auto".equals(mode) ? "auto" : "github";
            modePreferences.edit().putString("mode", safeMode).apply();
            if ("github".equals(safeMode) && localSyncManager != null) localSyncManager.stop();
        }

        @JavascriptInterface
        public String getBundledGitHubClientId() { return BuildConfig.NEST_GITHUB_CLIENT_ID; }

        @JavascriptInterface
        public String getGitHubAuthMode() {
            return hasPkceCredentials() ? "pkce" : "device";
        }

        @JavascriptInterface
        public void startGitHubPkce() {
            if ("local".equals(modePreferences.getString("mode", "auto"))) return;
            if (!hasPkceCredentials()) {
                reportNativeError(new IllegalStateException("Dette bygget mangler registrerte GitHub OAuth-credentials."));
                return;
            }
            try {
                String verifier = randomUrlToken(48);
                String state = randomUrlToken(24);
                String challenge = base64Url(MessageDigest.getInstance("SHA-256")
                        .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
                secureStore.put(PKCE_VERIFIER_KEY, verifier);
                secureStore.put(PKCE_STATE_KEY, state);
                String url = AUTHORIZE_URL
                        + "?client_id=" + enc(BuildConfig.NEST_GITHUB_CLIENT_ID)
                        + "&redirect_uri=" + enc(OAUTH_REDIRECT)
                        + "&scope=" + enc("public_repo read:user")
                        + "&state=" + enc(state)
                        + "&code_challenge=" + enc(challenge)
                        + "&code_challenge_method=S256";
                callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onPkceStarted&&window.NestGitHubAuth.onPkceStarted()");
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception error) {
                reportNativeError(error);
            }
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
            if ("local".equals(modePreferences.getString("mode", "auto"))) return;
            networkExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", clientId == null ? "" : clientId.trim());
                    form.put("scope", "public_repo read:user");
                    String body = postForm(DEVICE_CODE_URL, form);
                    callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onDeviceCode(" + JSONObject.quote(body) + ")");
                } catch (Exception error) { reportNativeError(error); }
            });
        }

        @JavascriptInterface
        public void pollGitHubDeviceToken(String clientId, String deviceCode) {
            if ("local".equals(modePreferences.getString("mode", "auto"))) return;
            networkExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", clientId == null ? "" : clientId.trim());
                    form.put("device_code", deviceCode == null ? "" : deviceCode.trim());
                    form.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
                    String body = postForm(ACCESS_TOKEN_URL, form);
                    callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onDeviceToken(" + JSONObject.quote(body) + ")");
                } catch (Exception error) { reportNativeError(error); }
            });
        }
    }

    private final class LocalBridge {
        @JavascriptInterface public void start() { localSyncManager.start(); }
        @JavascriptInterface public void stop() { localSyncManager.stop(); }
        @JavascriptInterface public void sendWorkspace(String json) { localSyncManager.sendWorkspace(json); }
        @JavascriptInterface public void addPeer(String host) { localSyncManager.addManualPeer(host); }
        @JavascriptInterface public String getLocalAddress() { return localSyncManager.localAddress(); }
        @JavascriptInterface public String getIdentityFingerprint() { return localSyncManager.identityFingerprint(); }
        @JavascriptInterface public int getTrustedPeerCount() { return localSyncManager.trustedPeerCount(); }
        @JavascriptInterface public void clearTrustedPeers() { localSyncManager.clearTrustedPeers(); }

        @JavascriptInterface
        public String createPairingQr() {
            try {
                String payload = localSyncManager.createPairingPayload();
                JSONObject result = new JSONObject();
                result.put("payload", payload);
                result.put("qr", qrDataUri(payload));
                result.put("name", localSyncManager.deviceLabel());
                result.put("fingerprint", localSyncManager.identityFingerprint());
                return result.toString();
            } catch (Exception error) {
                try { return new JSONObject().put("error", error.getMessage()).toString(); }
                catch (Exception ignored) { return "{\"error\":\"Pairingfeil\"}"; }
            }
        }

        @JavascriptInterface
        public void scanPairingQr() {
            runOnUiThread(() -> new IntentIntegrator(MainActivity.this)
                    .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                    .setPrompt("Skann NESTPAIR1-koden på den andre telefonen")
                    .setBeepEnabled(false)
                    .setOrientationLocked(false)
                    .initiateScan());
        }

        @JavascriptInterface
        public void acceptPairingInvite(String raw) { localSyncManager.acceptPairingInvite(raw); }
    }

    private boolean hasPkceCredentials() {
        return BuildConfig.NEST_GITHUB_CLIENT_ID != null && !BuildConfig.NEST_GITHUB_CLIENT_ID.isBlank()
                && BuildConfig.NEST_GITHUB_CLIENT_SECRET != null && !BuildConfig.NEST_GITHUB_CLIENT_SECRET.isBlank();
    }

    private void handleOAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        if (!"nestchannel".equalsIgnoreCase(uri.getScheme()) || !"oauth".equalsIgnoreCase(uri.getHost())
                || !"/callback".equals(uri.getPath())) return;
        String error = uri.getQueryParameter("error");
        String description = uri.getQueryParameter("error_description");
        if (error != null) {
            queuePkceResult(new JSONObjectSafe().error(description == null ? error : description));
            return;
        }
        String code = uri.getQueryParameter("code");
        String state = uri.getQueryParameter("state");
        String expectedState = secureStore.get(PKCE_STATE_KEY);
        String verifier = secureStore.get(PKCE_VERIFIER_KEY);
        if (code == null || state == null || verifier.isBlank() || expectedState.isBlank()
                || !MessageDigest.isEqual(state.getBytes(StandardCharsets.UTF_8), expectedState.getBytes(StandardCharsets.UTF_8))) {
            queuePkceResult(new JSONObjectSafe().error("GitHub OAuth state stemte ikke. Innlogging avbrutt."));
            return;
        }
        secureStore.remove(PKCE_STATE_KEY);
        networkExecutor.execute(() -> {
            try {
                Map<String, String> form = new LinkedHashMap<>();
                form.put("client_id", BuildConfig.NEST_GITHUB_CLIENT_ID);
                form.put("client_secret", BuildConfig.NEST_GITHUB_CLIENT_SECRET);
                form.put("code", code);
                form.put("redirect_uri", OAUTH_REDIRECT);
                form.put("code_verifier", verifier);
                String body = postForm(ACCESS_TOKEN_URL, form);
                secureStore.remove(PKCE_VERIFIER_KEY);
                queuePkceResult(body);
            } catch (Exception exchangeError) {
                secureStore.remove(PKCE_VERIFIER_KEY);
                queuePkceResult(new JSONObjectSafe().error(exchangeError.getMessage()));
            }
        });
        intent.setData(null);
    }

    private void queuePkceResult(String raw) {
        pendingPkceResult = raw == null ? "{}" : raw;
        deliverPendingPkceResult();
    }

    private void deliverPendingPkceResult() {
        if (!pageReady || pendingPkceResult.isBlank()) return;
        String raw = pendingPkceResult;
        pendingPkceResult = "";
        callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onPkceToken(" + JSONObject.quote(raw) + ")");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            if (result.getContents() == null) {
                callJavaScript("window.NestLocalPairing&&window.NestLocalPairing.onScanCanceled&&window.NestLocalPairing.onScanCanceled()");
            } else {
                callJavaScript("window.NestLocalPairing&&window.NestLocalPairing.onScanResult(" + JSONObject.quote(result.getContents()) + ")");
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String qrDataUri(String payload) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(payload, BarcodeFormat.QR_CODE, 720, 720);
        Bitmap bitmap = Bitmap.createBitmap(matrix.getWidth(), matrix.getHeight(), Bitmap.Config.ARGB_8888);
        for (int y = 0; y < matrix.getHeight(); y++) {
            for (int x = 0; x < matrix.getWidth(); x++) bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        bitmap.recycle();
        return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
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
        connection.setRequestProperty("User-Agent", "NEST-Channel-Android/0.7");
        byte[] bytes = encoded.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
        String response = readStream(stream);
        connection.disconnect();
        if (status < 200 || status >= 400) throw new IllegalStateException("GitHub OAuth svarte " + status + ": " + response);
        return response;
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void reportNativeError(Exception error) {
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        callJavaScript("window.NestGitHubAuth&&window.NestGitHubAuth.onNativeError(" + JSONObject.quote(message) + ")");
    }

    private void callJavaScript(String script) {
        runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(script, null); });
    }

    private static String randomUrlToken(int bytes) {
        byte[] raw = new byte[bytes]; RANDOM.nextBytes(raw); return base64Url(raw);
    }
    private static String base64Url(byte[] raw) {
        return Base64.encodeToString(raw, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
    private static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
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
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(window.NESTBack&&window.NESTBack.handle&&window.NESTBack.handle())?'handled':'pass'", result -> {
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

    private static final class JSONObjectSafe {
        String error(String message) {
            try { return new JSONObject().put("error", "oauth_error").put("error_description", message == null ? "OAuth-feil" : message).toString(); }
            catch (Exception ignored) { return "{\"error\":\"oauth_error\"}"; }
        }
    }
}
