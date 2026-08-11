package no.blckswan.nestchannel;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.SystemClock;
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
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
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
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class LocalSyncManager {
    interface Listener {
        void onStatus(String state, int peers, String detail);
        void onWorkspace(String json);
        void onError(String message);
    }

    private static final int PORT = 42420;
    private static final String GROUP_ADDRESS = "239.42.42.42";
    private static final int PROTOCOL_VERSION = 2;
    private static final int MAX_PACKET_BYTES = 34_000;
    private static final long PEER_TIMEOUT_MS = 15_000L;
    private static final long ASSEMBLY_TIMEOUT_MS = 30_000L;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Context context;
    private final Listener listener;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Map<String, Peer> peers = new ConcurrentHashMap<>();
    private final Map<String, Assembly> assemblies = new ConcurrentHashMap<>();
    private final Set<InetAddress> manualTargets = ConcurrentHashMap.newKeySet();
    private final String nodeId;
    private final String deviceLabel;
    private final KeyPair keyPair;
    private final String publicKeyBase64;

    private volatile String lastWorkspace = "";
    private MulticastSocket socket;
    private WifiManager.MulticastLock multicastLock;
    private ExecutorService receiveExecutor;
    private ScheduledExecutorService scheduler;

    LocalSyncManager(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        SharedPreferences prefs = this.context.getSharedPreferences("nest.local.sync", Context.MODE_PRIVATE);
        String storedNodeId = prefs.getString("node_id", "");
        if (storedNodeId == null || storedNodeId.isBlank()) {
            storedNodeId = UUID.randomUUID().toString();
            prefs.edit().putString("node_id", storedNodeId).apply();
        }
        nodeId = storedNodeId;
        String model = Build.MODEL == null || Build.MODEL.isBlank() ? "Android" : Build.MODEL.trim();
        deviceLabel = model + " · " + nodeId.substring(0, 4).toUpperCase();
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"), RANDOM);
            keyPair = generator.generateKeyPair();
            publicKeyBase64 = Base64.encodeToString(keyPair.getPublic().getEncoded(), Base64.NO_WRAP);
        } catch (Exception error) {
            throw new IllegalStateException("Kunne ikke initialisere lokal kryptering", error);
        }
    }

    synchronized void start() {
        if (running.get()) {
            notifyStatus("active", "Kryptert lokal synk kjører");
            return;
        }
        try {
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
            scheduler.scheduleAtFixedRate(() -> {
                String workspace = lastWorkspace;
                if (!workspace.isBlank()) sendWorkspaceNow(workspace);
            }, 15, 15, TimeUnit.SECONDS);
            notifyStatus("searching", "Søker etter krypterte NEST-peers");
        } catch (Exception error) {
            stop();
            listener.onError(messageFor(error));
        }
    }

    synchronized void stop() {
        running.set(false);
        if (socket != null) {
            try { socket.leaveGroup(InetAddress.getByName(GROUP_ADDRESS)); } catch (Exception ignored) {}
            socket.close();
            socket = null;
        }
        if (receiveExecutor != null) {
            receiveExecutor.shutdownNow();
            receiveExecutor = null;
        }
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
        if (multicastLock != null) {
            try { if (multicastLock.isHeld()) multicastLock.release(); } catch (Exception ignored) {}
            multicastLock = null;
        }
        peers.clear();
        assemblies.clear();
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
                notifyStatus("searching", "Sendte sikker håndhilsen til " + address.getHostAddress());
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
        } catch (Exception ignored) {
            return "";
        }
    }

    private void announce() {
        try {
            Set<InetAddress> destinations = discoveryDestinations();
            for (InetAddress address : destinations) sendHelloTo(address, false);
        } catch (Exception error) {
            if (running.get()) listener.onError(messageFor(error));
        }
    }

    private void sendHelloTo(InetAddress destination, boolean reply) throws Exception {
        JSONObject hello = new JSONObject();
        hello.put("v", PROTOCOL_VERSION);
        hello.put("type", "hello");
        hello.put("node", nodeId);
        hello.put("name", deviceLabel);
        hello.put("pub", publicKeyBase64);
        hello.put("crypto", "ECDH-P256+AES-256-GCM");
        hello.put("reply", reply);
        hello.put("sentAt", System.currentTimeMillis());
        sendPacket(hello.toString(), destination);
    }

    private void sendWorkspaceNow(String json) {
        for (Peer peer : peers.values()) {
            if (peer.key == null || peer.address == null) continue;
            try {
                sendWorkspaceToPeer(json, peer);
            } catch (Exception error) {
                if (running.get()) listener.onError("Lokal kryptert sending feilet: " + messageFor(error));
            }
        }
    }

    private void sendWorkspaceToPeer(String json, Peer peer) throws Exception {
        byte[] compressed = gzip(json);
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, peer.key, new GCMParameterSpec(128, iv));
        cipher.updateAAD(aadFor(peer.nodeId));
        String encoded = Base64.encodeToString(cipher.doFinal(compressed), Base64.NO_WRAP);
        String ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP);
        int total = Math.max(1, (int) Math.ceil(encoded.length() / (double) MAX_PACKET_BYTES));
        String messageId = UUID.randomUUID().toString();

        for (int index = 0; index < total && running.get(); index++) {
            int start = index * MAX_PACKET_BYTES;
            int end = Math.min(encoded.length(), start + MAX_PACKET_BYTES);
            JSONObject chunk = new JSONObject();
            chunk.put("v", PROTOCOL_VERSION);
            chunk.put("type", "secure_workspace");
            chunk.put("node", nodeId);
            chunk.put("id", messageId);
            chunk.put("part", index + 1);
            chunk.put("total", total);
            chunk.put("iv", ivBase64);
            chunk.put("data", encoded.substring(start, end));
            sendPacket(chunk.toString(), peer.address);
        }
    }

    private Set<InetAddress> discoveryDestinations() throws Exception {
        Set<InetAddress> destinations = new LinkedHashSet<>();
        destinations.add(InetAddress.getByName(GROUP_ADDRESS));
        destinations.add(InetAddress.getByName("255.255.255.255"));
        InetAddress directed = directedBroadcastAddress();
        if (directed != null) destinations.add(directed);
        destinations.addAll(manualTargets);
        return destinations;
    }

    private void sendPacket(String message, InetAddress destination) throws Exception {
        MulticastSocket activeSocket = socket;
        if (!running.get() || activeSocket == null || destination == null) return;
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        synchronized (this) {
            activeSocket.send(new DatagramPacket(bytes, bytes.length, destination, PORT));
        }
    }

    private void receiveLoop() {
        byte[] buffer = new byte[65_507];
        while (running.get()) {
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                MulticastSocket activeSocket = socket;
                if (activeSocket == null) return;
                activeSocket.receive(packet);
                String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
                receiveMessage(raw, packet.getAddress());
            } catch (Exception error) {
                if (running.get()) listener.onError(messageFor(error));
            }
        }
    }

    private void receiveMessage(String raw, InetAddress source) {
        try {
            JSONObject message = new JSONObject(raw);
            if (message.optInt("v", 0) != PROTOCOL_VERSION) return;
            String sender = message.optString("node", "");
            if (sender.isBlank() || sender.equals(nodeId)) return;
            String type = message.optString("type", "");

            if ("hello".equals(type)) {
                String peerPublicKey = message.optString("pub", "");
                if (peerPublicKey.isBlank()) return;
                Peer peer = peers.computeIfAbsent(sender, ignored -> new Peer(sender));
                peer.address = source;
                peer.lastSeen = SystemClock.elapsedRealtime();
                peer.name = message.optString("name", "NEST-telefon");
                peer.key = derivePeerKey(sender, peerPublicKey);
                manualTargets.add(source);
                if (!message.optBoolean("reply", false)) sendHelloTo(source, true);
                notifyStatus("active", "Sikker peer: " + peer.name);
                String workspace = lastWorkspace;
                ScheduledExecutorService activeScheduler = scheduler;
                if (!workspace.isBlank() && activeScheduler != null) {
                    activeScheduler.execute(() -> {
                        try { sendWorkspaceToPeer(workspace, peer); }
                        catch (Exception error) { listener.onError(messageFor(error)); }
                    });
                }
                return;
            }

            Peer peer = peers.get(sender);
            if (peer == null || peer.key == null) return;
            peer.address = source;
            peer.lastSeen = SystemClock.elapsedRealtime();
            if (!"secure_workspace".equals(type)) return;

            String messageId = message.optString("id", "");
            int part = message.optInt("part", 0);
            int total = message.optInt("total", 0);
            String iv = message.optString("iv", "");
            String data = message.optString("data", "");
            if (messageId.isBlank() || part < 1 || total < 1 || part > total || iv.isBlank() || data.isEmpty()) return;

            String key = sender + ":" + messageId;
            Assembly assembly = assemblies.computeIfAbsent(key, ignored -> new Assembly(total, iv, sender));
            if (assembly.total != total || !assembly.iv.equals(iv)) {
                assemblies.remove(key);
                return;
            }
            assembly.add(part - 1, data);
            if (!assembly.complete()) return;

            assemblies.remove(key);
            byte[] encrypted = Base64.decode(assembly.join(), Base64.NO_WRAP);
            byte[] ivBytes = Base64.decode(assembly.iv, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, peer.key, new GCMParameterSpec(128, ivBytes));
            cipher.updateAAD(aadFor(sender));
            String json = gunzip(cipher.doFinal(encrypted));
            listener.onWorkspace(json);
            notifyStatus("active", "AES-256-GCM · mottok sikker oppdatering");
        } catch (Exception ignored) {
            // Ignore unrelated, malformed or unauthenticated UDP traffic.
        }
    }

    private SecretKey derivePeerKey(String peerNodeId, String encodedPublicKey) throws Exception {
        byte[] publicBytes = Base64.decode(encodedPublicKey, Base64.NO_WRAP);
        PublicKey peerPublic = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(publicBytes));
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(keyPair.getPrivate());
        agreement.doPhase(peerPublic, true);
        byte[] sharedSecret = agreement.generateSecret();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(sharedSecret);
        digest.update(aadFor(peerNodeId));
        return new SecretKeySpec(digest.digest(), "AES");
    }

    private byte[] aadFor(String peerNodeId) {
        String first = nodeId.compareTo(peerNodeId) <= 0 ? nodeId : peerNodeId;
        String second = nodeId.compareTo(peerNodeId) <= 0 ? peerNodeId : nodeId;
        return ("NEST-LOCAL-V2:" + first + ":" + second).getBytes(StandardCharsets.UTF_8);
    }

    private void cleanup() {
        long now = SystemClock.elapsedRealtime();
        peers.entrySet().removeIf(entry -> now - entry.getValue().lastSeen > PEER_TIMEOUT_MS);
        assemblies.entrySet().removeIf(entry -> now - entry.getValue().createdAt > ASSEMBLY_TIMEOUT_MS);
        notifyStatus(running.get() ? (peers.isEmpty() ? "searching" : "active") : "offline",
                peers.isEmpty() ? "Ingen sikker peer funnet ennå" : "AES-256-GCM · " + peers.size() + " sikker peer" + (peers.size() == 1 ? "" : "s"));
    }

    private void notifyStatus(String state, String detail) {
        listener.onStatus(state, peers.size(), detail);
    }

    private InetAddress directedBroadcastAddress() {
        try {
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wifiManager == null) return null;
            DhcpInfo dhcp = wifiManager.getDhcpInfo();
            if (dhcp == null || dhcp.netmask == 0) return null;
            int broadcast = (dhcp.ipAddress & dhcp.netmask) | ~dhcp.netmask;
            byte[] quads = new byte[] {
                    (byte) (broadcast & 0xff),
                    (byte) ((broadcast >> 8) & 0xff),
                    (byte) ((broadcast >> 16) & 0xff),
                    (byte) ((broadcast >> 24) & 0xff)
            };
            return InetAddress.getByAddress(quads);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static byte[] gzip(String value) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bytes)) {
            gzip.write(value.getBytes(StandardCharsets.UTF_8));
        }
        return bytes.toByteArray();
    }

    private static String gunzip(byte[] compressed) throws Exception {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = gzip.read(buffer)) >= 0) {
                if (read > 0) result.write(buffer, 0, read);
            }
        }
        return result.toString(StandardCharsets.UTF_8);
    }

    private static String messageFor(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static final class Peer {
        final String nodeId;
        volatile InetAddress address;
        volatile long lastSeen;
        volatile String name = "NEST-telefon";
        volatile SecretKey key;

        Peer(String nodeId) {
            this.nodeId = nodeId;
        }
    }

    private static final class Assembly {
        final int total;
        final String iv;
        final String peerNodeId;
        final List<String> parts;
        final long createdAt = SystemClock.elapsedRealtime();
        int received;

        Assembly(int total, String iv, String peerNodeId) {
            this.total = total;
            this.iv = iv;
            this.peerNodeId = peerNodeId;
            this.parts = new ArrayList<>(Collections.nCopies(total, null));
        }

        synchronized void add(int index, String value) {
            if (index < 0 || index >= total || parts.get(index) != null) return;
            parts.set(index, value);
            received++;
        }

        synchronized boolean complete() {
            return received == total;
        }

        synchronized String join() {
            StringBuilder builder = new StringBuilder();
            for (String part : parts) builder.append(part == null ? "" : part);
            return builder.toString();
        }
    }
}
