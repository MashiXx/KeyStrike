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
    inputPlayerName: $('input-player-name'),
    menuStatus: $('menu-status'),
    lobbyRoomId: $('lobby-room-id'),
    lobbyStatus: $('lobby-status'),
    lobbyReady: $('lobby-ready'),
    btnReady: $('btn-ready'),
    shareUrl: $('share-url'),
    shareCode: $('share-code'),
    btnCopyUrl: $('btn-copy-url'),
    btnCopyCode: $('btn-copy-code'),
    lobbyShare: $('lobby-share'),
    slotP1: $('slot-p1'),
    slotP2: $('slot-p2'),
    slotP1Loadout: $('slot-p1-loadout'),
    slotP2Name: $('slot-p2-name'),
    slotP2Loadout: $('slot-p2-loadout'),
    slotP2Status: $('slot-p2-status'),
    canvas: $('battle-canvas'),
    sentenceDisplay: $('sentence-display'),
    countdownOverlay: $('countdown-overlay'),
    countdownText: $('countdown-text'),
    comboDisplay: $('combo-display'),
    comboCount: $('combo-count'),
    sabotageOverlay: $('sabotage-overlay'),
    overloadBtn: $('overload-btn'),
    // HUD
    hudSelfName: $('hud-self-name'),
    hudOppName: $('hud-opp-name'),
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

  const typingInput = $('typing-input');
  let net = null;
  let game = null;
  let selectedLoadout = 'warrior';
  let selectedLang = 'en';
  let playerName = '';
  let opponentName = 'Opponent';
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
      left: { hp: 1000, maxHp: 1000, shieldAlpha: 0, healGlow: 0, shakeX: 0, shakeY: 0 },
      right: { hp: 1000, maxHp: 1000, shieldAlpha: 0, healGlow: 0, shakeX: 0, shakeY: 0 },
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
  function sfxHeal() { playTone(700, 0.12, 'sine', 0.06); setTimeout(() => playTone(900, 0.15, 'sine', 0.05), 100); }

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
  // Seeded random for consistent per-castle brick layout
  function seededRand(seed) {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s & 0x7fffffff) / 2147483647;
    };
  }

  // Generate brick layout once per castle (cached)
  const brickCache = {};
  function getBricks(side, w, h, baseX, baseY) {
    const key = side;
    if (brickCache[key] && brickCache[key].w === w) return brickCache[key].bricks;

    const rand = seededRand(side === 'left' ? 12345 : 67890);
    const bricks = [];
    const brickH = 10;
    const rows = Math.floor(h / brickH);

    for (let row = 0; row < rows; row++) {
      const y = baseY - h + row * brickH;
      const offset = (row % 2) * 12; // stagger bricks
      let bx = baseX - w / 2 + offset;
      while (bx < baseX + w / 2) {
        const bw = 16 + Math.floor(rand() * 12);
        const actualW = Math.min(bw, baseX + w / 2 - bx);
        if (actualW > 3) {
          bricks.push({
            x: bx, y, w: actualW, h: brickH - 1,
            // Each brick has a random "strength" — lower ones fall first
            strength: rand(),
            shade: 0.85 + rand() * 0.3,
            fallen: false,
            fallVY: 0, fallY: 0, fallVX: 0, fallRot: 0, fallAlpha: 1,
          });
        }
        bx += actualW + 1;
      }
    }
    brickCache[key] = { bricks, w };
    return bricks;
  }

  // Generate wall brick layout
  const wallBrickCache = {};
  function getWallBricks(side, wallW, wallH, wallX, baseY) {
    const key = side + '_wall';
    if (wallBrickCache[key]) return wallBrickCache[key];

    const rand = seededRand(side === 'left' ? 11111 : 99999);
    const bricks = [];
    const brickH = 9;
    const rows = Math.floor(wallH / brickH);

    for (let row = 0; row < rows; row++) {
      const y = baseY - wallH + row * brickH;
      const offset = (row % 2) * 10;
      let bx = wallX + offset;
      while (bx < wallX + wallW) {
        const bw = 14 + Math.floor(rand() * 10);
        const actualW = Math.min(bw, wallX + wallW - bx);
        if (actualW > 3) {
          bricks.push({
            x: bx, y, w: actualW, h: brickH - 1,
            strength: rand(),
            shade: 0.8 + rand() * 0.25,
            fallen: false,
            fallVY: 0, fallY: 0, fallVX: 0, fallRot: 0, fallAlpha: 1,
          });
        }
        bx += actualW + 1;
      }
    }
    wallBrickCache[key] = bricks;
    return bricks;
  }

  // Get crenellation layout
  function getCrenellations(cx, baseY, h, w) {
    const cw = 14, ch = 18;
    const crens = [];
    for (let i = 0; i < 4; i++) {
      crens.push({
        x: cx - w / 2 + i * (w / 4) + 2,
        y: baseY - h - ch,
        w: cw, h: ch,
      });
    }
    return crens;
  }

  function drawCastle(x, groundY, castleState, side) {
    const shakeX = castleState.shakeX;
    const shakeY = castleState.shakeY;
    const cx = x + shakeX;
    const cy = groundY + shakeY;
    const hpRatio = castleState.hp / castleState.maxHp;
    const dmg = 1 - hpRatio; // 0 = full hp, 1 = dead

    const w = 80, h = 120;
    const baseY = cy - 10;
    const cw = 14, ch = 18;

    // Base wall color — gets darker/redder with damage
    const baseR = Math.floor(55 + dmg * 80);
    const baseG = Math.floor(48 + hpRatio * 20);
    const baseB = Math.floor(42);

    ctx.save();

    // ---- RUBBLE PILE at base (grows with damage) ----
    if (dmg > 0.15) {
      const rubbleCount = Math.floor(dmg * 20);
      const rand = seededRand(side === 'left' ? 3333 : 7777);
      ctx.fillStyle = `rgb(${baseR - 15},${baseG - 10},${baseB - 5})`;
      for (let i = 0; i < rubbleCount; i++) {
        const rx = cx - w * 0.7 + rand() * w * 1.4;
        const ry = baseY - 2 + rand() * 8;
        const rw = 4 + rand() * 10;
        const rh = 3 + rand() * 6;
        ctx.fillRect(rx, ry, rw, rh);
      }
    }

    // ---- SIDE WALL (brick by brick) ----
    const wallW = 50, wallH = 60;
    const wallX = side === 'left' ? cx + w / 2 : cx - w / 2 - wallW;
    const wallBricks = getWallBricks(side, wallW, wallH, wallX - shakeX, baseY - shakeY);

    for (const b of wallBricks) {
      // Bricks with low strength fall first as damage increases
      const fallThreshold = b.strength * 0.85;
      if (dmg > fallThreshold && !b.fallen) {
        b.fallen = true;
        b.fallVY = 1 + Math.random() * 2;
        b.fallVX = (Math.random() - 0.5) * 2;
        b.fallRot = (Math.random() - 0.5) * 0.1;
      }

      if (b.fallen) {
        b.fallY += b.fallVY;
        b.fallVY += 0.3;
        b.fallAlpha = Math.max(0, b.fallAlpha - 0.015);
        if (b.fallAlpha <= 0) continue;
        ctx.globalAlpha = b.fallAlpha;
        ctx.fillStyle = `rgb(${Math.floor(baseR * b.shade - 10)},${Math.floor(baseG * b.shade - 5)},${Math.floor(baseB * b.shade)})`;
        ctx.save();
        ctx.translate(b.x + shakeX + b.w / 2 + b.fallVX * b.fallY * 0.5, b.y + shakeY + b.fallY);
        ctx.rotate(b.fallRot * b.fallY);
        ctx.fillRect(-b.w / 2, 0, b.w, b.h);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgb(${Math.floor(baseR * b.shade - 10)},${Math.floor(baseG * b.shade - 5)},${Math.floor(baseB * b.shade)})`;
        ctx.fillRect(b.x + shakeX, b.y + shakeY, b.w, b.h);
      }
    }

    // Small side tower (disappears when heavily damaged)
    if (dmg < 0.6) {
      ctx.fillStyle = `rgb(${baseR - 5},${baseG - 5},${baseB})`;
      if (side === 'left') {
        const towerH = 20 * (1 - dmg * 0.5);
        ctx.fillRect(cx + w / 2 + wallW - 12 + shakeX * 0.5, baseY - wallH - towerH + shakeY, 16, towerH);
      } else {
        const towerH = 20 * (1 - dmg * 0.5);
        ctx.fillRect(cx - w / 2 - wallW - 4 + shakeX * 0.5, baseY - wallH - towerH + shakeY, 16, towerH);
      }
    }

    // ---- MAIN TOWER (brick by brick) ----
    const bricks = getBricks(side, w, h, cx - shakeX, baseY - shakeY);

    for (const b of bricks) {
      const fallThreshold = b.strength * 0.95 + 0.05;
      if (dmg > fallThreshold && !b.fallen) {
        b.fallen = true;
        b.fallVY = 1 + Math.random() * 3;
        b.fallVX = (Math.random() - 0.5) * 3;
        b.fallRot = (Math.random() - 0.5) * 0.15;
      }

      if (b.fallen) {
        b.fallY += b.fallVY;
        b.fallVY += 0.35;
        b.fallAlpha = Math.max(0, b.fallAlpha - 0.012);
        if (b.fallAlpha <= 0) continue;
        ctx.globalAlpha = b.fallAlpha;
        ctx.fillStyle = `rgb(${Math.floor(baseR * b.shade)},${Math.floor(baseG * b.shade)},${Math.floor(baseB * b.shade)})`;
        ctx.save();
        ctx.translate(b.x + shakeX + b.w / 2 + b.fallVX * b.fallY * 0.5, b.y + shakeY + b.fallY);
        ctx.rotate(b.fallRot * b.fallY);
        ctx.fillRect(-b.w / 2, 0, b.w, b.h);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgb(${Math.floor(baseR * b.shade)},${Math.floor(baseG * b.shade)},${Math.floor(baseB * b.shade)})`;
        ctx.fillRect(b.x + shakeX, b.y + shakeY, b.w, b.h);
      }
    }

    // ---- CRENELLATIONS (top battlements) ----
    const crens = getCrenellations(cx - shakeX, baseY - shakeY, h, w);
    for (let i = 0; i < crens.length; i++) {
      // Crenellations fall at different damage thresholds
      const threshold = 0.2 + i * 0.15;
      if (dmg > threshold) continue; // gone
      const c = crens[i];
      const wobble = dmg > threshold - 0.1 ? Math.sin(Date.now() * 0.01 + i) * dmg * 3 : 0;
      ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
      ctx.fillRect(c.x + shakeX + wobble, c.y + shakeY, c.w, c.h);
    }

    // ---- GATE ----
    if (dmg < 0.85) {
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(cx, baseY, 15, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - 15, baseY - 15, 30, 15);
    }

    // ---- CRACKS on remaining bricks ----
    if (dmg > 0.1 && dmg < 0.9) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      const numCracks = Math.floor(dmg * 12);
      const rand = seededRand(side === 'left' ? 5555 : 8888);
      for (let i = 0; i < numCracks; i++) {
        const crX = cx - w / 3 + rand() * (w * 0.7);
        const crY = baseY - h * 0.2 - rand() * (h * 0.6);
        ctx.beginPath();
        ctx.moveTo(crX, crY);
        ctx.lineTo(crX + 5 + rand() * 8, crY + 8 + rand() * 10);
        ctx.lineTo(crX + rand() * 6 - 3, crY + 16 + rand() * 12);
        ctx.stroke();
      }
    }

    // ---- FIRE / SMOKE when heavily damaged ----
    if (dmg > 0.4) {
      const fireIntensity = (dmg - 0.4) / 0.6;
      const numFlames = Math.floor(fireIntensity * 6);
      const t = Date.now() * 0.003;
      for (let i = 0; i < numFlames; i++) {
        const fx = cx - w * 0.3 + ((i * 37) % w) * 0.8;
        const fy = baseY - h * 0.3 - i * 12;
        const flicker = Math.sin(t + i * 2.1) * 5;

        // Flame glow
        const grad = ctx.createRadialGradient(fx, fy + flicker, 0, fx, fy + flicker, 12 + fireIntensity * 8);
        grad.addColorStop(0, `rgba(255, 200, 50, ${0.6 * fireIntensity})`);
        grad.addColorStop(0.5, `rgba(255, 100, 20, ${0.4 * fireIntensity})`);
        grad.addColorStop(1, 'rgba(255, 50, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx, fy + flicker, 12 + fireIntensity * 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smoke puffs
      if (dmg > 0.55) {
        const smokeCount = Math.floor((dmg - 0.55) * 8);
        for (let i = 0; i < smokeCount; i++) {
          const sx = cx - w * 0.2 + ((i * 51) % w) * 0.5;
          const sy = baseY - h * 0.5 - i * 15 + Math.sin(t * 0.5 + i) * 10;
          const size = 8 + fireIntensity * 12;
          ctx.globalAlpha = 0.15 * fireIntensity;
          ctx.fillStyle = '#444';
          ctx.beginPath();
          ctx.arc(sx, sy - Math.abs(Math.sin(t + i)) * 15, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---- SHIELD GLOW ----
    if (castleState.shieldAlpha > 0) {
      ctx.beginPath();
      ctx.arc(cx, baseY - h / 2, w * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 229, 255, ${castleState.shieldAlpha * 0.15})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0, 229, 255, ${castleState.shieldAlpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      castleState.shieldAlpha = Math.max(0, castleState.shieldAlpha - 0.01);
    }

    // ---- HEAL GLOW ----
    if (castleState.healGlow > 0) {
      const grad = ctx.createRadialGradient(cx, baseY - h / 2, 0, cx, baseY - h / 2, w * 1.3);
      grad.addColorStop(0, `rgba(0, 230, 118, ${castleState.healGlow * 0.25})`);
      grad.addColorStop(0.6, `rgba(0, 230, 118, ${castleState.healGlow * 0.1})`);
      grad.addColorStop(1, 'rgba(0, 230, 118, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, baseY - h / 2, w * 1.3, 0, Math.PI * 2);
      ctx.fill();
      castleState.healGlow = Math.max(0, castleState.healGlow - 0.015);
    }

    // ---- FLAG (falls off when damaged enough) ----
    if (dmg < 0.5) {
      const flagColor = side === 'left' ? '#448aff' : '#e94560';
      const flagWobble = Math.sin(Date.now() * 0.004) * 2;
      ctx.fillStyle = flagColor;
      ctx.fillRect(cx, baseY - h - ch - 25, 2, 25);
      ctx.beginPath();
      ctx.moveTo(cx + 2, baseY - h - ch - 25);
      ctx.lineTo(cx + 18 + flagWobble, baseY - h - ch - 18);
      ctx.lineTo(cx + 2, baseY - h - ch - 11);
      ctx.fill();
    } else if (dmg < 0.7) {
      // Tilted flagpole
      ctx.save();
      ctx.translate(cx, baseY - h - ch);
      ctx.rotate(dmg * 0.8);
      ctx.fillStyle = '#666';
      ctx.fillRect(0, -20, 2, 20);
      ctx.restore();
    }

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

  // ====== HEAL EFFECT ======
  function spawnHealEffect(amount) {
    const cx = render.leftCastleX;
    const baseY = render.groundY - 10;

    // Green rising particles around own castle
    for (let i = 0; i < 15; i++) {
      render.particles.push({
        x: cx - 40 + Math.random() * 80,
        y: baseY - Math.random() * 100,
        vx: (Math.random() - 0.5) * 30,
        vy: -60 - Math.random() * 80,
        life: 1,
        decay: 0.6 + Math.random() * 0.4,
        size: 3 + Math.random() * 4,
        color: '#00e676',
      });
    }

    // Heal number popup
    render.impacts.push({
      x: cx,
      y: baseY - 140,
      radius: 0,
      maxRadius: 30,
      alpha: 1,
      color: '#00e676',
    });

    // Green glow on castle
    render.castles.left.healGlow = 1;
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
      ui.shareUrl.value = location.origin;
      ui.shareCode.value = roomId;
      ui.lobbyShare.style.display = '';
      ui.slotP1.classList.add('slot-connected');
      const nameEl = ui.slotP1.querySelector('.slot-name');
      nameEl.textContent = '';
      nameEl.appendChild(document.createTextNode(playerName + ' '));
      const tag = document.createElement('span');
      tag.className = 'slot-tag';
      tag.textContent = '(Host)';
      nameEl.appendChild(tag);
      ui.slotP1Loadout.textContent = selectedLoadout;
      ui.lobbyStatus.textContent = 'Waiting for opponent to join...';
    };

    net.onRoomJoined = (roomId) => {
      showScreen('lobby');
      // Client view: hide share box, mark self as P2
      ui.lobbyShare.style.display = 'none';
      ui.slotP2.classList.remove('slot-empty');
      ui.slotP2.classList.add('slot-connected');
      ui.slotP2Name.textContent = `${playerName} (You)`;
      ui.slotP2Loadout.textContent = selectedLoadout;
      ui.slotP2Status.innerHTML = '<span class="status-dot connected"></span> Joined';
      ui.lobbyStatus.textContent = 'Connecting to host...';
    };

    net.onOpponentJoined = () => {
      // Host sees opponent join
      ui.slotP2.classList.remove('slot-empty');
      ui.slotP2.classList.add('slot-connected');
      ui.slotP2Name.textContent = 'Player 2';
      ui.slotP2Status.innerHTML = '<span class="status-dot connected"></span> Joined';
      ui.lobbyStatus.textContent = 'Opponent joined! Connecting...';
    };

    net.onConnected = () => {
      // Send our name and loadout to opponent
      net.send({ type: 'player-info', name: playerName, loadout: selectedLoadout });
      ui.lobbyStatus.textContent = 'Both players connected!';
      ui.lobbyReady.style.display = '';
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
      case 'player-info': {
        opponentName = (typeof data.name === 'string' ? data.name : '').trim().substring(0, 16) || 'Opponent';
        // Update opponent slot in lobby
        const oppSlot = net.role === 'host' ? ui.slotP2 : ui.slotP1;
        oppSlot.querySelector('.slot-name').textContent = opponentName;
        const oppLoadoutEl = net.role === 'host' ? ui.slotP2Loadout : ui.slotP1Loadout;
        oppLoadoutEl.textContent = data.loadout || '';
        break;
      }

      case 'ready': {
        bothReady.opponent = true;
        // Mark opponent slot as ready
        const oppSlot = net.role === 'host' ? ui.slotP2 : ui.slotP1;
        oppSlot.classList.add('slot-ready');
        const oppDot = oppSlot.querySelector('.status-dot');
        if (oppDot) oppDot.className = 'status-dot ready';
        const oppStatusEl = oppSlot.querySelector('.slot-status');
        if (oppStatusEl) oppStatusEl.childNodes[oppStatusEl.childNodes.length - 1].textContent = ' Ready';
        if (bothReady.self) {
          ui.lobbyStatus.textContent = 'Both ready! Starting...';
        } else {
          ui.lobbyStatus.textContent = 'Opponent is ready! Press READY';
        }
        checkBothReady();
        break;
      }

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

    game = new Game(net.seed, selectedLoadout, net.lang);

    // Set HUD names
    ui.hudSelfName.textContent = playerName;
    ui.hudOppName.textContent = opponentName;

    game.onShieldGain = () => {
      render.castles.left.shieldAlpha = 1;
      sfxShield();
    };

    game.onHeal = (amount) => {
      spawnHealEffect(amount);
      sfxHeal();
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
    render.castles.left = { hp: 1000, maxHp: 1000, shieldAlpha: 0, healGlow: 0, shakeX: 0, shakeY: 0 };
    render.castles.right = { hp: 1000, maxHp: 1000, shieldAlpha: 0, healGlow: 0, shakeX: 0, shakeY: 0 };

    if (!animFrame) {
      lastTime = performance.now();
      renderLoop(lastTime);
    }

    renderSentence();
    updateHUD();
    initAudio();
    // Focus hidden input for typing (IME support)
    typingInput.value = '';
    typingInput.focus();
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
    typingInput.blur();
    typingInput.value = '';

    ui.gameoverTitle.textContent = result === 'win' ? 'VICTORY' : 'DEFEAT';
    ui.gameoverTitle.className = result === 'win' ? 'win' : 'lose';
    ui.gameoverStats.textContent =
      `Sentences: ${game.self.sentencesCompleted}\n` +
      `Accuracy: ${game.self.accuracy}%\n` +
      `Max Combo: ${game.maxCombo}\n` +
      `Castle HP: ${Math.round(game.self.hp)} / ${game.self.maxHp}`;

    setTimeout(() => showScreen('gameover'), 1500);
  }

  // ====== INPUT (IME-compatible for Vietnamese) ======
  let composing = false;

  // Keep input focused during game
  function focusInput() {
    if (game && game.active) typingInput.focus();
  }

  document.addEventListener('click', focusInput);

  // Track IME composition state
  typingInput.addEventListener('compositionstart', () => { composing = true; });
  typingInput.addEventListener('compositionend', () => {
    composing = false;
    // Process the composed result
    processInputValue();
  });

  // Handle normal (non-IME) input
  typingInput.addEventListener('input', () => {
    if (composing) return; // wait for compositionend
    processInputValue();
  });

  function processInputValue() {
    if (!game || !game.active) { typingInput.value = ''; return; }
    initAudio();

    const val = typingInput.value;
    typingInput.value = '';
    if (!val) return;

    // Process each character from the input (usually 1, but IME can produce multi-char)
    for (const char of val) {
      handleTypedChar(char);
    }
  }

  // Overload on Ctrl+Space (since Space may be part of sentence)
  document.addEventListener('keydown', (e) => {
    if (!game || !game.active) return;

    // Overload: Ctrl+Space or F1
    if ((e.key === ' ' && e.ctrlKey) || e.key === 'F1') {
      e.preventDefault();
      if (game.self.energy >= 100) {
        const projectiles = game.triggerOverload();
        if (projectiles) {
          sfxOverload();
          for (const p of projectiles) {
            setTimeout(() => {
              spawnProjectile('left', p.type, p.damage, false);
              sfxLaunch();
            }, p.delay);
          }
          net.send({ type: 'overload', projectiles });
          updateHUD();
        }
      }
      return;
    }
  });

  function handleTypedChar(char) {
    const result = game.processKey(char);

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
        spawnProjectile('left', result.projectileType, result.damage, result.isCritical);

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
  }

  // ====== BUTTON HANDLERS ======

  // Loadout selection
  document.querySelectorAll('.loadout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.loadout-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLoadout = btn.dataset.loadout;
    });
  });

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLang = btn.dataset.lang;
    });
  });

  function getPlayerName() {
    const name = ui.inputPlayerName.value.trim().substring(0, 16);
    playerName = name || 'Player';
    return playerName;
  }

  ui.btnCreate.addEventListener('click', async () => {
    getPlayerName();
    setStatus('Connecting...');
    initNetwork();
    await net.connectSignaling();
    net.createRoom(selectedLang);
    setStatus('Creating room...');
  });

  ui.btnJoin.addEventListener('click', async () => {
    const roomId = ui.inputRoomId.value.trim();
    if (!roomId) { setStatus('Enter a room code', true); return; }
    getPlayerName();
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
    ui.btnReady.textContent = 'READY!';
    ui.btnReady.style.opacity = '0.6';
    // Mark own slot as ready
    const mySlot = net.role === 'host' ? ui.slotP1 : ui.slotP2;
    mySlot.classList.add('slot-ready');
    const myDot = mySlot.querySelector('.status-dot');
    if (myDot) { myDot.className = 'status-dot ready'; }
    const myStatusText = mySlot.querySelector('.slot-status');
    if (myStatusText) myStatusText.childNodes[myStatusText.childNodes.length - 1].textContent = ' Ready';
    ui.lobbyStatus.textContent = 'Waiting for opponent to ready up...';
    net.send({ type: 'ready' });
    checkBothReady();
  });

  ui.btnMenu.addEventListener('click', () => {
    if (net) net.disconnect();
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    game = null;
    bothReady = { self: false, opponent: false };
    opponentName = 'Opponent';
    // Reset lobby state
    ui.slotP1.className = 'lobby-slot';
    ui.slotP2.className = 'lobby-slot slot-empty';
    ui.slotP2Name.textContent = 'Waiting...';
    ui.slotP2Loadout.textContent = '';
    ui.slotP2Status.innerHTML = '<span class="status-dot"></span> Empty';
    ui.lobbyReady.style.display = 'none';
    ui.btnReady.disabled = false;
    ui.btnReady.textContent = 'READY';
    ui.btnReady.style.opacity = '';
    showScreen('menu');
    setStatus('');
  });

  // Periodic state sync
  setInterval(() => {
    if (game && game.active && net && net.connected) broadcastState();
  }, 500);
})();
