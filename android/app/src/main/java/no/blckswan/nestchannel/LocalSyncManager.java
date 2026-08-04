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

final class LocalSyncManager {
    interface Listener {
        void onStatus(String state, int peers, String detail);
        void onWorkspace(String json);
        void onError(String message);
    }

    private static final int PORT = 42420;
    private static final String GROUP_ADDRESS = "239.42.42.42";
    private static final int MAX_PACKET_BYTES = 36_000;
    private static final long PEER_TIMEOUT_MS = 12_000L;
    private static final long ASSEMBLY_TIMEOUT_MS = 30_000L;

    private final Context context;
    private final Listener listener;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Map<String, Long> peers = new ConcurrentHashMap<>();
    private final Map<String, Assembly> assemblies = new ConcurrentHashMap<>();
    private final String nodeId;
    private final String deviceLabel;

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
    }

    synchronized void start() {
        if (running.get()) {
            notifyStatus("active", "Lokal synk kjører");
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
            scheduler = Executors.newScheduledThreadPool(2);
            running.set(true);
            receiveExecutor.execute(this::receiveLoop);
            scheduler.scheduleAtFixedRate(this::announce, 0, 3, TimeUnit.SECONDS);
            scheduler.scheduleAtFixedRate(this::cleanup, 3, 3, TimeUnit.SECONDS);
            scheduler.scheduleAtFixedRate(() -> {
                String workspace = lastWorkspace;
                if (!workspace.isBlank()) sendWorkspaceNow(workspace);
            }, 15, 15, TimeUnit.SECONDS);
            notifyStatus("searching", "Søker på samme Wi-Fi eller hotspot");
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
            try {
                if (multicastLock.isHeld()) multicastLock.release();
            } catch (Exception ignored) {}
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

    private void announce() {
        try {
            JSONObject hello = new JSONObject();
            hello.put("v", 1);
            hello.put("type", "hello");
            hello.put("node", nodeId);
            hello.put("name", deviceLabel);
            hello.put("sentAt", System.currentTimeMillis());
            sendPacket(hello.toString());
        } catch (Exception error) {
            if (running.get()) listener.onError(messageFor(error));
        }
    }

    private void sendWorkspaceNow(String json) {
        try {
            String encoded = gzipToBase64(json);
            int total = Math.max(1, (int) Math.ceil(encoded.length() / (double) MAX_PACKET_BYTES));
            String messageId = UUID.randomUUID().toString();
            for (int index = 0; index < total && running.get(); index++) {
                int start = index * MAX_PACKET_BYTES;
                int end = Math.min(encoded.length(), start + MAX_PACKET_BYTES);
                JSONObject chunk = new JSONObject();
                chunk.put("v", 1);
                chunk.put("type", "workspace");
                chunk.put("node", nodeId);
                chunk.put("id", messageId);
                chunk.put("part", index + 1);
                chunk.put("total", total);
                chunk.put("data", encoded.substring(start, end));
                sendPacket(chunk.toString());
            }
        } catch (Exception error) {
            if (running.get()) listener.onError(messageFor(error));
        }
    }

    private void sendPacket(String message) throws Exception {
        MulticastSocket activeSocket = socket;
        if (!running.get() || activeSocket == null) return;
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        Set<InetAddress> destinations = new LinkedHashSet<>();
        destinations.add(InetAddress.getByName(GROUP_ADDRESS));
        destinations.add(InetAddress.getByName("255.255.255.255"));
        InetAddress directed = directedBroadcastAddress();
        if (directed != null) destinations.add(directed);

        synchronized (this) {
            for (InetAddress destination : destinations) {
                try {
                    activeSocket.send(new DatagramPacket(bytes, bytes.length, destination, PORT));
                } catch (Exception ignored) {
                    // One transport may be blocked while multicast or directed broadcast still works.
                }
            }
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
                receiveMessage(raw);
            } catch (Exception error) {
                if (running.get()) listener.onError(messageFor(error));
            }
        }
    }

    private void receiveMessage(String raw) {
        try {
            JSONObject message = new JSONObject(raw);
            if (message.optInt("v", 0) != 1) return;
            String sender = message.optString("node", "");
            if (sender.isBlank() || sender.equals(nodeId)) return;

            peers.put(sender, SystemClock.elapsedRealtime());
            String type = message.optString("type", "");
            if ("hello".equals(type)) {
                notifyStatus("active", "Fant " + message.optString("name", "NEST-telefon"));
                return;
            }
            if (!"workspace".equals(type)) return;

            String messageId = message.optString("id", "");
            int part = message.optInt("part", 0);
            int total = message.optInt("total", 0);
            String data = message.optString("data", "");
            if (messageId.isBlank() || part < 1 || total < 1 || part > total || data.isEmpty()) return;

            String key = sender + ":" + messageId;
            Assembly assembly = assemblies.computeIfAbsent(key, ignored -> new Assembly(total));
            if (assembly.total != total) {
                assemblies.remove(key);
                return;
            }
            assembly.add(part - 1, data);
            if (!assembly.complete()) return;

            assemblies.remove(key);
            String json = gunzipFromBase64(assembly.join());
            listener.onWorkspace(json);
            notifyStatus("active", "Mottok oppdatering fra lokalnettet");
        } catch (Exception ignored) {
            // Ignore unrelated UDP traffic on the shared port.
        }
    }

    private void cleanup() {
        long now = SystemClock.elapsedRealtime();
        peers.entrySet().removeIf(entry -> now - entry.getValue() > PEER_TIMEOUT_MS);
        assemblies.entrySet().removeIf(entry -> now - entry.getValue().createdAt > ASSEMBLY_TIMEOUT_MS);
        notifyStatus(running.get() ? (peers.isEmpty() ? "searching" : "active") : "offline",
                peers.isEmpty() ? "Ingen andre NEST-telefoner funnet ennå" : "Lokal peer-to-peer-synk aktiv");
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

    private static String gzipToBase64(String value) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bytes)) {
            gzip.write(value.getBytes(StandardCharsets.UTF_8));
        }
        return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    private static String gunzipFromBase64(String value) throws Exception {
        byte[] compressed = Base64.decode(value, Base64.NO_WRAP);
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

    private static final class Assembly {
        final int total;
        final List<String> parts;
        final long createdAt = SystemClock.elapsedRealtime();
        int received;

        Assembly(int total) {
            this.total = total;
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
