// KeyStrike - Signaling Server
// WebSocket server for WebRTC signaling and room management

require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Simple static file server for the game files
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const extMap = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };

  const ext = path.extname(filePath);
  const contentType = extMap[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket signaling server
const wss = new WebSocket.Server({ server });

// Room storage: roomId -> { host: ws, client: ws, seed: number }
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create-room': {
        const roomId = generateRoomId();
        const seed = Math.floor(Math.random() * 1000000);
        const lang = msg.lang || 'en';
        rooms.set(roomId, { host: ws, client: null, seed, lang });
        ws.roomId = roomId;
        ws.role = 'host';
        send(ws, { type: 'room-created', roomId, seed, lang });
        console.log(`Room ${roomId} created`);
        break;
      }

      case 'join-room': {
        const roomId = msg.roomId?.toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          send(ws, { type: 'error', message: 'Room not found' });
          return;
        }
        if (room.client) {
          send(ws, { type: 'error', message: 'Room is full' });
          return;
        }
        room.client = ws;
        ws.roomId = roomId;
        ws.role = 'client';
        send(ws, { type: 'room-joined', roomId, seed: room.seed, lang: room.lang });
        send(room.host, { type: 'opponent-joined' });
        console.log(`Player joined room ${roomId}`);
        break;
      }

      // WebRTC signaling relay
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.role === 'host' ? room.client : room.host;
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

    rooms.delete(ws.roomId);
    console.log(`Room ${ws.roomId} closed`);
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
  console.log('  Share the Network URL with your opponent!');
  console.log('');
});

