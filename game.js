// KeyStrike - Game Logic
// Castle siege combat system with projectiles, units, shields, overload, sabotage

// Projectile type definitions
const PROJECTILE_TYPES = {
  weakFruit: { name: 'Weak Fruit', baseDamage: 15, speed: 6, color: '#8bc34a', radius: 8, emoji: 'apple', trail: false },
  fruit:     { name: 'Fruit',      baseDamage: 25, speed: 7, color: '#ff9100', radius: 10, emoji: 'orange', trail: false },
  stone:     { name: 'Stone',      baseDamage: 45, speed: 4, color: '#9e9e9e', radius: 14, emoji: 'rock', trail: true },
  rocket:    { name: 'Rocket',     baseDamage: 70, speed: 8, color: '#ff1744', radius: 12, emoji: 'rocket', trail: true, explosion: true },
  bomb:      { name: 'Bomb',       baseDamage: 90, speed: 3, color: '#9c27b0', radius: 16, emoji: 'bomb', trail: true, explosion: true, aoe: true },
  freeze:    { name: 'Freeze',     baseDamage: 30, speed: 7, color: '#00e5ff', radius: 10, emoji: 'freeze', trail: true, sabotage: 'freeze' },
};

// Loadout bonuses
const LOADOUTS = {
  warrior:  { damageMult: 1.2, shieldMult: 1.0, sabotageMult: 1.0 },
  guardian: { damageMult: 1.0, shieldMult: 1.3, sabotageMult: 1.0 },
  saboteur: { damageMult: 1.0, shieldMult: 1.0, sabotageMult: 1.5 },
};

class Game {
  constructor(seed, loadout = 'warrior') {
    this.seed = seed;
    this.rng = this._createRNG(seed);
    this.loadout = LOADOUTS[loadout] || LOADOUTS.warrior;
    this.loadoutName = loadout;

    // Castle state
    this.self = this._createPlayerState();
    this.opponent = this._createPlayerState();

    // Typing state
    this.sentences = this._generateSentences(80);
    this.currentSentenceIndex = 0;
    this.currentCharIndex = 0;
    this.sentenceStartTime = 0;
    this.totalChars = 0;
    this.correctChars = 0;
    this.sentenceErrors = 0;
    this.sentenceChars = 0;

    // Combo: resets on slow typing or too many mistakes
    this.combo = 0;
    this.maxCombo = 0;

    // Sabotage state (received from opponent)
    this.sabotaged = false;
    this.sabotageType = null;
    this.sabotageEndTime = 0;

    // Game state
    this.active = false;
    this.winner = null;

    // Callbacks
    this.onProjectile = null;   // (projectileType, damage, isCritical) => spawn animation
    this.onOverload = null;     // () => overload barrage
    this.onShieldGain = null;   // (amount) =>
    this.onHeal = null;         // (amount) => visual heal effect
    this.onSabotage = null;     // (type, duration) =>
    this.onUnitSpawn = null;    // (unitType) =>
    this.onGameOver = null;     // ('win' | 'lose') =>
  }

  _createPlayerState() {
    return {
      hp: 1000,
      maxHp: 1000,
      shield: 0,         // 0-100, absorbs damage
      energy: 0,         // 0-100, triggers overload at 100
      accuracy: 100,
      speed: 0,
      combo: 0,
      sentencesCompleted: 0,
    };
  }

