// KeyStrike - Game Server
// WebSocket relay for room management and game data

require('dotenv').config();
const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_SIZE = 65536; // 64KB
const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 120; // max messages per window
const ROOM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const MAX_ROOMS = 500;
const VALID_LANGS = ['en', 'vi'];

// Simple static file server with path traversal protection
const baseDir = path.resolve(__dirname);

const server = http.createServer((req, res) => {
  // Strip query strings and decode
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.resolve(baseDir, '.' + filePath);

  // Block path traversal
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extMap = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
  };

  const ext = path.extname(resolved);
  const contentType = extMap[ext] || 'application/octet-stream';

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket server
const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_SIZE });

// Room storage: roomId -> { host, client, seed, lang, timer }
const rooms = new Map();

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(roomId);
}

function resetRoomTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (r) {
      send(r.host, { type: 'error', message: 'Room expired' });
      send(r.client, { type: 'error', message: 'Room expired' });
      cleanupRoom(roomId);
      console.log(`Room ${roomId} expired`);
    }
  }, ROOM_TIMEOUT);
}

// Rate limiter per connection
function checkRateLimit(ws) {
  const now = Date.now();
  if (!ws._msgTimestamps) ws._msgTimestamps = [];
  ws._msgTimestamps = ws._msgTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (ws._msgTimestamps.length >= RATE_LIMIT_MAX) {
    return false; // Rate limited
  }
  ws._msgTimestamps.push(now);
  return true;
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    // Message size check (also enforced by maxPayload, this is defense in depth)
    if (raw.length > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }

    // Rate limiting
    if (!checkRateLimit(ws)) {
      send(ws, { type: 'error', message: 'Too many messages, slow down' });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Basic type validation
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'create-room': {
        // Validate language
        const lang = VALID_LANGS.includes(msg.lang) ? msg.lang : 'en';

        // Limit total rooms
        if (rooms.size >= MAX_ROOMS) {
          send(ws, { type: 'error', message: 'Server is full, try again later' });
          return;
        }

        // If player already in a room, clean up old one
        if (ws.roomId) {
          const oldRoom = rooms.get(ws.roomId);
          if (oldRoom) {
            const other = ws.role === 'host' ? oldRoom.client : oldRoom.host;
            send(other, { type: 'opponent-disconnected' });
            cleanupRoom(ws.roomId);
          }
        }

        const roomId = generateRoomId();
        const seed = crypto.randomInt(1000000);
        rooms.set(roomId, { host: ws, client: null, seed, lang, timer: null });
        ws.roomId = roomId;
        ws.role = 'host';
        resetRoomTimer(roomId);
        send(ws, { type: 'room-created', roomId, seed, lang });
        console.log(`Room ${roomId} created (${rooms.size} active)`);
        break;
      }

      case 'join-room': {
        if (typeof msg.roomId !== 'string') return;
        const roomId = msg.roomId.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (roomId.length !== 6) {
          send(ws, { type: 'error', message: 'Invalid room code' });
          return;
        }

        const room = rooms.get(roomId);
        if (!room) {
          send(ws, { type: 'error', message: 'Room not found' });
          return;
        }
        if (room.client) {
          send(ws, { type: 'error', message: 'Room is full' });
          return;
        }

        // If player already in another room, clean up
        if (ws.roomId && ws.roomId !== roomId) {
          const oldRoom = rooms.get(ws.roomId);
          if (oldRoom) {
            const other = ws.role === 'host' ? oldRoom.client : oldRoom.host;
            send(other, { type: 'opponent-disconnected' });
            cleanupRoom(ws.roomId);
          }
        }

        room.client = ws;
        ws.roomId = roomId;
        ws.role = 'client';
        resetRoomTimer(roomId);
        send(ws, { type: 'room-joined', roomId, seed: room.seed, lang: room.lang });
        send(room.host, { type: 'opponent-joined' });
        console.log(`Player joined room ${roomId}`);
        break;
      }

      // Relay game data to opponent
      case 'game-data': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.role === 'host' ? room.client : room.host;
        if (!target) return;
        send(target, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    // Notify the other player
    const other = ws.role === 'host' ? room.client : room.host;
    send(other, { type: 'opponent-disconnected' });

    cleanupRoom(ws.roomId);
    console.log(`Room ${ws.roomId} closed (${rooms.size} active)`);
  });
});

server.listen(PORT, () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) {
        ips.push(cfg.address);
      }
    }
  }
  console.log('');
  console.log('  ⚡ KeyStrike server running!');
  console.log(`  Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network: http://${ip}:${PORT}`));
  console.log('');
});
