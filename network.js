// KeyStrike - Network Layer
// WebRTC DataChannel + WebSocket signaling

class Network {
  constructor() {
    this.ws = null;
    this.pc = null; // RTCPeerConnection
    this.dc = null; // DataChannel
    this.role = null; // 'host' or 'client'
    this.roomId = null;
    this.seed = null;
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

  // Connect to signaling server, returns a promise that resolves when open
  connectSignaling() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}`);

      this.ws.onopen = () => {
        console.log('Connected to signaling server');
        resolve();
      };

      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        this._handleSignal(msg);
      };

      this.ws.onerror = () => {
        if (this.onError) this.onError('Failed to connect to server');
        reject();
      };

      this.ws.onclose = () => {
        console.log('Signaling connection closed');
      };
    });
  }

  // Create a new room (host)
  createRoom() {
    this.role = 'host';
    this._wsSend({ type: 'create-room' });
  }

  // Join existing room (client)
  joinRoom(roomId) {
    this.role = 'client';
    this._wsSend({ type: 'join-room', roomId });
  }

  // Send game data over DataChannel
  send(data) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
    }
  }

  // Handle signaling messages
  async _handleSignal(msg) {
    switch (msg.type) {
      case 'room-created':
        this.roomId = msg.roomId;
        this.seed = msg.seed;
        if (this.onRoomCreated) this.onRoomCreated(msg.roomId);
        break;

      case 'room-joined':
        this.roomId = msg.roomId;
        this.seed = msg.seed;
        if (this.onRoomJoined) this.onRoomJoined(msg.roomId);
        break;

      case 'opponent-joined':
        if (this.onOpponentJoined) this.onOpponentJoined();
        // Host initiates WebRTC connection
        this._createPeerConnection();
        this._createDataChannel();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this._wsSend({ type: 'offer', sdp: offer.sdp });
        break;

      case 'offer':
        // Client receives offer
        this._createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this._wsSend({ type: 'answer', sdp: answer.sdp });
        break;

      case 'answer':
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
        break;

      case 'ice-candidate':
        if (this.pc && msg.candidate) {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
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

  _createPeerConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._wsSend({ type: 'ice-candidate', candidate: e.candidate });
      }
    };

    // Client listens for data channel from host
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this._setupDataChannel();
    };
  }

  _createDataChannel() {
    this.dc = this.pc.createDataChannel('game', { ordered: true });
    this._setupDataChannel();
  }

  _setupDataChannel() {
    this.dc.onopen = () => {
      console.log('DataChannel open');
      this.connected = true;
      if (this.onConnected) this.onConnected();
    };

    this.dc.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (this.onMessage) this.onMessage(data);
    };

    this.dc.onclose = () => {
      console.log('DataChannel closed');
      this.connected = false;
      if (this.onDisconnected) this.onDisconnected();
    };
  }

  _wsSend(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.dc) this.dc.close();
    if (this.pc) this.pc.close();
    if (this.ws) this.ws.close();
    this.connected = false;
  }
}
