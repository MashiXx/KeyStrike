// KeyStrike - Main Controller
// UI management, input handling, effects, game flow

(function () {
  // DOM refs
  const $ = (id) => document.getElementById(id);

  const screens = {
    menu: $('menu-screen'),
    lobby: $('lobby-screen'),
    game: $('game-screen'),
    gameover: $('gameover-screen'),
  };

  const ui = {
    btnCreate: $('btn-create'),
    btnJoin: $('btn-join'),
    inputRoomId: $('input-room-id'),
    menuStatus: $('menu-status'),
    lobbyRoomId: $('lobby-room-id'),
    lobbyStatus: $('lobby-status'),
    lobbyReady: $('lobby-ready'),
    btnReady: $('btn-ready'),
    sentenceDisplay: $('sentence-display'),
    countdownOverlay: $('countdown-overlay'),
    countdownText: $('countdown-text'),
    effectsLayer: $('effects-layer'),
    stunOverlay: $('stun-overlay'),
    comboDisplay: $('combo-display'),
    comboCount: $('combo-count'),
    // Self stats
    selfSpeed: $('self-speed'),
    selfAccuracy: $('self-accuracy'),
    selfChaosFill: $('self-chaos-fill'),
    selfChaosVal: $('self-chaos-val'),
    selfCorruptionFill: $('self-corruption-fill'),
    selfCorruptionVal: $('self-corruption-val'),
    // Opponent stats
    oppSpeed: $('opp-speed'),
    oppAccuracy: $('opp-accuracy'),
    oppChaosFill: $('opp-chaos-fill'),
    oppChaosVal: $('opp-chaos-val'),
    oppCorruptionFill: $('opp-corruption-fill'),
    oppCorruptionVal: $('opp-corruption-val'),
    // Share
    shareUrl: $('share-url'),
    btnCopy: $('btn-copy'),
    // Game over
    gameoverTitle: $('gameover-title'),
    gameoverStats: $('gameover-stats'),
    btnMenu: $('btn-menu'),
  };

  let net = null;
  let game = null;
  let bothReady = { self: false, opponent: false };

  // Audio context for sound effects
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function playTone(freq, duration, type = 'square', volume = 0.1) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  function playCorrectSound() { playTone(880, 0.05, 'sine', 0.05); }
  function playErrorSound() { playTone(200, 0.15, 'sawtooth', 0.08); }
  function playAttackSound() { playTone(440, 0.2, 'square', 0.1); }
  function playComboSound(combo) { playTone(600 + combo * 50, 0.1, 'sine', 0.08); }
  function playCriticalSound() { playTone(1200, 0.3, 'square', 0.12); }
  function playStunSound() { playTone(150, 0.5, 'sawtooth', 0.1); }

  // Screen management
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function setStatus(text, isError = false) {
    ui.menuStatus.textContent = text;
    ui.menuStatus.classList.toggle('error', isError);
  }

  // Initialize networking
  function initNetwork() {
    net = new Network();

    net.onRoomCreated = (roomId) => {
      showScreen('lobby');
      ui.lobbyRoomId.textContent = roomId;
      ui.shareUrl.value = `${location.origin}  |  Room: ${roomId}`;
      ui.lobbyStatus.textContent = 'Waiting for opponent...';
    };

    net.onRoomJoined = (roomId) => {
      showScreen('lobby');
      ui.lobbyRoomId.textContent = roomId;
      ui.lobbyStatus.textContent = 'Connecting...';
    };

    net.onOpponentJoined = () => {
      ui.lobbyStatus.textContent = 'Opponent joined! Connecting...';
    };

    net.onConnected = () => {
      ui.lobbyStatus.textContent = 'Connected! Press Ready to start.';
      ui.lobbyReady.style.display = 'block';
    };

    net.onMessage = handleNetMessage;

    net.onDisconnected = () => {
      if (game && game.active) {
        game.opponentLost();
      } else {
        setStatus('Opponent disconnected', true);
        showScreen('menu');
      }
    };

    net.onError = (msg) => {
      setStatus(msg, true);
    };
  }

  // Handle messages from opponent via DataChannel
  function handleNetMessage(data) {
    switch (data.type) {
      case 'ready':
        bothReady.opponent = true;
        checkBothReady();
        break;

      case 'attack':
        if (!game) return;
        game.receiveDamage(data.damage);
        spawnDamageEffects(data.damage, data.isCritical);
        screenShake();
        playAttackSound();
        if (data.isCritical) playCriticalSound();
        updateUI();
        break;

      case 'state':
        if (!game) return;
        game.updateOpponent(data);
        updateOpponentUI();
        break;

      case 'game-over':
        if (!game) return;
        game.opponentLost();
        break;

      case 'countdown':
        showCountdown(data.count);
        break;
    }
  }

  function checkBothReady() {
    if (bothReady.self && bothReady.opponent) {
      // Host drives the countdown
      if (net.role === 'host') {
        startCountdown();
      }
    }
  }

  function startCountdown() {
    let count = 3;
    showCountdown(count);
    net.send({ type: 'countdown', count });

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        showCountdown(count);
        net.send({ type: 'countdown', count });
      } else {
        clearInterval(interval);
        startGame();
        net.send({ type: 'countdown', count: 0 });
      }
    }, 1000);
  }

  function showCountdown(count) {
    if (count <= 0) {
      ui.countdownOverlay.style.display = 'none';
      if (net.role !== 'host') startGame();
      return;
    }
    showScreen('game');
    ui.countdownOverlay.style.display = 'flex';
    ui.countdownText.textContent = count;
    // Re-trigger animation
    ui.countdownText.style.animation = 'none';
    ui.countdownText.offsetHeight; // reflow
    ui.countdownText.style.animation = '';
  }

  function startGame() {
    showScreen('game');
    ui.countdownOverlay.style.display = 'none';
    game = new Game(net.seed);

    game.onStun = (duration) => {
      ui.stunOverlay.style.display = 'flex';
      playStunSound();
      setTimeout(() => {
        ui.stunOverlay.style.display = 'none';
      }, duration);
    };

    game.onGameOver = (result) => {
      endGame(result);
    };

    game.start();
    renderSentence();
    updateUI();
    initAudio();
  }

  // Render current sentence with character highlighting
  function renderSentence() {
    if (!game) return;
    const sentence = game.getCurrentSentence();
    const idx = game.currentCharIndex;
    let html = '';

    for (let i = 0; i < sentence.length; i++) {
      let cls = 'pending';
      if (i < idx) cls = 'correct';
      if (i === idx) cls = 'current';
      const ch = sentence[i] === ' ' ? '&nbsp;' : escapeHtml(sentence[i]);
      html += `<span class="char ${cls}" data-idx="${i}">${ch}</span>`;
    }

    ui.sentenceDisplay.innerHTML = html;
  }

  function escapeHtml(c) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] || c;
  }

  // Mark a character as error (flash red)
  function flashError(charIndex) {
    const el = ui.sentenceDisplay.querySelector(`[data-idx="${charIndex}"]`);
    if (el) {
      el.classList.add('error');
      setTimeout(() => el.classList.remove('error'), 300);
    }
  }

  // Update self stats UI
  function updateUI() {
    if (!game) return;
    const s = game.self;
    ui.selfSpeed.textContent = s.speed.toFixed(1);
    ui.selfAccuracy.textContent = s.accuracy;
    ui.selfChaosFill.style.width = s.chaos + '%';
    ui.selfChaosVal.textContent = Math.round(s.chaos) + '%';
    ui.selfCorruptionFill.style.width = s.corruption + '%';
    ui.selfCorruptionVal.textContent = Math.round(s.corruption) + '%';

    // Combo display
    if (game.combo >= 3) {
      ui.comboDisplay.style.display = 'block';
      ui.comboCount.textContent = game.combo;
    } else {
      ui.comboDisplay.style.display = 'none';
    }
  }

  function updateOpponentUI() {
    if (!game) return;
    const o = game.opponent;
    ui.oppSpeed.textContent = o.speed.toFixed(1);
    ui.oppAccuracy.textContent = o.accuracy;
    ui.oppChaosFill.style.width = o.chaos + '%';
    ui.oppChaosVal.textContent = Math.round(o.chaos) + '%';
    ui.oppCorruptionFill.style.width = o.corruption + '%';
    ui.oppCorruptionVal.textContent = Math.round(o.corruption) + '%';
  }

  // Send state to opponent periodically
  function broadcastState() {
    if (!game || !net) return;
    net.send({
      type: 'state',
      chaos: game.self.chaos,
      corruption: game.self.corruption,
      accuracy: game.self.accuracy,
      speed: game.self.speed,
    });
  }

  // Visual effects
  function spawnDamageEffects(damage, isCritical) {
    const count = Math.floor(damage * 1.5);

    // Falling random characters
    for (let i = 0; i < count; i++) {
      setTimeout(() => spawnFallingChar(), i * 50);
    }

    // Damage popup
    spawnPopup(isCritical ? 'CRITICAL!' : `-${Math.round(damage)}`, isCritical);

    if (isCritical) {
      document.body.classList.add('critical-flash');
      setTimeout(() => document.body.classList.remove('critical-flash'), 300);
    }
  }

  function spawnFallingChar() {
    const chars = '!@#$%^&*<>?/\\|{}[]~`01';
    const el = document.createElement('span');
    el.className = 'effect-char';
    el.textContent = chars[Math.floor(Math.random() * chars.length)];
    el.style.left = Math.random() * 100 + '%';
    el.style.top = '-20px';
    el.style.animationDuration = (2 + Math.random() * 3) + 's';
    el.style.fontSize = (0.8 + Math.random() * 1.5) + 'rem';
    ui.effectsLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function spawnPopup(text, isCritical) {
    const el = document.createElement('div');
    el.className = 'effect-popup';
    el.textContent = text;
    el.style.left = (30 + Math.random() * 40) + '%';
    el.style.top = (30 + Math.random() * 30) + '%';
    if (isCritical) {
      el.style.fontSize = '2.5rem';
      el.style.color = '#ffc107';
    }
    ui.effectsLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function screenShake() {
    const gameScreen = screens.game;
    gameScreen.classList.remove('screen-shake');
    gameScreen.offsetHeight; // reflow
    gameScreen.classList.add('screen-shake');
    setTimeout(() => gameScreen.classList.remove('screen-shake'), 400);
  }

  // End game
  function endGame(result) {
    ui.effectsLayer.innerHTML = '';
    ui.stunOverlay.style.display = 'none';

    ui.gameoverTitle.textContent = result === 'win' ? 'VICTORY' : 'DEFEAT';
    ui.gameoverTitle.className = result === 'win' ? 'win' : 'lose';
    ui.gameoverStats.textContent =
      `Sentences: ${game.self.sentencesCompleted}\n` +
      `Accuracy: ${game.self.accuracy}%\n` +
      `Final Chaos: ${Math.round(game.self.chaos)}%`;

    showScreen('gameover');
  }

  // Keyboard input
  document.addEventListener('keydown', (e) => {
    if (!game || !game.active) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length !== 1) return;

    e.preventDefault();
    initAudio();

    const result = game.processKey(e.key);

    switch (result.result) {
      case 'correct':
        playCorrectSound();
        if (game.combo >= 3) playComboSound(game.combo);
        renderSentence();
        updateUI();
        broadcastState();
        break;

      case 'error':
        playErrorSound();
        flashError(result.charIndex);
        updateUI();
        broadcastState();
        break;

      case 'sentence-complete':
        playAttackSound();
        if (result.isCritical) playCriticalSound();
        // Send attack to opponent
        net.send({
          type: 'attack',
          damage: result.damage,
          isCritical: result.isCritical,
        });
        renderSentence();
        updateUI();
        broadcastState();
        // Check if we caused opponent to lose (they'll detect it themselves too)
        break;

      case 'ignored':
        break;
    }
  });

  // Button handlers
  ui.btnCreate.addEventListener('click', async () => {
    setStatus('Connecting...');
    initNetwork();
    await net.connectSignaling();
    net.createRoom();
    setStatus('Creating room...');
  });

  ui.btnJoin.addEventListener('click', async () => {
    const roomId = ui.inputRoomId.value.trim();
    if (!roomId) {
      setStatus('Enter a room code', true);
      return;
    }
    setStatus('Connecting...');
    initNetwork();
    await net.connectSignaling();
    net.joinRoom(roomId);
    setStatus('Joining room...');
  });

  ui.inputRoomId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ui.btnJoin.click();
  });

  ui.btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(ui.shareUrl.value).then(() => {
      ui.btnCopy.textContent = 'Copied!';
      setTimeout(() => { ui.btnCopy.textContent = 'Copy'; }, 1500);
    });
  });

  ui.btnReady.addEventListener('click', () => {
    bothReady.self = true;
    ui.btnReady.disabled = true;
    ui.btnReady.textContent = 'Waiting...';
    net.send({ type: 'ready' });
    checkBothReady();
  });

  ui.btnMenu.addEventListener('click', () => {
    if (net) net.disconnect();
    game = null;
    bothReady = { self: false, opponent: false };
    showScreen('menu');
    setStatus('');
  });

  // Periodic state sync
  setInterval(() => {
    if (game && game.active && net && net.connected) {
      broadcastState();
    }
  }, 500);
})();