  // Seeded PRNG (mulberry32)
  _createRNG(seed) {
    let s = seed;
    return () => {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  _generateSentences(count) {
    const pool = [
      "the quick brown fox jumps over the lazy dog",
      "pack my box with five dozen liquor jugs",
      "how vexingly quick daft zebras jump",
      "the five boxing wizards jump quickly",
      "bright vixens jump dozy fowl quack",
      "quick zephyrs blow vexing daft jim",
      "two driven jocks help fax my big quiz",
      "the jay pig fox and zebra quit walking",
      "coding is like poetry but with bugs",
      "every programmer was once a beginner",
      "keep your code clean and simple always",
      "debug the world one line at a time now",
      "software is eating the whole world fast",
      "first solve the problem then write code",
      "the best code is no code at all really",
      "talk is cheap now show me the real code",
      "make it work make it right make it fast",
      "code is read more than it is written now",
      "simplicity is the soul of efficiency here",
      "any fool can write code that a machine can read",
      "programs must be written for people to read",
      "experience is the name we give our mistakes",
      "in theory there is no difference at all",
      "the only way to learn is to start coding",
      "a good developer writes code that works",
      "never trust a computer you cannot throw",
      "keyboard warriors clash in digital combat",
      "speed and precision define a true typist",
      "the fastest fingers win this brutal match",
      "type like your life depends on it right now",
      "accuracy beats speed when the stakes rise",
      "every keystroke counts in this final battle",
      "the castle walls crumble under heavy fire",
      "stay calm and keep typing through the storm",
      "your opponent is faster but you are smarter",
      "launch the catapult and crush their fortress",
      "defend your walls or face total destruction",
      "the siege begins at dawn prepare your troops",
      "arrows fly across the field like angry bees",
      "stone by stone the enemy walls come crashing",
    ];

    const sentences = [];
    for (let i = 0; i < count; i++) {
      sentences.push(pool[Math.floor(this.rng() * pool.length)]);
    }
    return sentences;
  }

  getCurrentSentence() {
    return this.sentences[this.currentSentenceIndex] || '';
  }

  start() {
    this.active = true;
    this.sentenceStartTime = Date.now();
  }

  // Process a keypress
  processKey(char) {
    if (!this.active || this.winner) return { result: 'ignored' };

    // Check sabotage: if frozen, ignore input
    if (this.sabotaged && this.sabotageType === 'freeze' && Date.now() < this.sabotageEndTime) {
      return { result: 'ignored' };
    }
    if (this.sabotaged && Date.now() >= this.sabotageEndTime) {
      this.sabotaged = false;
      this.sabotageType = null;
    }

    const sentence = this.getCurrentSentence();
    const expected = sentence[this.currentCharIndex];

    this.totalChars++;
    this.sentenceChars++;

    if (char === expected) {
      this.correctChars++;
      this.currentCharIndex++;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      // Energy gain from correct typing
      this.self.energy = Math.min(100, this.self.energy + 1);

      if (this.currentCharIndex >= sentence.length) {
        return this._completeSentence();
      }
      return { result: 'correct', charIndex: this.currentCharIndex - 1 };
    } else {
      this.sentenceErrors++;
      // Combo breaks on too many errors (3+ in a sentence)
      if (this.sentenceErrors >= 3) this.combo = 0;
      this._updateAccuracy();
      return { result: 'error', charIndex: this.currentCharIndex };
    }
  }

  _completeSentence() {
    const elapsed = (Date.now() - this.sentenceStartTime) / 1000;
    const sentenceAcc = this._getSentenceAccuracy();

    this.self.speed = elapsed;
    this.self.accuracy = this._getOverallAccuracy();
    this.self.combo = this.combo;
    this.self.sentencesCompleted++;

    // Determine projectile type based on performance
    const projType = this._getProjectileType(elapsed, sentenceAcc);
    const projDef = PROJECTILE_TYPES[projType];

    // Calculate damage
    const comboMult = this._getComboMultiplier();
    let damage = projDef.baseDamage * comboMult * this.loadout.damageMult;

    // Critical hit chance (higher with combo)
    const critChance = Math.min(0.05 + this.combo * 0.02, 0.4);
    const isCritical = this.rng() < critChance;
    if (isCritical) damage *= 1.8;

    damage = Math.round(damage);

    // Perfect sentence grants shield
    let shieldGain = 0;
    if (sentenceAcc >= 100) {
      shieldGain = Math.round(15 * this.loadout.shieldMult);
      this.self.shield = Math.min(100, this.self.shield + shieldGain);
      if (this.onShieldGain) this.onShieldGain(shieldGain);
    }

    // Heal mechanic:
    // - Perfect accuracy: heal 30 HP
    // - 95%+ accuracy + combo >= 5: heal 20 HP
    // - Combo streak milestones (every 10 combo): heal 40 HP
    // - Guardian loadout gets 30% bonus healing
    let healAmount = 0;
    const healMult = this.loadoutName === 'guardian' ? 1.3 : 1.0;

    if (sentenceAcc >= 100) {
      healAmount += 30;
    } else if (sentenceAcc >= 95 && this.combo >= 5) {
      healAmount += 20;
    }

    // Combo milestone heal every 10 combo
    if (this.combo > 0 && this.combo % 10 === 0) {
      healAmount += 40;
    }

    // Fast typing bonus heal (under 2s)
    if (elapsed < 2 && sentenceAcc >= 90) {
      healAmount += 15;
    }

    if (healAmount > 0) {
      healAmount = Math.round(healAmount * healMult);
      const prevHp = this.self.hp;
      this.self.hp = Math.min(this.self.maxHp, this.self.hp + healAmount);
      healAmount = this.self.hp - prevHp; // actual heal (capped at max)
      if (healAmount > 0 && this.onHeal) this.onHeal(healAmount);
    }

    // Check for special projectile triggers
    let sabotageType = null;
    if (projDef.sabotage) {
      sabotageType = projDef.sabotage;
    } else if (this.combo >= 10 && this.rng() < 0.2 * this.loadout.sabotageMult) {
      // High combo can trigger sabotage
      sabotageType = this.rng() < 0.5 ? 'shake' : 'blur';
    }

    // Spawn a unit every 3 sentences
    if (this.self.sentencesCompleted % 3 === 0) {
      const unitType = this.combo >= 8 ? 'knight' : this.combo >= 4 ? 'soldier' : 'peasant';
      if (this.onUnitSpawn) this.onUnitSpawn(unitType);
    }

    // Energy bonus for fast completion
    if (elapsed < 3) this.self.energy = Math.min(100, this.self.energy + 10);

    // Advance to next sentence
    this.currentSentenceIndex++;
    this.currentCharIndex = 0;
    this.sentenceErrors = 0;
    this.sentenceChars = 0;
    this.sentenceStartTime = Date.now();

    return {
      result: 'sentence-complete',
      projectileType: projType,
      damage,
      isCritical,
      combo: this.combo,
      comboMult,
      speed: elapsed,
      accuracy: sentenceAcc,
      shieldGain,
      healAmount,
      sabotageType,
    };
  }

  _getProjectileType(time, accuracy) {
    // Special projectiles (rare)
    if (time < 2 && accuracy >= 100 && this.combo >= 8) {
      return this.rng() < 0.3 ? 'bomb' : (this.rng() < 0.5 ? 'freeze' : 'rocket');
    }
    // Rocket: very fast + high accuracy
    if (time < 3 && accuracy >= 95) return 'rocket';
    // Stone: fast
    if (time < 5 && accuracy >= 85) return 'stone';
    // Fruit: normal
    if (accuracy >= 70) return 'fruit';
    // Weak fruit: slow or many mistakes
    return 'weakFruit';
  }

  _getComboMultiplier() {
    // Combo range: 1x to 5x
    if (this.combo <= 1) return 1;
    if (this.combo <= 3) return 1.5;
    if (this.combo <= 6) return 2;
    if (this.combo <= 10) return 3;
    if (this.combo <= 15) return 4;
    return 5;
  }

  _getSentenceAccuracy() {
    if (this.sentenceChars === 0) return 100;
    return ((this.sentenceChars - this.sentenceErrors) / this.sentenceChars) * 100;
  }

  _getOverallAccuracy() {
    if (this.totalChars === 0) return 100;
    return Math.round((this.correctChars / this.totalChars) * 100);
  }

  _updateAccuracy() {
    this.self.accuracy = this._getOverallAccuracy();
  }

  // Trigger overload: fire rapid barrage
  triggerOverload() {
    if (this.self.energy < 100 || !this.active) return null;
    this.self.energy = 0;
    // Fire 5 rapid projectiles
    const projectiles = [];
    for (let i = 0; i < 5; i++) {
      const types = ['rocket', 'stone', 'stone', 'fruit', 'fruit'];
      const type = types[i];
      const def = PROJECTILE_TYPES[type];
      const damage = Math.round(def.baseDamage * 0.7 * this.loadout.damageMult);
      projectiles.push({ type, damage, isCritical: false, delay: i * 300 });
    }
    return projectiles;
  }

  // Apply incoming damage (from opponent's projectile)
  receiveDamage(damage, sabotageType = null) {
    // Shield absorbs damage
    if (this.self.shield > 0) {
      const absorbed = Math.min(this.self.shield, damage * 0.5);
      damage -= absorbed;
      this.self.shield = Math.max(0, this.self.shield - absorbed * 2);
    }

    this.self.hp = Math.max(0, this.self.hp - damage);

    // Apply sabotage if any
    if (sabotageType) {
      this.sabotaged = true;
      this.sabotageType = sabotageType;
      const duration = sabotageType === 'freeze' ? 2000 : 3000;
      this.sabotageEndTime = Date.now() + duration * this.loadout.sabotageMult;
      if (this.onSabotage) this.onSabotage(sabotageType, duration);
    }

    // Check lose
    if (this.self.hp <= 0) {
      this.self.hp = 0;
      this.active = false;
      this.winner = 'opponent';
      if (this.onGameOver) this.onGameOver('lose');
    }

    return damage;
  }

  // Update opponent display state
  updateOpponent(state) {
    if (state.hp !== undefined) this.opponent.hp = state.hp;
    if (state.shield !== undefined) this.opponent.shield = state.shield;
    if (state.energy !== undefined) this.opponent.energy = state.energy;
    if (state.accuracy !== undefined) this.opponent.accuracy = state.accuracy;
    if (state.speed !== undefined) this.opponent.speed = state.speed;
    if (state.combo !== undefined) this.opponent.combo = state.combo;
  }

  opponentLost() {
    this.active = false;
    this.winner = 'self';
    if (this.onGameOver) this.onGameOver('win');
  }

  getState() {
    return {
      hp: this.self.hp,
      shield: this.self.shield,
      energy: this.self.energy,
      accuracy: this.self.accuracy,
      speed: this.self.speed,
      combo: this.self.combo,
    };
  }
}
