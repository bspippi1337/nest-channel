const http = require("node:http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 500);
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES || 1024 * 1024);
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("NEST Channel relay\n");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function validRoom(room) {
  return typeof room === "string" && /^[a-f0-9]{64}$/.test(room);
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = { clients: new Set(), history: [] };
    rooms.set(id, room);
  }
  return room;
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const text = JSON.stringify(message);
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

function peerCount(room) {
  broadcast(room, { type: "peer_count", count: room.clients.size });
}

function leave(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.clients.delete(ws);
  peerCount(room);
  if (room.clients.size === 0 && room.history.length === 0) rooms.delete(ws.roomId);
  ws.roomId = null;
}

wss.on("connection", ws => {
  ws.roomId = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", raw => {
    if (raw.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, "Message too large");
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (message.type === "join") {
      if (!validRoom(message.room)) {
        ws.close(1008, "Invalid room");
        return;
      }
      leave(ws);
      ws.roomId = message.room;
      const room = getRoom(ws.roomId);
      room.clients.add(ws);
      send(ws, { type: "welcome", history: room.history });
      peerCount(room);
      return;
    }

    if (message.type === "envelope") {
      if (!ws.roomId || message.room !== ws.roomId || !validRoom(message.room)) {
        ws.close(1008, "Join a room first");
        return;
      }
      if (
        typeof message.id !== "string" ||
        typeof message.iv !== "string" ||
        typeof message.data !== "string" ||
        message.data.length > MAX_MESSAGE_BYTES
      ) {
        send(ws, { type: "error", message: "Invalid envelope" });
        return;
      }
      const room = getRoom(ws.roomId);
      const envelope = {
        type: "envelope",
        room: ws.roomId,
        id: message.id,
        iv: message.iv,
        data: message.data,
        sentAt: typeof message.sentAt === "string" ? message.sentAt : new Date().toISOString()
      };
      room.history.push(envelope);
      if (room.history.length > MAX_HISTORY) room.history.splice(0, room.history.length - MAX_HISTORY);
      broadcast(room, envelope);
    }
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on("close", () => clearInterval(heartbeat));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEST Channel relay listening on :${PORT}`);
});
