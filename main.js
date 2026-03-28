// KeyStrike - Main Controller
// Canvas rendering, projectile physics, castle drawing, UI, game flow

(function () {
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
    shareUrl: $('share-url'),
    shareCode: $('share-code'),
    btnCopyUrl: $('btn-copy-url'),
    btnCopyCode: $('btn-copy-code'),
    canvas: $('battle-canvas'),
    sentenceDisplay: $('sentence-display'),
    countdownOverlay: $('countdown-overlay'),
    countdownText: $('countdown-text'),
    comboDisplay: $('combo-display'),
    comboCount: $('combo-count'),
    sabotageOverlay: $('sabotage-overlay'),
    overloadBtn: $('overload-btn'),
    // HUD
    selfHpFill: $('self-hp-fill'),
    selfHpText: $('self-hp-text'),
    selfSpeed: $('self-speed'),
    selfAccuracy: $('self-accuracy'),
    selfCombo: $('self-combo'),
    selfEnergyFill: $('self-energy-fill'),
    selfShieldFill: $('self-shield-fill'),
    oppHpFill: $('opp-hp-fill'),
    oppHpText: $('opp-hp-text'),
    oppSpeed: $('opp-speed'),
    oppAccuracy: $('opp-accuracy'),
    oppCombo: $('opp-combo'),
    oppEnergyFill: $('opp-energy-fill'),
    oppShieldFill: $('opp-shield-fill'),
    // Game over
    gameoverTitle: $('gameover-title'),
    gameoverStats: $('gameover-stats'),
    btnMenu: $('btn-menu'),
  };

  let net = null;
  let game = null;
  let selectedLoadout = 'warrior';
  let bothReady = { self: false, opponent: false };
  let ctx = null; // canvas context
  let animFrame = null;

  // ====== RENDER STATE ======
  const render = {
    projectiles: [],  // active projectiles in flight
    particles: [],    // debris/explosion particles
    units: [],        // marching units
    impacts: [],      // impact flash effects
    castles: {
      left: { hp: 1000, maxHp: 1000, shieldAlpha: 0, shakeX: 0, shakeY: 0 },
      right: { hp: 1000, maxHp: 1000, shieldAlpha: 0, shakeX: 0, shakeY: 0 },
    },
    groundY: 0,
    leftCastleX: 0,
    rightCastleX: 0,
  };

  // ====== AUDIO ======
  let audioCtx = null;
  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  function playTone(freq, dur, type = 'square', vol = 0.08) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + dur);
  }
  function sfxCorrect() { playTone(880, 0.04, 'sine', 0.04); }
  function sfxError() { playTone(200, 0.12, 'sawtooth', 0.06); }
  function sfxLaunch() { playTone(300, 0.15, 'square', 0.08); }
  function sfxImpact() { playTone(100, 0.25, 'sawtooth', 0.1); }
  function sfxExplosion() { playTone(60, 0.4, 'sawtooth', 0.12); }
  function sfxCritical() { playTone(1200, 0.2, 'square', 0.1); }
  function sfxShield() { playTone(600, 0.15, 'sine', 0.06); }
  function sfxOverload() { playTone(400, 0.5, 'square', 0.12); }
  function sfxCombo(n) { playTone(500 + n * 40, 0.08, 'sine', 0.05); }

  // ====== SCREEN MANAGEMENT ======
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'game') resizeCanvas();
  }

  function setStatus(text, isError = false) {
    ui.menuStatus.textContent = text;
    ui.menuStatus.classList.toggle('error', isError);
  }

  // ====== CANVAS SETUP ======
  function resizeCanvas() {
    const c = ui.canvas;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    ctx = c.getContext('2d');
    render.groundY = c.height * 0.75;
    render.leftCastleX = c.width * 0.12;
    render.rightCastleX = c.width * 0.88;
  }
  window.addEventListener('resize', () => { if (ctx) resizeCanvas(); });

  // ====== CASTLE DRAWING ======
  function drawCastle(x, groundY, castleState, side) {
    const shakeX = castleState.shakeX;
    const shakeY = castleState.shakeY;
    const cx = x + shakeX;
    const cy = groundY + shakeY;
    const hpRatio = castleState.hp / castleState.maxHp;

    // Castle body
    const w = 80, h = 120;
    const baseY = cy - 10;

    // Damage color tint
    const r = Math.floor(40 + (1 - hpRatio) * 100);
    const g = Math.floor(40 + hpRatio * 30);
    const b = Math.floor(50);

    ctx.save();

    // Main tower
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(cx - w/2, baseY - h, w, h);

    // Tower top (crenellations)
    const cw = 14, ch = 18;
    for (let i = 0; i < 4; i++) {
      const bx = cx - w/2 + i * (w/4) + 2;
      ctx.fillRect(bx, baseY - h - ch, cw, ch);
    }

    // Gate
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(cx, baseY, 15, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 15, baseY - 15, 30, 15);

    // Side walls
    const wallW = 50, wallH = 60;
    ctx.fillStyle = `rgb(${r - 10},${g - 5},${b - 5})`;
    if (side === 'left') {
      ctx.fillRect(cx + w/2, baseY - wallH, wallW, wallH);
      // Small tower on wall
      ctx.fillRect(cx + w/2 + wallW - 12, baseY - wallH - 20, 16, 20);
    } else {
      ctx.fillRect(cx - w/2 - wallW, baseY - wallH, wallW, wallH);
      ctx.fillRect(cx - w/2 - wallW - 4, baseY - wallH - 20, 16, 20);
    }

    // Damage cracks (drawn when hp < 70%)
    if (hpRatio < 0.7) {
      ctx.strokeStyle = '#0a0a0f';
      ctx.lineWidth = 2;
      const numCracks = Math.floor((1 - hpRatio) * 8);
      for (let i = 0; i < numCracks; i++) {
        const crackX = cx - w/3 + (i * 17) % w;
        const crackY = baseY - h * 0.3 - (i * 23) % (h * 0.5);
        ctx.beginPath();
        ctx.moveTo(crackX, crackY);
        ctx.lineTo(crackX + 8, crackY + 12);
        ctx.lineTo(crackX + 3, crackY + 20);
        ctx.stroke();
      }
    }

    // Heavy damage: missing chunks (hp < 40%)
    if (hpRatio < 0.4) {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(cx - w/4, baseY - h, 20, 15);
      ctx.fillRect(cx + 5, baseY - h - ch, 12, 12);
    }

    // Shield glow
    if (castleState.shieldAlpha > 0) {
      ctx.beginPath();
      ctx.arc(cx, baseY - h/2, w * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 229, 255, ${castleState.shieldAlpha * 0.2})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0, 229, 255, ${castleState.shieldAlpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      castleState.shieldAlpha = Math.max(0, castleState.shieldAlpha - 0.01);
    }

    // Flag on top
    ctx.fillStyle = side === 'left' ? '#448aff' : '#e94560';
    ctx.fillRect(cx, baseY - h - ch - 25, 2, 25);
    ctx.beginPath();
    ctx.moveTo(cx + 2, baseY - h - ch - 25);
    ctx.lineTo(cx + 18, baseY - h - ch - 18);
    ctx.lineTo(cx + 2, baseY - h - ch - 11);
    ctx.fill();

    ctx.restore();
  }

  // ====== GROUND ======
  function drawGround() {
    const gY = render.groundY;
    ctx.fillStyle = '#1a1a10';
    ctx.fillRect(0, gY, ctx.canvas.width, ctx.canvas.height - gY);
    // Grass line
    ctx.strokeStyle = '#2a3a15';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, gY);
    ctx.lineTo(ctx.canvas.width, gY);
    ctx.stroke();
  }

  // ====== PROJECTILE (Parabolic Physics) ======
  function spawnProjectile(fromSide, projTypeName, damage, isCritical) {
    const projDef = PROJECTILE_TYPES[projTypeName];
    const fromX = fromSide === 'left' ? render.leftCastleX + 60 : render.rightCastleX - 60;
    const toX = fromSide === 'left' ? render.rightCastleX - 40 : render.leftCastleX + 40;
    const fromY = render.groundY - 100;
    const toY = render.groundY - 50;

    const dist = Math.abs(toX - fromX);
    const speed = projDef.speed * 100; // px/s
    const totalTime = dist / speed;

    render.projectiles.push({
      fromX, fromY, toX, toY,
      x: fromX, y: fromY,
      t: 0,
      totalTime,
      type: projTypeName,
      def: projDef,
      damage,
      isCritical,
      fromSide,
      gravity: 600, // parabolic arc height
      trail: projDef.trail ? [] : null,
    });
  }

  function updateProjectiles(dt) {
    for (let i = render.projectiles.length - 1; i >= 0; i--) {
      const p = render.projectiles[i];
      p.t += dt;
      const progress = Math.min(p.t / p.totalTime, 1);

      // Lerp X
      p.x = p.fromX + (p.toX - p.fromX) * progress;

      // Parabolic Y: y = fromY + (toY - fromY)*t - gravity*t*(1-t)
      const linearY = p.fromY + (p.toY - p.fromY) * progress;
      const arcHeight = p.gravity * progress * (1 - progress);
      p.y = linearY - arcHeight;

      // Trail
      if (p.trail) {
        p.trail.push({ x: p.x, y: p.y, alpha: 1 });
        if (p.trail.length > 20) p.trail.shift();
      }

      // Hit detection
      if (progress >= 1) {
        onProjectileHit(p);
        render.projectiles.splice(i, 1);
      }
    }
  }

  function drawProjectiles() {
    for (const p of render.projectiles) {
      // Draw trail
      if (p.trail) {
        for (let i = 0; i < p.trail.length; i++) {
          const t = p.trail[i];
          const alpha = (i / p.trail.length) * 0.5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, p.def.radius * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = p.def.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
      }

      // Draw projectile body
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.def.radius, 0, Math.PI * 2);

      // Glow for critical
      if (p.isCritical) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffc107';
      }

      ctx.fillStyle = p.def.color;
      ctx.fill();

      // Inner highlight
      ctx.beginPath();
      ctx.arc(p.x - 2, p.y - 2, p.def.radius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();

      ctx.restore();
    }
  }

  function onProjectileHit(p) {
    const targetSide = p.fromSide === 'left' ? 'right' : 'left';
    const castle = render.castles[targetSide];

    // Screen shake on castle
    castle.shakeX = (Math.random() - 0.5) * 12;
    castle.shakeY = (Math.random() - 0.5) * 8;

    // Spawn debris particles
    const particleCount = p.def.explosion ? 30 : 12;
    for (let i = 0; i < particleCount; i++) {
      render.particles.push({
        x: p.x, y: p.y,
        vx: (Math.random() - 0.5) * (p.def.explosion ? 400 : 200),
        vy: -Math.random() * 300 - 50,
        life: 1,
        decay: 0.8 + Math.random() * 1.5,
        size: 2 + Math.random() * (p.def.explosion ? 6 : 3),
        color: p.def.color,
      });
    }

    // Explosion ring for rockets/bombs
    if (p.def.explosion) {
      render.impacts.push({
        x: p.x, y: p.y,
        radius: 0, maxRadius: p.def.aoe ? 80 : 50,
        alpha: 1,
        color: p.def.color,
      });
      sfxExplosion();
    } else {
      sfxImpact();
    }

    if (p.isCritical) sfxCritical();

    // Screen shake on game screen
    screens.game.classList.remove('screen-shake');
    screens.game.offsetHeight;
    screens.game.classList.add('screen-shake');
    setTimeout(() => screens.game.classList.remove('screen-shake'), 400);
  }

  // ====== UNITS ======
  function spawnUnit(side, unitType) {
    const fromX = side === 'left' ? render.leftCastleX + 90 : render.rightCastleX - 90;
    const toX = side === 'left' ? render.rightCastleX - 90 : render.leftCastleX + 90;
    const sizes = { peasant: 8, soldier: 11, knight: 15 };
    const colors = { peasant: '#8bc34a', soldier: '#ff9100', knight: '#e94560' };
    const speeds = { peasant: 40, soldier: 60, knight: 80 };

    render.units.push({
      x: fromX, y: render.groundY - 5,
      toX,
      speed: speeds[unitType] || 40,
      size: sizes[unitType] || 8,
      color: colors[unitType] || '#8bc34a',
      type: unitType,
      side,
      walkPhase: Math.random() * Math.PI * 2,
    });
  }

  function updateUnits(dt) {
    for (let i = render.units.length - 1; i >= 0; i--) {
      const u = render.units[i];
      const dir = u.toX > u.x ? 1 : -1;
      u.x += dir * u.speed * dt;
      u.walkPhase += dt * 8;

      // Reached target
      if ((dir > 0 && u.x >= u.toX) || (dir < 0 && u.x <= u.toX)) {
        // Small impact on arrival
        render.particles.push({
          x: u.x, y: u.y,
          vx: (Math.random() - 0.5) * 50,
          vy: -Math.random() * 80,
          life: 1, decay: 2, size: 3, color: u.color,
        });
        render.units.splice(i, 1);
      }
    }
  }

  function drawUnits() {
    for (const u of render.units) {
      const bob = Math.sin(u.walkPhase) * 2;
      ctx.save();
      // Body
      ctx.fillStyle = u.color;
      ctx.fillRect(u.x - u.size/2, u.y - u.size * 2 + bob, u.size, u.size * 1.5);
      // Head
      ctx.beginPath();
      ctx.arc(u.x, u.y - u.size * 2.2 + bob, u.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Weapon for knight
      if (u.type === 'knight') {
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        const dir = u.toX > u.x ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(u.x + dir * u.size * 0.5, u.y - u.size * 1.5 + bob);
        ctx.lineTo(u.x + dir * u.size * 1.5, u.y - u.size * 2.5 + bob);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ====== PARTICLES & IMPACTS ======
  function updateParticles(dt) {
    for (let i = render.particles.length - 1; i >= 0; i--) {
      const p = render.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt; // gravity
      p.life -= p.decay * dt;
      if (p.life <= 0) render.particles.splice(i, 1);
    }
    for (let i = render.impacts.length - 1; i >= 0; i--) {
      const imp = render.impacts[i];
      imp.radius += 200 * dt;
      imp.alpha -= 2 * dt;
      if (imp.alpha <= 0 || imp.radius >= imp.maxRadius) render.impacts.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of render.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const imp of render.impacts) {
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, imp.radius, 0, Math.PI * 2);
      ctx.strokeStyle = imp.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.max(0, imp.alpha);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Decay castle shake
  function updateCastleShake() {
    for (const c of [render.castles.left, render.castles.right]) {
      c.shakeX *= 0.85;
      c.shakeY *= 0.85;
      if (Math.abs(c.shakeX) < 0.5) c.shakeX = 0;
      if (Math.abs(c.shakeY) < 0.5) c.shakeY = 0;
    }
  }

  // ====== RENDER LOOP ======
  let lastTime = 0;
  function renderLoop(time) {
    animFrame = requestAnimationFrame(renderLoop);
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, render.groundY);
    skyGrad.addColorStop(0, '#0a0a1a');
    skyGrad.addColorStop(1, '#121220');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, ctx.canvas.width, render.groundY);

    drawGround();

    // Update castle render state from game
    if (game) {
      render.castles.left.hp = game.self.hp;
      render.castles.right.hp = game.opponent.hp;
    }

    updateCastleShake();
    drawCastle(render.leftCastleX, render.groundY, render.castles.left, 'left');
    drawCastle(render.rightCastleX, render.groundY, render.castles.right, 'right');

    updateUnits(dt);
    drawUnits();

    updateProjectiles(dt);
    drawProjectiles();

    updateParticles(dt);
    drawParticles();
  }

  // ====== NETWORK ======
  function initNetwork() {
    net = new Network();

    net.onRoomCreated = (roomId) => {
      showScreen('lobby');
      ui.lobbyRoomId.textContent = roomId;
      ui.shareUrl.value = location.origin;
      ui.shareCode.value = roomId;
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

    net.onError = (msg) => setStatus(msg, true);
  }

  function handleNetMessage(data) {
    switch (data.type) {
      case 'ready':
        bothReady.opponent = true;
        checkBothReady();
        break;

      case 'attack': {
        if (!game) return;
        // Spawn projectile coming from right (opponent) to left (self)
        spawnProjectile('right', data.projectileType, data.damage, data.isCritical);
        // Apply damage after projectile travel time
        const projDef = PROJECTILE_TYPES[data.projectileType];
        const dist = Math.abs(render.rightCastleX - render.leftCastleX);
        const travelTime = dist / (projDef.speed * 100) * 1000;
        setTimeout(() => {
          if (!game) return;
          game.receiveDamage(data.damage, data.sabotageType);
          updateHUD();
        }, travelTime);
        break;
      }

      case 'overload': {
        if (!game) return;
        // Multiple projectiles incoming
        for (const p of data.projectiles) {
          setTimeout(() => {
            spawnProjectile('right', p.type, p.damage, false);
            const projDef = PROJECTILE_TYPES[p.type];
            const dist = Math.abs(render.rightCastleX - render.leftCastleX);
            const travelTime = dist / (projDef.speed * 100) * 1000;
            setTimeout(() => {
              if (!game) return;
              game.receiveDamage(p.damage);
              updateHUD();
            }, travelTime);
          }, p.delay);
        }
        break;
      }

      case 'unit':
        spawnUnit('right', data.unitType);
        break;

      case 'state':
        if (!game) return;
        game.updateOpponent(data);
        updateOpponentHUD();
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
      if (net.role === 'host') startCountdown();
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
    ui.countdownText.style.animation = 'none';
    ui.countdownText.offsetHeight;
    ui.countdownText.style.animation = '';
  }

  function startGame() {
    showScreen('game');
    ui.countdownOverlay.style.display = 'none';
    resizeCanvas();

    game = new Game(net.seed, selectedLoadout);

    game.onShieldGain = () => {
      render.castles.left.shieldAlpha = 1;
      sfxShield();
    };

    game.onSabotage = (type, duration) => {
      const typingArea = $('typing-area');
      if (type === 'freeze') {
        ui.sabotageOverlay.querySelector('span').textContent = 'FROZEN!';
        ui.sabotageOverlay.style.display = 'flex';
        setTimeout(() => { ui.sabotageOverlay.style.display = 'none'; }, duration);
      } else if (type === 'shake') {
        typingArea.classList.add('typing-shaken');
        setTimeout(() => typingArea.classList.remove('typing-shaken'), duration);
      } else if (type === 'blur') {
        typingArea.classList.add('typing-blurred');
        setTimeout(() => typingArea.classList.remove('typing-blurred'), duration);
      }
    };

    game.onUnitSpawn = (unitType) => {
      spawnUnit('left', unitType);
      net.send({ type: 'unit', unitType });
    };

    game.onGameOver = (result) => endGame(result);

    game.start();

    // Reset render state
    render.projectiles = [];
    render.particles = [];
    render.units = [];
    render.impacts = [];
    render.castles.left = { hp: 1000, maxHp: 1000, shieldAlpha: 0, shakeX: 0, shakeY: 0 };
    render.castles.right = { hp: 1000, maxHp: 1000, shieldAlpha: 0, shakeX: 0, shakeY: 0 };

    if (!animFrame) {
      lastTime = performance.now();
      renderLoop(lastTime);
    }

    renderSentence();
    updateHUD();
    initAudio();
  }

  // ====== TYPING ======
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

  function flashError(charIndex) {
    const el = ui.sentenceDisplay.querySelector(`[data-idx="${charIndex}"]`);
    if (el) {
      el.classList.add('error');
      setTimeout(() => el.classList.remove('error'), 300);
    }
  }

  // ====== HUD ======
  function updateHUD() {
    if (!game) return;
    const s = game.self;
    ui.selfHpFill.style.width = (s.hp / s.maxHp * 100) + '%';
    ui.selfHpText.textContent = `${Math.round(s.hp)} / ${s.maxHp}`;
    ui.selfSpeed.textContent = s.speed.toFixed(1);
    ui.selfAccuracy.textContent = s.accuracy;
    ui.selfCombo.textContent = game.combo;
    ui.selfEnergyFill.style.width = s.energy + '%';
    ui.selfShieldFill.style.width = s.shield + '%';

    // Combo display
    if (game.combo >= 3) {
      ui.comboDisplay.style.display = 'block';
      ui.comboCount.textContent = game.combo;
    } else {
      ui.comboDisplay.style.display = 'none';
    }

    // Overload button
    ui.overloadBtn.style.display = s.energy >= 100 ? 'block' : 'none';
  }

  function updateOpponentHUD() {
    if (!game) return;
    const o = game.opponent;
    ui.oppHpFill.style.width = (o.hp / o.maxHp * 100) + '%';
    ui.oppHpText.textContent = `${Math.round(o.hp)} / ${o.maxHp}`;
    ui.oppSpeed.textContent = o.speed.toFixed(1);
    ui.oppAccuracy.textContent = o.accuracy;
    ui.oppCombo.textContent = o.combo;
    ui.oppEnergyFill.style.width = o.energy + '%';
    ui.oppShieldFill.style.width = o.shield + '%';
  }

  function broadcastState() {
    if (!game || !net) return;
    net.send({ type: 'state', ...game.getState() });
  }

  // ====== GAME OVER ======
  function endGame(result) {
    ui.sabotageOverlay.style.display = 'none';
    ui.overloadBtn.style.display = 'none';

    ui.gameoverTitle.textContent = result === 'win' ? 'VICTORY' : 'DEFEAT';
    ui.gameoverTitle.className = result === 'win' ? 'win' : 'lose';
    ui.gameoverStats.textContent =
      `Sentences: ${game.self.sentencesCompleted}\n` +
      `Accuracy: ${game.self.accuracy}%\n` +
      `Max Combo: ${game.maxCombo}\n` +
      `Castle HP: ${Math.round(game.self.hp)} / ${game.self.maxHp}`;

    setTimeout(() => showScreen('gameover'), 1500);
  }

  // ====== INPUT ======
  document.addEventListener('keydown', (e) => {
    if (!game || !game.active) return;

    // Overload trigger on Space when energy full
    if (e.key === ' ' && game.self.energy >= 100) {
      e.preventDefault();
      const projectiles = game.triggerOverload();
      if (projectiles) {
        sfxOverload();
        // Fire our projectiles left -> right
        for (const p of projectiles) {
          setTimeout(() => {
            spawnProjectile('left', p.type, p.damage, false);
            sfxLaunch();
          }, p.delay);
        }
        net.send({ type: 'overload', projectiles });
        updateHUD();
      }
      return;
    }

    // Only single printable characters for typing
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length !== 1) return;
    e.preventDefault();
    initAudio();

    const result = game.processKey(e.key);

    switch (result.result) {
      case 'correct':
        sfxCorrect();
        if (game.combo >= 3) sfxCombo(game.combo);
        renderSentence();
        updateHUD();
        broadcastState();
        break;

      case 'error':
        sfxError();
        flashError(result.charIndex);
        updateHUD();
        broadcastState();
        break;

      case 'sentence-complete': {
        sfxLaunch();
        // Spawn projectile from left (self) to right (opponent)
        spawnProjectile('left', result.projectileType, result.damage, result.isCritical);

        // Send attack to opponent
        net.send({
          type: 'attack',
          projectileType: result.projectileType,
          damage: result.damage,
          isCritical: result.isCritical,
          sabotageType: result.sabotageType,
        });

        renderSentence();
        updateHUD();
        broadcastState();
        break;
      }
    }
  });

  // ====== BUTTON HANDLERS ======

  // Loadout selection
  document.querySelectorAll('.loadout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.loadout-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLoadout = btn.dataset.loadout;
    });
  });

  ui.btnCreate.addEventListener('click', async () => {
    setStatus('Connecting...');
    initNetwork();
    await net.connectSignaling();
    net.createRoom();
    setStatus('Creating room...');
  });

  ui.btnJoin.addEventListener('click', async () => {
    const roomId = ui.inputRoomId.value.trim();
    if (!roomId) { setStatus('Enter a room code', true); return; }
    setStatus('Connecting...');
    initNetwork();
    await net.connectSignaling();
    net.joinRoom(roomId);
    setStatus('Joining room...');
  });

  ui.inputRoomId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ui.btnJoin.click();
  });

  ui.btnCopyUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(ui.shareUrl.value).then(() => {
      ui.btnCopyUrl.textContent = 'Copied!';
      setTimeout(() => { ui.btnCopyUrl.textContent = 'Copy'; }, 1500);
    });
  });

  ui.btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(ui.shareCode.value).then(() => {
      ui.btnCopyCode.textContent = 'Copied!';
      setTimeout(() => { ui.btnCopyCode.textContent = 'Copy'; }, 1500);
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
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    game = null;
    bothReady = { self: false, opponent: false };
    showScreen('menu');
    setStatus('');
  });

  // Periodic state sync
  setInterval(() => {
    if (game && game.active && net && net.connected) broadcastState();
  }, 500);
})();
