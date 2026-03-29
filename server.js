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

// Security: files that should not be served to clients
const BLOCKED_FILES = new Set([
  'server.js', 'package.json', 'package-lock.json',
  '.gitignore', '.env', 'node_modules',
]);

// Security: valid game-data message types and constraints
const VALID_GAME_DATA_TYPES = new Set([
  'player-info', 'ready', 'attack', 'overload', 'unit', 'state', 'game-over', 'countdown',
]);
const MAX_DAMAGE_PER_HIT = 500;
const MAX_PROJECTILES_PER_OVERLOAD = 5;
const VALID_PROJECTILE_TYPES = new Set(['weakFruit', 'fruit', 'stone', 'rocket', 'bomb', 'freeze']);
const VALID_UNIT_TYPES = new Set(['peasant', 'soldier', 'knight']);
const VALID_SABOTAGE_TYPES = new Set(['freeze', 'shake', 'blur']);
const VALID_LOADOUT_NAMES = new Set(['warrior', 'guardian', 'saboteur']);

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

  // Block access to sensitive server files
  const relPath = path.relative(baseDir, resolved);
  const topLevel = relPath.split(path.sep)[0];
  if (BLOCKED_FILES.has(topLevel) || relPath.startsWith('.')) {
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
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'",
    });
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

// Validate game-data payload structure to prevent cheating
function validateGameData(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.type !== 'string') return false;
  if (!VALID_GAME_DATA_TYPES.has(payload.type)) return false;

  switch (payload.type) {
    case 'player-info':
      if (typeof payload.name !== 'string' || payload.name.length > 16) return false;
      if (payload.loadout !== undefined && !VALID_LOADOUT_NAMES.has(payload.loadout)) return false;
      break;
    case 'attack':
      if (typeof payload.damage !== 'number' || payload.damage < 0 || payload.damage > MAX_DAMAGE_PER_HIT) return false;
      if (!VALID_PROJECTILE_TYPES.has(payload.projectileType)) return false;
      if (payload.sabotageType != null && !VALID_SABOTAGE_TYPES.has(payload.sabotageType)) return false;
      break;
    case 'overload':
      if (!Array.isArray(payload.projectiles)) return false;
      if (payload.projectiles.length > MAX_PROJECTILES_PER_OVERLOAD) return false;
      for (const p of payload.projectiles) {
        if (typeof p.damage !== 'number' || p.damage < 0 || p.damage > MAX_DAMAGE_PER_HIT) return false;
        if (!VALID_PROJECTILE_TYPES.has(p.type)) return false;
      }
      break;
    case 'unit':
      if (!VALID_UNIT_TYPES.has(payload.unitType)) return false;
      break;
    case 'state':
      // Validate numeric fields are in expected ranges
      if (payload.hp !== undefined && (typeof payload.hp !== 'number' || payload.hp < 0 || payload.hp > 1000)) return false;
      if (payload.shield !== undefined && (typeof payload.shield !== 'number' || payload.shield < 0 || payload.shield > 100)) return false;
      if (payload.energy !== undefined && (typeof payload.energy !== 'number' || payload.energy < 0 || payload.energy > 100)) return false;
      if (payload.accuracy !== undefined && (typeof payload.accuracy !== 'number' || payload.accuracy < 0 || payload.accuracy > 100)) return false;
      if (payload.combo !== undefined && (typeof payload.combo !== 'number' || payload.combo < 0 || payload.combo > 9999)) return false;
      break;
    case 'countdown':
      if (typeof payload.count !== 'number' || payload.count < 0 || payload.count > 10) return false;
      break;
    case 'ready':
    case 'game-over':
      break;
    default:
      return false;
  }
  return true;
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

// Optional: restrict WebSocket origins (set ALLOWED_ORIGINS env var, comma-separated)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

wss.on('connection', (ws, req) => {
  // Origin validation (when ALLOWED_ORIGINS is configured)
  if (allowedOrigins) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }
  }

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

      // Relay game data to opponent (with validation)
      case 'game-data': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.role === 'host' ? room.client : room.host;
        if (!target) return;

        // Validate game-data payload to prevent cheating
        if (msg.payload && !validateGameData(msg.payload)) {
          send(ws, { type: 'error', message: 'Invalid game data' });
          return;
        }

        send(target, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    // Cleanup rate limiter memory
    delete ws._msgTimestamps;

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
