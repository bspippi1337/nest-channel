package no.blckswan.nestchannel;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.view.ViewGroup;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

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
import java.io.ByteArrayInputStream;
import java.util.Collections;
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
    private static final String THREAT_PROFILE_KEY = "nest.high_threat.strict";
    private static final String PKCE_VERIFIER_KEY = "github_pkce_verifier";
    private static final String PKCE_STATE_KEY = "github_pkce_state";
    private static final SecureRandom RANDOM = new SecureRandom();

    private WebView webView;
    private SecureStore secureStore;
    private SharedPreferences modePreferences;
    private LocalSyncManager localSyncManager;
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private static final int MICROPHONE_PERMISSION_REQUEST = 7911;
    private PermissionRequest pendingMicRequest;
    private boolean scanningNestInvite = false;
    private volatile boolean pageReady = false;
    private volatile String pendingPkceResult = "";

    private boolean isHighThreatStrict() {
        return modePreferences == null || modePreferences.getBoolean(THREAT_PROFILE_KEY, true);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Prevent ordinary screenshots, screen recordings and Recents thumbnails.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().setStatusBarColor(Color.rgb(7, 16, 12));
        getWindow().setNavigationBarColor(Color.rgb(7, 16, 12));
        secureStore = new SecureStore(this);
        modePreferences = getSharedPreferences(MODE_PREFERENCES, MODE_PRIVATE);

        // Android 15/16 may lay out an edge-to-edge WebView beneath system bars.
        // Give the WebView a viewport that excludes status bar, cutouts, navigation
        // and the on-screen keyboard, including on devices where CSS env() is zero.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(7, 16, 12));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 16, 12));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(safe.bottom, keyboard.bottom);
            FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) webView.getLayoutParams();
            if (layout.leftMargin != safe.left || layout.topMargin != safe.top
                    || layout.rightMargin != safe.right || layout.bottomMargin != bottom) {
                layout.setMargins(safe.left, safe.top, safe.right, bottom);
                webView.setLayoutParams(layout);
            }
            return insets;
        });
        setContentView(root);
        ViewCompat.requestApplyInsets(root);

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
            public void onChat(String json) {
                callJavaScript("window.NestLocalSync&&window.NestLocalSync.onChat(" + JSONObject.quote(json) + ")");
            }

            @Override
            public void onChatReceipt(String id, String peerNodeId) {
                callJavaScript("window.NestLocalSync&&window.NestLocalSync.onReceipt("
                        + JSONObject.quote(id) + "," + JSONObject.quote(peerNodeId) + ")");
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
        // PTT is enabled only after a visible explicit radio-activation gesture.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " NEST-Channel/0.9.3");

        // Only bundled app-origin code may ever obtain access to native credentials.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    // JS policy is advisory; Android independently denies capture in strict mode.
                    if (isHighThreatStrict()) { request.deny(); return; }
                    Uri origin = request.getOrigin();
                    if (origin == null) { request.deny(); return; }
                    if (!"https".equalsIgnoreCase(origin.getScheme())
                            || !"appassets.androidplatform.net".equalsIgnoreCase(origin.getHost())) {
                        request.deny();
                        return;
                    }
                    for (String resource : request.getResources()) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            request.deny();
                            return;
                        }
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingMicRequest = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_PERMISSION_REQUEST);
                    }
                });
            }
            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMicRequest == request) pendingMicRequest = null;
            }
        });

        webView.addJavascriptInterface(new NativeBridge(), "NativeHost");
        webView.addJavascriptInterface(new LocalBridge(), "NativeLocal");

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                boolean bundled = "https".equalsIgnoreCase(uri.getScheme())
                        && "appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())
                        && String.valueOf(uri.getPath()).startsWith("/assets/");
                // Do not allow a navigated remote page to obtain the NativeHost JS bridge.
                return !bundled || !request.isForMainFrame();
            }
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (!"https".equalsIgnoreCase(uri.getScheme())) return blockedResource(403);
                if ("appassets.androidplatform.net".equalsIgnoreCase(host)) {
                    WebResourceResponse bundled = loader.shouldInterceptRequest(uri);
                    return bundled != null ? bundled : blockedResource(404);
                }
                // CSP additionally restricts fetch/connect; this native gate rejects
                // non-API traffic even if browser content is tampered with.
                if ("api.github.com".equalsIgnoreCase(host)) return null;
                return blockedResource(403);
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

    // The browser may read only narrowly documented WebView-held values.
    // Native-only OAuth verifier/state can never be queried from a JS frame.
    private static boolean webSecretAllowed(String key) {
        if (key == null) return false;
        if ("github_token".equals(key) || "github_client_id".equals(key)
                || "channel_password".equals(key)) return true;
        return key.matches("workspace_v091_\\.(?:offline|[a-f0-9]{64})");
    }

    private final class NativeBridge {
        @JavascriptInterface
        public boolean isHighThreatMode() { return isHighThreatStrict(); }

        @JavascriptInterface
        public void requestThreatProfileToggle() {
            runOnUiThread(() -> {
                final boolean wasStrict = isHighThreatStrict();
                final String message = wasStrict
                        ? "Standard beta aktiverer gammel GitHub- og lokal arbeidsflate-synk, som ikke har forward secrecy. Bruk bare ufarlige testdata. WebRTC kan eksponere IP. Deaktivere høyrisikoprofil?"
                        : "Høyrisikoprofil sperrer historiske synk-snapshots og live-radio. Nye chatmeldinger blir kun beholdt i minnet under økten og lagres ikke i arbeidsflatehistorikken. Eldre lokale chatter skjules og overskrives ved neste lagring. Aktivere streng profil?";
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("NEST sikkerhetsprofil")
                        .setMessage(message)
                        .setNegativeButton("Avbryt", (d, w) -> {})
                        .setPositiveButton(wasStrict ? "Bekreft nedgradering" : "Aktiver streng profil", (d, w) -> {
                            if (!modePreferences.edit().putBoolean(THREAT_PROFILE_KEY, !wasStrict).commit()) return;
                            // Tear down and erase all queued legacy snapshots on profile changes.
                            if (localSyncManager != null) localSyncManager.stop();
                            // Mute any active PTT stream before reloading the WebView policy.
                            webView.evaluateJavascript("window.NestPTT091&&window.NestPTT091.stop&&window.NestPTT091.stop()", result -> webView.reload());
                        })
                        .show();
            });
        }

        @JavascriptInterface
        public void saveSecret(String key, String value) {
            if (!webSecretAllowed(key)) throw new SecurityException("Secret key not permitted");
            secureStore.put(key, value);
        }

        @JavascriptInterface
        public boolean hasSecret(String key) {
            if (!webSecretAllowed(key)) return false;
            return secureStore.contains(key);
        }

        @JavascriptInterface
        public String loadSecret(String key) {
            if (!webSecretAllowed(key)) throw new SecurityException("Secret key not permitted");
            // Strict chat is native-only. Neither legacy shared-channel passwords
            // nor long-lived GitHub bearer tokens may cross into WebView JS.
            if (isHighThreatStrict() &&
                    ("github_token".equals(key) || "channel_password".equals(key))) return "";
            if ("github_token".equals(key) && "local".equals(modePreferences.getString("mode", "auto"))) return "";
            return secureStore.get(key);
        }

        @JavascriptInterface
        public void deleteSecret(String key) {
            if (!webSecretAllowed(key)) throw new SecurityException("Secret key not permitted");
            secureStore.remove(key);
        }

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
                        + "&scope=" + enc("repo read:user")
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
                String host = uri.getHost();
                String path = uri.getPath() == null ? "" : uri.getPath();
                boolean githubAllowed = "github.com".equalsIgnoreCase(host) && (
                        "/signup".equals(path) || "/notifications".equals(path)
                        || "/login/device".equals(path)
                        || "/settings/tokens/new".equals(path)
                        || "/settings/personal-access-tokens/new".equals(path));
                boolean helpAllowed = "chatgpt.com".equalsIgnoreCase(host)
                        && (path.isEmpty() || "/".equals(path));
                if (!githubAllowed && !helpAllowed) return;
                if (uri.getUserInfo() != null || uri.getFragment() != null) return;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String makeQrCode(String value) {
            try {
                if (value == null || !value.startsWith("NESTINV1.") || value.length() > 1200) return "";
                return qrDataUri(value);
            } catch (Exception ignored) { return ""; }
        }

        @JavascriptInterface
        public void scanInviteQr() {
            runOnUiThread(() -> {
                scanningNestInvite = true;
                new IntentIntegrator(MainActivity.this)
                        .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                        .setPrompt("Skann NEST 0.9.1-invitasjonen fra telefon A")
                        .setBeepEnabled(false)
                        .setOrientationLocked(false)
                        .initiateScan();
            });
        }

        @JavascriptInterface
        public void requestGitHubDeviceCode(String clientId) {
            if ("local".equals(modePreferences.getString("mode", "auto"))) return;
            networkExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", clientId == null ? "" : clientId.trim());
                    form.put("scope", "repo read:user");
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
        @JavascriptInterface public void start() {
            // Authoritative native policy: never receive or emit old snapshots
            // when strict profile is enabled, even if WebView JS misbehaves.
            localSyncManager.setLegacyWorkspaceAllowed(!isHighThreatStrict());
            localSyncManager.start();
        }
        @JavascriptInterface public void stop() { localSyncManager.stop(); }
        @JavascriptInterface public void sendWorkspace(String json) {
            if (isHighThreatStrict()) throw new SecurityException("Ingen forward secrecy for gamle arbeidsflatesnapshots.");
            localSyncManager.sendWorkspace(json);
        }
        @JavascriptInterface public int sendChat(String json) {
            return localSyncManager.sendChat(json);
        }
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
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_PERMISSION_REQUEST) return;
        PermissionRequest request = pendingMicRequest;
        pendingMicRequest = null;
        if (request == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED)
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else request.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            if (scanningNestInvite) {
                scanningNestInvite = false;
                if (result.getContents() != null)
                    callJavaScript("window.NestWizard091&&window.NestWizard091.onScan(" + JSONObject.quote(result.getContents()) + ")");
                return;
            }
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

    private static WebResourceResponse blockedResource(int status) {
        return new WebResourceResponse("text/plain", "UTF-8", status,
                status == 404 ? "Not Found" : "Forbidden",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
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
