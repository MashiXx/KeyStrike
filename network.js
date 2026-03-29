// KeyStrike - Network Layer
// WebSocket relay for game data

class Network {
  constructor() {
    this.ws = null;
    this.role = null; // 'host' or 'client'
    this.roomId = null;
    this.seed = null;
    this.lang = 'en';
    this.connected = false;

    // Callbacks set by main.js
    this.onRoomCreated = null;
    this.onRoomJoined = null;
    this.onOpponentJoined = null;
    this.onConnected = null;
    this.onMessage = null;
    this.onDisconnected = null;
    this.onError = null;
  }

  connectSignaling() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}`);

      this.ws.onopen = () => {
        console.log('Connected to server');
        resolve();
      };

      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        this._handleMessage(msg);
      };

      this.ws.onerror = () => {
        if (this.onError) this.onError('Failed to connect to server');
        reject();
      };

      this.ws.onclose = () => {
        console.log('Connection closed');
        if (this.connected) {
          this.connected = false;
          if (this.onDisconnected) this.onDisconnected();
        }
      };
    });
  }

  createRoom(lang = 'en') {
    this.role = 'host';
    this._wsSend({ type: 'create-room', lang });
  }

  joinRoom(roomId) {
    this.role = 'client';
    this._wsSend({ type: 'join-room', roomId });
  }

  send(data) {
    this._wsSend({ type: 'game-data', payload: data });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'room-created':
        this.roomId = msg.roomId;
        this.seed = msg.seed;
        this.lang = msg.lang || 'en';
        if (this.onRoomCreated) this.onRoomCreated(msg.roomId);
        break;

      case 'room-joined':
        this.roomId = msg.roomId;
        this.seed = msg.seed;
        this.lang = msg.lang || 'en';
        if (this.onRoomJoined) this.onRoomJoined(msg.roomId);
        // Client is connected as soon as it joins the room
        this.connected = true;
        if (this.onConnected) this.onConnected();
        break;

      case 'opponent-joined':
        if (this.onOpponentJoined) this.onOpponentJoined();
        // Host is connected as soon as opponent joins
        this.connected = true;
        if (this.onConnected) this.onConnected();
        break;

      case 'game-data':
        if (this.onMessage) this.onMessage(msg.payload);
        break;

      case 'opponent-disconnected':
        this.connected = false;
        if (this.onDisconnected) this.onDisconnected();
        break;

      case 'error':
        if (this.onError) this.onError(msg.message);
        break;
    }
  }

  _wsSend(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) this.ws.close();
    this.connected = false;
  }
}
