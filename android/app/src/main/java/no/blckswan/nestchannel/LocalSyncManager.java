package no.blckswan.nestchannel;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class LocalSyncManager {
    interface Listener {
        void onStatus(String state, int peers, String detail);
        void onWorkspace(String json);
        void onPairingStatus(String state, int trustedPeers, String detail);
        void onError(String message);
    }

    private static final int PORT = 42420;
    private static final String GROUP_ADDRESS = "239.42.42.42";
    private static final int PROTOCOL_VERSION = 6;
    private static final long SESSION_ROTATE_MS = 15 * 60_000L;
    private static final long MAX_SIGNED_HELLO_SKEW_MS = 90_000L;
    private static final int MAX_FRAGMENT_COUNT = 128;
    private static final int MAX_ACTIVE_ASSEMBLIES = 8;
    private static final int MAX_WORKSPACE_BYTES = 2_000_000;
    private static final int MAX_PACKET_BYTES = 34_000;
    private static final long PEER_TIMEOUT_MS = 15_000L;
    private static final long ASSEMBLY_TIMEOUT_MS = 30_000L;
    private static final long PAIRING_TTL_MS = 5 * 60_000L;
    private static final String IDENTITY_ALIAS = "nest_local_identity_v1";
    private static final String TRUST_PREFS = "nest.local.trusted.v1";
    private static final String SYNC_PREFS = "nest.local.sync";
    private static final String PAIR_PREFIX = "NESTPAIR1.";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Context context;
    private final Listener listener;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Map<String, Peer> peers = new ConcurrentHashMap<>();
    private final Map<String, Assembly> assemblies = new ConcurrentHashMap<>();
    private final Set<InetAddress> manualTargets = ConcurrentHashMap.newKeySet();
    private final SharedPreferences trustedPrefs;
    private final String nodeId;
    private final String deviceLabel;
    private final KeyPair identityKeyPair;
    private final String identityPublicBase64;
    private final String identityFingerprint;

    private volatile String lastWorkspace = "";
    private volatile KeyPair sessionKeyPair;
    private volatile String sessionPublicBase64 = "";
    private volatile PairingOffer activeOffer;
    private volatile PendingPairing pendingPairing;

    private MulticastSocket socket;
    private WifiManager.MulticastLock multicastLock;
    private ExecutorService receiveExecutor;
    private ScheduledExecutorService scheduler;

    LocalSyncManager(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        SharedPreferences prefs = this.context.getSharedPreferences(SYNC_PREFS, Context.MODE_PRIVATE);
        trustedPrefs = this.context.getSharedPreferences(TRUST_PREFS, Context.MODE_PRIVATE);
        String storedNodeId = prefs.getString("node_id", "");
        if (storedNodeId == null || storedNodeId.isBlank()) {
            storedNodeId = UUID.randomUUID().toString();
            if (!prefs.edit().putString("node_id", storedNodeId).commit())
                throw new IllegalStateException("Enhetsidentitet kunne ikke lagres.");
        }
        nodeId = storedNodeId;
        String model = Build.MODEL == null || Build.MODEL.isBlank() ? "Android" : Build.MODEL.trim();
        deviceLabel = model + " · " + nodeId.substring(0, 4).toUpperCase();
        try {
            identityKeyPair = loadOrCreateIdentity();
            identityPublicBase64 = b64(identityKeyPair.getPublic().getEncoded());
            identityFingerprint = fingerprint(identityKeyPair.getPublic().getEncoded());
        } catch (Exception error) {
            throw new IllegalStateException("Kunne ikke initialisere lokal identitet", error);
        }
    }

    synchronized void start() {
        if (running.get()) {
            notifyStatus(peers.isEmpty() ? "searching" : "active",
                    peers.isEmpty() ? "Søker etter verifiserte NEST-peers" : "Verifisert lokal synk kjører");
            return;
        }
        try {
            rotateLocalSession();
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                multicastLock = wifiManager.createMulticastLock("nest-local-sync");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
            MulticastSocket newSocket = new MulticastSocket(null);
            newSocket.setReuseAddress(true);
            newSocket.bind(new InetSocketAddress(PORT));
            newSocket.setBroadcast(true);
            newSocket.setTimeToLive(1);
            newSocket.joinGroup(InetAddress.getByName(GROUP_ADDRESS));
            socket = newSocket;
            receiveExecutor = Executors.newSingleThreadExecutor();
            scheduler = Executors.newScheduledThreadPool(3);
            running.set(true);
            receiveExecutor.execute(this::receiveLoop);
            scheduler.scheduleAtFixedRate(this::announce, 0, 3, TimeUnit.SECONDS);
            scheduler.scheduleAtFixedRate(this::cleanup, 3, 3, TimeUnit.SECONDS);
            scheduler.scheduleAtFixedRate(this::rotateLocalSession, SESSION_ROTATE_MS,
                    SESSION_ROTATE_MS, TimeUnit.MILLISECONDS);
            scheduler.scheduleAtFixedRate(() -> {
                String workspace = lastWorkspace;
                if (!workspace.isBlank()) sendWorkspaceNow(workspace);
            }, 15, 15, TimeUnit.SECONDS);
            notifyStatus("searching", trustedPeerCount() == 0
                    ? "Ingen parede telefoner ennå · bruk pairing-QR"
                    : "Søker etter " + trustedPeerCount() + " verifiserte identiteter");
        } catch (Exception error) {
            stop();
            listener.onError(messageFor(error));
        }
    }

    // Each rotation replaces the ephemeral ECDH private key and erases access to
    // previous per-peer traffic keys. Never persist session keys or old traffic keys.
    // This offers SESSION separation, not complete forward secrecy for saved snapshots.
    private synchronized void rotateLocalSession() {
        try {
            KeyPair fresh = newEphemeralKeyPair();
            sessionKeyPair = fresh;
            sessionPublicBase64 = b64(fresh.getPublic().getEncoded());
            for (Peer peer : peers.values()) {
                peer.clearReplay();
                peer.key = null;
                peer.epoch = "";
            }
            assemblies.clear();
            if (running.get()) announce();
        } catch (Exception error) {
            // Fail closed: never continue to send under an expired traffic key.
            for (Peer peer : peers.values()) { peer.clearReplay(); peer.key = null; peer.epoch = ""; }
            if (running.get()) listener.onError("ECDH-nøkkelbytte mislyktes; lokal sending stoppet: " + messageFor(error));
        }
    }

    synchronized void stop() {
        running.set(false);
        if (socket != null) {
            try { socket.leaveGroup(InetAddress.getByName(GROUP_ADDRESS)); } catch (Exception ignored) {}
            socket.close();
            socket = null;
        }
        if (receiveExecutor != null) { receiveExecutor.shutdownNow(); receiveExecutor = null; }
        if (scheduler != null) { scheduler.shutdownNow(); scheduler = null; }
        if (multicastLock != null) {
            try { if (multicastLock.isHeld()) multicastLock.release(); } catch (Exception ignored) {}
            multicastLock = null;
        }
        for (Peer peer : peers.values()) { peer.clearReplay(); peer.key = null; }
        peers.clear();
        assemblies.clear();
        pendingPairing = null;
        sessionKeyPair = null;
        sessionPublicBase64 = "";
        listener.onStatus("offline", 0, "Lokal synk stoppet");
    }

    void sendWorkspace(String json) {
        if (json == null || json.isBlank()) return;
        lastWorkspace = json;
        ScheduledExecutorService activeScheduler = scheduler;
        if (!running.get() || activeScheduler == null) return;
        activeScheduler.execute(() -> sendWorkspaceNow(json));
    }

    void addManualPeer(String host) {
        String value = host == null ? "" : host.trim();
        if (value.isBlank()) return;
        ScheduledExecutorService activeScheduler = scheduler;
        if (!running.get() || activeScheduler == null) {
            listener.onError("Start lokal synk før du legger til en IP-adresse.");
            return;
        }
        activeScheduler.execute(() -> {
            try {
                InetAddress address = InetAddress.getByName(value);
                manualTargets.add(address);
                sendHelloTo(address, false);
                notifyStatus("searching", "Sendte verifiserbar håndhilsen til " + address.getHostAddress());
            } catch (Exception error) {
                listener.onError("Ugyldig eller utilgjengelig IP: " + messageFor(error));
            }
        });
    }

    String localAddress() {
        try {
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wifiManager == null || wifiManager.getConnectionInfo() == null) return "";
            int ip = wifiManager.getConnectionInfo().getIpAddress();
            if (ip == 0) return "";
            return (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + "." + ((ip >> 24) & 0xff);
        } catch (Exception ignored) { return ""; }
    }

    String identityFingerprint() { return identityFingerprint; }
    String deviceLabel() { return deviceLabel; }

    int trustedPeerCount() {
        int count = 0;
        for (String key : trustedPrefs.getAll().keySet()) if (key.startsWith("peer.")) count++;
        return count;
    }

    synchronized void clearTrustedPeers() {
        // A failed durable revocation MUST NOT report success or keep a socket
        // that can be restarted with the old trusted-device records.
        if (!trustedPrefs.edit().clear().commit()) {
            stop();
            listener.onError("Tilbaketrekking feilet. Lokal synk er stoppet; kontroller lagringen.");
            return;
        }
        for (Peer peer : peers.values()) { peer.clearReplay(); peer.key = null; }
        peers.clear();
        manualTargets.clear();
        activeOffer = null;
        pendingPairing = null;
        if (running.get()) rotateLocalSession();
        listener.onPairingStatus("cleared", 0, "Alle lokalt parede telefoner er glemt.");
        notifyStatus(running.get() ? "searching" : "offline", "Ingen verifiserte peers");
    }

    String createPairingPayload() {
        try {
            if (!running.get()) start();
            if (!running.get()) throw new IllegalStateException("Lokal synk kunne ikke startes.");
            byte[] secret = new byte[32];
            RANDOM.nextBytes(secret);
            PairingOffer offer = new PairingOffer(b64Url(secret), System.currentTimeMillis() + PAIRING_TTL_MS);
            activeOffer = offer;
            JSONObject payload = new JSONObject();
            payload.put("v", 1);
            payload.put("node", nodeId);
            payload.put("name", deviceLabel);
            payload.put("identity", identityPublicBase64);
            payload.put("fingerprint", identityFingerprint);
            payload.put("secret", offer.secret);
            payload.put("expires", offer.expiresAt);
            String host = localAddress();
            if (!host.isBlank()) payload.put("host", host);
            return PAIR_PREFIX + b64Url(payload.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("Kunne ikke lage pairingkode: " + messageFor(error), error);
        }
    }

    void acceptPairingInvite(String raw) {
        if (!running.get() || scheduler == null) start();
        ScheduledExecutorService activeScheduler = scheduler;
        if (!running.get() || activeScheduler == null) {
            listener.onPairingStatus("error", trustedPeerCount(), "Lokal synk kunne ikke startes.");
            return;
        }
        activeScheduler.execute(() -> {
            try {
                String value = raw == null ? "" : raw.trim();
                int marker = value.indexOf(PAIR_PREFIX);
                if (marker >= 0) value = value.substring(marker);
                if (!value.startsWith(PAIR_PREFIX)) throw new IllegalArgumentException("Ugyldig NESTPAIR1-kode.");
                byte[] decoded = Base64.decode(padBase64Url(value.substring(PAIR_PREFIX.length())), Base64.URL_SAFE | Base64.NO_WRAP);
                JSONObject invite = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
                if (invite.optInt("v", 0) != 1) throw new IllegalArgumentException("Ukjent pairingversjon.");
                long expires = invite.optLong("expires", 0);
                if (expires <= System.currentTimeMillis()) throw new IllegalArgumentException("Pairingkoden er utløpt.");
                String hostNode = invite.optString("node", "");
                String hostIdentity = invite.optString("identity", "");
                String secret = invite.optString("secret", "");
                String host = invite.optString("host", "");
                if (hostNode.isBlank() || hostIdentity.isBlank() || secret.isBlank() || host.isBlank())
                    throw new IllegalArgumentException("Pairingkoden mangler nødvendige data.");
                PublicKey expected = decodePublicKey(hostIdentity);
                String expectedFingerprint = fingerprint(expected.getEncoded());
                String advertisedFingerprint = invite.optString("fingerprint", "");
                if (!advertisedFingerprint.isBlank() && !constantTimeEquals(
                        advertisedFingerprint.replaceAll("[^A-Fa-f0-9]", "").toUpperCase(), expectedFingerprint))
                    throw new SecurityException("Pairingkodens identitetsfingeravtrykk stemmer ikke.");
                InetAddress address = InetAddress.getByName(host);
                PendingPairing pending = new PendingPairing(hostNode, invite.optString("name", "NEST-telefon"),
                        hostIdentity, secret, expires, address);
                pendingPairing = pending;
                manualTargets.add(address);
                sendPairRequest(pending);
                listener.onPairingStatus("pairing", trustedPeerCount(),
                        "Pairing-request sendt til " + pending.name + " · verifiserer identitet …");
            } catch (Exception error) {
                listener.onPairingStatus("rejected", trustedPeerCount(), messageFor(error));
            }
        });
    }

    private void announce() {
        try { for (InetAddress address : discoveryDestinations()) sendHelloTo(address, false); }
        catch (Exception error) { if (running.get()) listener.onError(messageFor(error)); }
    }

    private void sendHelloTo(InetAddress destination, boolean reply) throws Exception {
        if (sessionKeyPair == null || sessionPublicBase64.isBlank()) return;
        String nonce = randomToken(18);
        long sentAt = System.currentTimeMillis();
        String canonical = helloCanonical(nodeId, identityPublicBase64, sessionPublicBase64, nonce, sentAt);
        JSONObject hello = new JSONObject();
        hello.put("v", PROTOCOL_VERSION); hello.put("type", "hello"); hello.put("node", nodeId);
        hello.put("name", deviceLabel); hello.put("identity", identityPublicBase64);
        hello.put("session", sessionPublicBase64); hello.put("nonce", nonce); hello.put("sig", sign(canonical));
        hello.put("reply", reply); hello.put("sentAt", sentAt);
        sendPacket(hello.toString(), destination);
    }

    private void sendPairRequest(PendingPairing pending) throws Exception {
        if (System.currentTimeMillis() >= pending.expiresAt) throw new SecurityException("Pairingkoden er utløpt.");
        String nonce = randomToken(18);
        pending.requestNonce = nonce;
        String canonical = pairRequestCanonical(pending.hostNodeId, nodeId, identityPublicBase64, sessionPublicBase64, nonce);
        JSONObject request = new JSONObject();
        request.put("v", PROTOCOL_VERSION); request.put("type", "pair_request"); request.put("node", nodeId);
        request.put("name", deviceLabel); request.put("hostNode", pending.hostNodeId);
        request.put("identity", identityPublicBase64); request.put("session", sessionPublicBase64); request.put("nonce", nonce);
        request.put("proof", hmac(pending.secret, canonical)); request.put("sig", sign(canonical));
        sendPacket(request.toString(), pending.address);
    }

    private void sendPairAccept(InetAddress destination, String requesterNode, String requestNonce) throws Exception {
        String hostNonce = randomToken(18);
        String canonical = pairAcceptCanonical(requesterNode, nodeId, identityPublicBase64, sessionPublicBase64, requestNonce, hostNonce);
        JSONObject response = new JSONObject();
        response.put("v", PROTOCOL_VERSION); response.put("type", "pair_accept"); response.put("node", nodeId);
        response.put("name", deviceLabel); response.put("requesterNode", requesterNode);
        response.put("identity", identityPublicBase64); response.put("session", sessionPublicBase64);
        response.put("requestNonce", requestNonce); response.put("nonce", hostNonce); response.put("sig", sign(canonical));
        sendPacket(response.toString(), destination);
    }

    private void sendWorkspaceNow(String json) {
        for (Peer peer : peers.values()) {
            if (!peer.trusted || peer.key == null || peer.address == null) continue;
            try { sendWorkspaceToPeer(json, peer); }
            catch (Exception error) { if (running.get()) listener.onError("Lokal kryptert sending feilet: " + messageFor(error)); }
        }
    }

    private synchronized void sendWorkspaceToPeer(String json, Peer peer) throws Exception {
        byte[] compressed = gzip(json);
        if (compressed.length > MAX_WORKSPACE_BYTES) throw new SecurityException("Arbeidsdata overstiger sikker pakkestørrelse.");
        final String epoch = peer.epoch;
        if (peer.key == null || peer.sendChain == null || epoch.isBlank()) return;
        if (peer.nextSendSequence == Long.MAX_VALUE)
            throw new SecurityException("Sesjonsnummer er brukt opp; nytt nøkkelbytte kreves.");
        final long sequence = peer.nextSendSequence++;
        // Every workspace transport envelope consumes exactly one message key.
        // Releasing an old CK and MK limits historical network-capture exposure.
        MessageStep step = ratchetStep(peer.sendChain);
        Arrays.fill(peer.sendChain, (byte) 0);
        peer.sendChain = step.nextChain;
        byte[] iv = new byte[12]; RANDOM.nextBytes(iv);
        String encoded;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(step.messageKey, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aadForSequence(peer.nodeId, epoch, sequence));
            encoded = b64(cipher.doFinal(compressed));
        } finally {
            Arrays.fill(step.messageKey, (byte) 0);
        }
        int total = Math.max(1, (int) Math.ceil(encoded.length() / (double) MAX_PACKET_BYTES));
        if (total > MAX_FRAGMENT_COUNT) throw new SecurityException("For mange krypterte fragmenter.");
        String messageId = UUID.randomUUID().toString();
        for (int index = 0; index < total && running.get(); index++) {
            int start = index * MAX_PACKET_BYTES, end = Math.min(encoded.length(), start + MAX_PACKET_BYTES);
            JSONObject chunk = new JSONObject();
            chunk.put("v", PROTOCOL_VERSION); chunk.put("type", "secure_workspace"); chunk.put("node", nodeId);
            chunk.put("id", messageId); chunk.put("part", index + 1); chunk.put("total", total);
            chunk.put("epoch", epoch); chunk.put("seq", sequence);
            chunk.put("iv", b64(iv)); chunk.put("data", encoded.substring(start, end));
            sendPacket(chunk.toString(), peer.address);
        }
    }

    private Set<InetAddress> discoveryDestinations() throws Exception {
        Set<InetAddress> destinations = new LinkedHashSet<>();
        destinations.add(InetAddress.getByName(GROUP_ADDRESS)); destinations.add(InetAddress.getByName("255.255.255.255"));
        InetAddress directed = directedBroadcastAddress(); if (directed != null) destinations.add(directed);
        destinations.addAll(manualTargets); return destinations;
    }

    private void sendPacket(String message, InetAddress destination) throws Exception {
        MulticastSocket activeSocket = socket;
        if (!running.get() || activeSocket == null || destination == null) return;
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        synchronized (this) { activeSocket.send(new DatagramPacket(bytes, bytes.length, destination, PORT)); }
    }

    private void receiveLoop() {
        byte[] buffer = new byte[65_507];
        while (running.get()) {
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                MulticastSocket activeSocket = socket; if (activeSocket == null) return;
                activeSocket.receive(packet);
                receiveMessage(new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8), packet.getAddress());
            } catch (Exception error) { if (running.get()) listener.onError(messageFor(error)); }
        }
    }

    private synchronized void receiveMessage(String raw, InetAddress source) {
        try {
            JSONObject message = new JSONObject(raw);
            if (message.optInt("v", 0) != PROTOCOL_VERSION) return;
            String sender = message.optString("node", "");
            if (sender.isBlank() || sender.equals(nodeId)) return;
            String type = message.optString("type", "");
            if ("pair_request".equals(type)) { receivePairRequest(message, source); return; }
            if ("pair_accept".equals(type)) { receivePairAccept(message, source); return; }
            if ("hello".equals(type)) { receiveHello(message, source); return; }
            Peer peer = peers.get(sender);
            if (peer == null || !peer.trusted || peer.key == null) return;
            if (!"secure_workspace".equals(type)) return;
            final String epoch = message.optString("epoch", "");
            if (epoch.isBlank() || !epoch.equals(peer.epoch)) return;
            long sequence = message.optLong("seq", 0L);
            if (sequence <= 0L || sequence <= peer.highestReceivedSequence) return;
            // Never update an authenticated peer's IP address based on an
            // unauthenticated UDP ciphertext header, even if epoch matches.
            String messageId = message.optString("id", "");
            int part = message.optInt("part", 0), total = message.optInt("total", 0);
            String iv = message.optString("iv", ""), data = message.optString("data", "");
            if (!messageId.matches("[0-9a-fA-F-]{36}") || part < 1 || total < 1
                    || total > MAX_FRAGMENT_COUNT || part > total || iv.isBlank()
                    || data.isEmpty() || data.length() > MAX_PACKET_BYTES) return;
            if (peer.alreadyAccepted(messageId)) return;
            String key = sender + ":" + epoch + ":" + messageId;
            if (!assemblies.containsKey(key) && assemblies.size() >= MAX_ACTIVE_ASSEMBLIES) return;
            Assembly assembly = assemblies.computeIfAbsent(key, ignored -> new Assembly(total, iv, sequence));
            if (assembly.total != total || !assembly.iv.equals(iv) || assembly.sequence != sequence) {
                assemblies.remove(key); return;
            }
            assembly.add(part - 1, data); if (!assembly.complete()) return;
            assemblies.remove(key);
            byte[] nonce = Base64.decode(assembly.iv, Base64.NO_WRAP);
            if (nonce.length != 12 || peer.receiveChain == null) return;
            if (sequence - peer.highestReceivedSequence > 128) return; // bounded lost-message advancement
            // Work on a disposable copy. A forged packet must not consume the
            // receiver's chain state or prevent a real message from arriving.
            byte[] candidate = peer.receiveChain.clone();
            byte[] messageKey = null;
            final String workspace;
            try {
                for (long n = peer.highestReceivedSequence + 1; n <= sequence; n++) {
                    MessageStep step = ratchetStep(candidate);
                    Arrays.fill(candidate, (byte) 0);
                    candidate = step.nextChain;
                    if (messageKey != null) Arrays.fill(messageKey, (byte) 0);
                    messageKey = step.messageKey;
                }
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(messageKey, "AES"), new GCMParameterSpec(128, nonce));
                cipher.updateAAD(aadForSequence(sender, epoch, sequence));
                workspace = gunzip(cipher.doFinal(Base64.decode(assembly.join(), Base64.NO_WRAP)));
                if (sequence <= peer.highestReceivedSequence || !peer.rememberAuthenticated(messageId)) return;
                Arrays.fill(peer.receiveChain, (byte) 0);
                peer.receiveChain = candidate;
                candidate = null;
                peer.highestReceivedSequence = sequence;
            } finally {
                if (messageKey != null) Arrays.fill(messageKey, (byte) 0);
                if (candidate != null) Arrays.fill(candidate, (byte) 0);
            }
            peer.lastSeen = SystemClock.elapsedRealtime();
            listener.onWorkspace(workspace);
            notifyStatus("active", "AES-256-GCM · mottok verifisert oppdatering");
        } catch (Exception ignored) {}
    }

    private synchronized void receiveHello(JSONObject message, InetAddress source) throws Exception {
        String sender = message.optString("node", ""), identity = message.optString("identity", ""),
                session = message.optString("session", ""), nonce = message.optString("nonce", ""), sig = message.optString("sig", "");
        if (identity.isBlank() || session.isBlank() || nonce.isBlank() || sig.isBlank()) return;
        long sentAt = message.optLong("sentAt", 0L);
        long clockDistance = Math.abs(System.currentTimeMillis() - sentAt);
        if (sentAt <= 0L || clockDistance > MAX_SIGNED_HELLO_SKEW_MS) return;
        String trustedIdentity = trustedIdentity(sender);
        if (trustedIdentity.isBlank()) return;
        if (!constantTimeEquals(trustedIdentity, identity)) {
            listener.onPairingStatus("identity_changed", trustedPeerCount(),
                    "Identiteten til " + message.optString("name", sender) + " har endret seg. Lokal synk blokkert.");
            peers.remove(sender); return;
        }
        PublicKey identityKey = decodePublicKey(identity);
        if (!verify(identityKey, helloCanonical(sender, identity, session, nonce, sentAt), sig)) return;
        Peer peer = peers.computeIfAbsent(sender, ignored -> new Peer(sender));
        // A signed older HELLO may not roll a peer back to an obsolete ECDH key.
        // Persist the epoch acceptance floor so restarting the app does not
        // silently forget that older transport sessions were superseded.
        long savedFloor = trustedPrefs.getLong("hello_floor." + sender, 0L);
        if (sentAt <= peer.lastSignedHello || sentAt <= savedFloor) return;
        final String epoch = epochFor(sender, session);
        final boolean changed = !epoch.equals(peer.epoch);
        if (changed) {
            SecretKey nextKey = derivePeerKey(sender, session);
            if (!trustedPrefs.edit().putLong("hello_floor." + sender, sentAt).commit())
                throw new SecurityException("Kunne ikke beskytte nøkkelgenerasjon mot tilbakerulling.");
            peer.clearReplay();
            peer.key = nextKey;
            peer.epoch = epoch;
            initializeChains(peer);
            assemblies.keySet().removeIf(k -> k.startsWith(sender + ":"));
        }
        peer.lastSignedHello = sentAt;
        peer.address = source; peer.lastSeen = SystemClock.elapsedRealtime(); peer.name = message.optString("name", "NEST-telefon");
        peer.trusted = true; manualTargets.add(source);
        if (!message.optBoolean("reply", false)) sendHelloTo(source, true);
        notifyStatus("active", "Verifisert peer: " + peer.name);
        String workspace = lastWorkspace;
        if (!workspace.isBlank() && scheduler != null) scheduler.execute(() -> {
            try { sendWorkspaceToPeer(workspace, peer); } catch (Exception error) { listener.onError(messageFor(error)); }
        });
    }

    private synchronized void receivePairRequest(JSONObject message, InetAddress source) throws Exception {
        PairingOffer offer = activeOffer;
        if (offer == null || System.currentTimeMillis() >= offer.expiresAt || !nodeId.equals(message.optString("hostNode", ""))) return;
        String requesterNode = message.optString("node", ""), requesterIdentity = message.optString("identity", ""),
                requesterSession = message.optString("session", ""), nonce = message.optString("nonce", ""),
                proof = message.optString("proof", ""), sig = message.optString("sig", "");
        if (requesterNode.isBlank() || requesterIdentity.isBlank() || requesterSession.isBlank() || nonce.isBlank() || proof.isBlank() || sig.isBlank()) return;
        String canonical = pairRequestCanonical(nodeId, requesterNode, requesterIdentity, requesterSession, nonce);
        if (!constantTimeEquals(hmac(offer.secret, canonical), proof) || !verify(decodePublicKey(requesterIdentity), canonical, sig)) {
            listener.onPairingStatus("rejected", trustedPeerCount(), "Pairingbeviset ble avvist."); return;
        }
        trustPeer(requesterNode, requesterIdentity, message.optString("name", "NEST-telefon"));
        Peer peer = peers.computeIfAbsent(requesterNode, ignored -> new Peer(requesterNode));
        peer.address = source; peer.lastSeen = SystemClock.elapsedRealtime(); peer.name = message.optString("name", "NEST-telefon");
        peer.clearReplay();
        peer.key = derivePeerKey(requesterNode, requesterSession);
        peer.epoch = epochFor(requesterNode, requesterSession);
        initializeChains(peer);
        peer.trusted = true; manualTargets.add(source);
        sendPairAccept(source, requesterNode, nonce); activeOffer = null;
        listener.onPairingStatus("paired", trustedPeerCount(), "Paret med " + peer.name);
        notifyStatus("active", "Verifisert peer: " + peer.name);
    }

    private synchronized void receivePairAccept(JSONObject message, InetAddress source) throws Exception {
        PendingPairing pending = pendingPairing;
        if (pending == null || System.currentTimeMillis() >= pending.expiresAt) return;
        String sender = message.optString("node", "");
        if (!pending.hostNodeId.equals(sender) || !nodeId.equals(message.optString("requesterNode", ""))
                || !pending.requestNonce.equals(message.optString("requestNonce", ""))) return;
        String identity = message.optString("identity", ""), session = message.optString("session", ""),
                hostNonce = message.optString("nonce", ""), sig = message.optString("sig", "");
        if (!constantTimeEquals(pending.expectedIdentity, identity)) {
            listener.onPairingStatus("identity_changed", trustedPeerCount(), "Pairing avvist: vertens identitet stemmer ikke med QR-koden.");
            pendingPairing = null; return;
        }
        String canonical = pairAcceptCanonical(nodeId, sender, identity, session, pending.requestNonce, hostNonce);
        if (!verify(decodePublicKey(identity), canonical, sig)) {
            listener.onPairingStatus("rejected", trustedPeerCount(), "Pairing avvist: ugyldig vertssignatur.");
            pendingPairing = null; return;
        }
        trustPeer(sender, identity, message.optString("name", pending.name));
        Peer peer = peers.computeIfAbsent(sender, ignored -> new Peer(sender));
        peer.address = source; peer.lastSeen = SystemClock.elapsedRealtime(); peer.name = message.optString("name", pending.name);
        peer.clearReplay();
        peer.key = derivePeerKey(sender, session);
        peer.epoch = epochFor(sender, session);
        initializeChains(peer);
        peer.trusted = true; manualTargets.add(source); pendingPairing = null;
        listener.onPairingStatus("paired", trustedPeerCount(), "Paret med " + peer.name);
        notifyStatus("active", "Verifisert peer: " + peer.name);
        if (!lastWorkspace.isBlank()) sendWorkspaceToPeer(lastWorkspace, peer);
    }

    private KeyPair loadOrCreateIdentity() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore"); keyStore.load(null);
        if (keyStore.containsAlias(IDENTITY_ALIAS)) {
            return new KeyPair(keyStore.getCertificate(IDENTITY_ALIAS).getPublicKey(), (PrivateKey) keyStore.getKey(IDENTITY_ALIAS, null));
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(IDENTITY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false).build());
        return generator.generateKeyPair();
    }

    private KeyPair newEphemeralKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"), RANDOM); return generator.generateKeyPair();
    }

    private synchronized SecretKey derivePeerKey(String peerNodeId, String encodedSessionKey) throws Exception {
        KeyPair activeSession = sessionKeyPair;
        if (activeSession == null) throw new IllegalStateException("Mangler aktiv ECDH-sesjon");
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH"); agreement.init(activeSession.getPrivate());
        agreement.doPhase(decodePublicKey(encodedSessionKey), true);
        byte[] shared = agreement.generateSecret();
        try {
            // Session transcript includes both short-lived ECDH public keys in
            // deterministic node order; changing EITHER key creates a new epoch.
            byte[] transcript = sessionTranscript(peerNodeId, encodedSessionKey);
            Mac extract = Mac.getInstance("HmacSHA256");
            extract.init(new SecretKeySpec(MessageDigest.getInstance("SHA-256").digest(transcript), "HmacSHA256"));
            byte[] prk = extract.doFinal(shared);
            Mac expand = Mac.getInstance("HmacSHA256");
            expand.init(new SecretKeySpec(prk, "HmacSHA256"));
            expand.update("NEST-LOCAL-V6-TRAFFIC".getBytes(StandardCharsets.UTF_8));
            expand.update((byte) 1);
            byte[] keyBytes = expand.doFinal();
            Arrays.fill(prk, (byte) 0);
            try { return new SecretKeySpec(keyBytes, "AES"); }
            finally { Arrays.fill(keyBytes, (byte) 0); }
        } finally { Arrays.fill(shared, (byte) 0); }
    }

    private byte[] sessionTranscript(String peerNodeId, String peerSession) {
        boolean first = nodeId.compareTo(peerNodeId) <= 0;
        String context = first ? nodeId + ":" + sessionPublicBase64 + ":" + peerNodeId + ":" + peerSession
                : peerNodeId + ":" + peerSession + ":" + nodeId + ":" + sessionPublicBase64;
        return ("NEST-LOCAL-V6-TRANSCRIPT:" + context).getBytes(StandardCharsets.UTF_8);
    }
    private String epochFor(String peerNodeId, String peerSession) throws Exception {
        return fingerprint(sessionTranscript(peerNodeId, peerSession)).substring(0, 32);
    }
    // A directional HMAC chain under each authenticated ECDH epoch.
    // This is a *symmetric sender/receiver ratchet*, not Signal Double Ratchet.
    private void initializeChains(Peer peer) throws Exception {
        byte[] root = peer.key.getEncoded();
        if (root == null || root.length != 32) throw new SecurityException("Ugyldig sesjonsnøkkel");
        try {
            peer.sendChain = hmacBytes(root, "NEST-LOCAL-V6-CHAIN:" + peer.epoch + ":" + nodeId + ":" + peer.nodeId);
            peer.receiveChain = hmacBytes(root, "NEST-LOCAL-V6-CHAIN:" + peer.epoch + ":" + peer.nodeId + ":" + nodeId);
        } finally { Arrays.fill(root, (byte) 0); }
    }
    private static byte[] hmacBytes(byte[] key, String label) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(label.getBytes(StandardCharsets.UTF_8));
    }
    private static MessageStep ratchetStep(byte[] chain) throws Exception {
        if (chain == null || chain.length != 32) throw new SecurityException("Kjedetilstand mangler");
        byte[] mk = hmacBytes(chain, "NEST-LOCAL-V6-MESSAGE");
        try {
            return new MessageStep(mk, hmacBytes(chain, "NEST-LOCAL-V6-NEXT"));
        } catch (Exception error) {
            Arrays.fill(mk, (byte) 0);
            throw error;
        }
    }
    private static final class MessageStep {
        final byte[] messageKey, nextChain;
        MessageStep(byte[] messageKey, byte[] nextChain) { this.messageKey = messageKey; this.nextChain = nextChain; }
    }

    private byte[] aadForEpoch(String peerNodeId, String epoch) {
        return ("NEST-LOCAL-V6-AEAD:" + new String(aadFor(peerNodeId), StandardCharsets.UTF_8) + ":" + epoch)
                .getBytes(StandardCharsets.UTF_8);
    }
    private byte[] aadForSequence(String peerNodeId, String epoch, long sequence) {
        return (new String(aadForEpoch(peerNodeId, epoch), StandardCharsets.UTF_8)
                + ":seq:" + sequence).getBytes(StandardCharsets.UTF_8);
    }

    private byte[] aadFor(String peerNodeId) {
        String first = nodeId.compareTo(peerNodeId) <= 0 ? nodeId : peerNodeId;
        String second = nodeId.compareTo(peerNodeId) <= 0 ? peerNodeId : nodeId;
        return ("NEST-LOCAL-V6:" + first + ":" + second).getBytes(StandardCharsets.UTF_8);
    }

    private String sign(String canonical) throws Exception {
        Signature signer = Signature.getInstance("SHA256withECDSA"); signer.initSign(identityKeyPair.getPrivate(), RANDOM);
        signer.update(canonical.getBytes(StandardCharsets.UTF_8)); return b64(signer.sign());
    }

    private static boolean verify(PublicKey key, String canonical, String sig) throws Exception {
        Signature verifier = Signature.getInstance("SHA256withECDSA"); verifier.initVerify(key);
        verifier.update(canonical.getBytes(StandardCharsets.UTF_8)); return verifier.verify(Base64.decode(sig, Base64.NO_WRAP));
    }

    private static String hmac(String secret, String canonical) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Base64.decode(padBase64Url(secret), Base64.URL_SAFE | Base64.NO_WRAP), "HmacSHA256"));
        return b64Url(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
    }

    private static String helloCanonical(String node, String identity, String session, String nonce, long sentAt) {
        return "NEST-V6|hello|" + node + "|" + identity + "|" + session + "|" + nonce + "|" + sentAt;
    }
    private static String pairRequestCanonical(String host, String requester, String identity, String session, String nonce) {
        return "NEST-V6|pair-request|" + host + "|" + requester + "|" + identity + "|" + session + "|" + nonce;
    }
    private static String pairAcceptCanonical(String requester, String host, String identity, String session, String reqNonce, String hostNonce) {
        return "NEST-V6|pair-accept|" + requester + "|" + host + "|" + identity + "|" + session + "|" + reqNonce + "|" + hostNonce;
    }

    private String trustedIdentity(String peerNodeId) { return trustedPrefs.getString("peer." + peerNodeId, ""); }
    private void trustPeer(String peerNodeId, String identity, String name) throws Exception {
        decodePublicKey(identity);
        String existing = trustedIdentity(peerNodeId);
        if (!existing.isBlank() && !constantTimeEquals(existing, identity)) throw new SecurityException("En annen identitet er allerede lagret for denne telefonen.");
        if (!trustedPrefs.edit().putString("peer." + peerNodeId, identity)
                .putString("name." + peerNodeId, name == null ? "" : name).commit())
            throw new SecurityException("Kunne ikke lagre betrodd enhetsidentitet.");
    }

    private void cleanup() {
        long now = SystemClock.elapsedRealtime();
        peers.entrySet().removeIf(entry -> now - entry.getValue().lastSeen > PEER_TIMEOUT_MS);
        assemblies.entrySet().removeIf(entry -> now - entry.getValue().createdAt > ASSEMBLY_TIMEOUT_MS);
        if (activeOffer != null && System.currentTimeMillis() >= activeOffer.expiresAt) activeOffer = null;
        if (pendingPairing != null && System.currentTimeMillis() >= pendingPairing.expiresAt) {
            pendingPairing = null; listener.onPairingStatus("rejected", trustedPeerCount(), "Pairingkoden utløp.");
        }
        notifyStatus(running.get() ? (trustedActivePeerCount() == 0 ? "searching" : "active") : "offline",
                trustedActivePeerCount() == 0 ? (trustedPeerCount() == 0 ? "Pair en telefon med QR for lokal arbeidsdata" : "Ingen parede telefoner er tilgjengelige akkurat nå")
                        : "ECDSA-verifisert · AES-256-GCM · " + trustedActivePeerCount() + " peer" + (trustedActivePeerCount() == 1 ? "" : "s"));
    }

    private int trustedActivePeerCount() {
        int count = 0; for (Peer peer : peers.values()) if (peer.trusted && peer.key != null) count++; return count;
    }
    private void notifyStatus(String state, String detail) { listener.onStatus(state, trustedActivePeerCount(), detail); }

    private InetAddress directedBroadcastAddress() {
        try {
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE); if (wifiManager == null) return null;
            DhcpInfo dhcp = wifiManager.getDhcpInfo(); if (dhcp == null || dhcp.netmask == 0) return null;
            int broadcast = (dhcp.ipAddress & dhcp.netmask) | ~dhcp.netmask;
            return InetAddress.getByAddress(new byte[] {(byte)(broadcast & 0xff),(byte)((broadcast >> 8)&0xff),(byte)((broadcast >> 16)&0xff),(byte)((broadcast >> 24)&0xff)});
        } catch (Exception ignored) { return null; }
    }

    private static byte[] gzip(String value) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bytes)) { gzip.write(value.getBytes(StandardCharsets.UTF_8)); }
        return bytes.toByteArray();
    }
    private static String gunzip(byte[] compressed) throws Exception {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = gzip.read(buffer)) >= 0) {
                if (read > 0) {
                    if (result.size() + read > MAX_WORKSPACE_BYTES)
                        throw new SecurityException("Dekryptert arbeidsdata overskrider trygg grense.");
                    result.write(buffer, 0, read);
                }
            }
        }
        return result.toString(StandardCharsets.UTF_8);
    }
    private static PublicKey decodePublicKey(String encoded) throws Exception {
        return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.decode(encoded, Base64.NO_WRAP)));
    }
    private static String b64(byte[] value) { return Base64.encodeToString(value, Base64.NO_WRAP); }
    private static String b64Url(byte[] value) { return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static String padBase64Url(String value) { int pad = (4 - value.length() % 4) % 4; return value + "=".repeat(pad); }
    private static String randomToken(int bytes) { byte[] raw = new byte[bytes]; RANDOM.nextBytes(raw); return b64Url(raw); }
    private static String fingerprint(byte[] encoded) throws Exception {
        StringBuilder result = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(encoded)) result.append(String.format("%02X", b)); return result.toString();
    }
    private static boolean constantTimeEquals(String left, String right) {
        if (left == null || right == null) return false;
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }
    private static String messageFor(Exception error) {
        String message = error.getMessage(); return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static final class Peer {
        final String nodeId; volatile InetAddress address; volatile long lastSeen; volatile String name = "NEST-telefon";
        volatile SecretKey key; volatile boolean trusted;
        volatile String epoch = "";
        volatile byte[] sendChain, receiveChain;
        volatile long lastSignedHello;
        final LinkedHashSet<String> acceptedIds = new LinkedHashSet<>();
        volatile long nextSendSequence = 1L;
        volatile long highestReceivedSequence = 0L;
        synchronized void clearReplay() {
            acceptedIds.clear();
            if (sendChain != null) Arrays.fill(sendChain, (byte) 0);
            if (receiveChain != null) Arrays.fill(receiveChain, (byte) 0);
            sendChain = null;
            receiveChain = null;
            nextSendSequence = 1L;
            highestReceivedSequence = 0L;
        }
        synchronized boolean alreadyAccepted(String id) { return acceptedIds.contains(id); }
        synchronized boolean rememberAuthenticated(String id) {
            if (!acceptedIds.add(id)) return false;
            if (acceptedIds.size() > 1024) acceptedIds.remove(acceptedIds.iterator().next());
            return true;
        }
        Peer(String nodeId) { this.nodeId = nodeId; }
    }
    private static final class PairingOffer {
        final String secret; final long expiresAt;
        PairingOffer(String secret, long expiresAt) { this.secret = secret; this.expiresAt = expiresAt; }
    }
    private static final class PendingPairing {
        final String hostNodeId, name, expectedIdentity, secret; final long expiresAt; final InetAddress address; volatile String requestNonce = "";
        PendingPairing(String hostNodeId, String name, String expectedIdentity, String secret, long expiresAt, InetAddress address) {
            this.hostNodeId = hostNodeId; this.name = name; this.expectedIdentity = expectedIdentity; this.secret = secret; this.expiresAt = expiresAt; this.address = address;
        }
    }
    private static final class Assembly {
        final int total; final String iv; final long sequence; final List<String> parts;
        final long createdAt = SystemClock.elapsedRealtime(); int received;
        Assembly(int total, String iv, long sequence) {
            this.total = total; this.iv = iv; this.sequence = sequence;
            this.parts = new ArrayList<>(Collections.nCopies(total, null));
        }
        synchronized void add(int index, String value) { if (index < 0 || index >= total || parts.get(index) != null) return; parts.set(index, value); received++; }
        synchronized boolean complete() { return received == total; }
        synchronized String join() { StringBuilder b = new StringBuilder(); for (String part : parts) b.append(part == null ? "" : part); return b.toString(); }
    }
}
