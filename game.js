// KeyStrike - Game Logic
// Combat system, damage calculation, sentence generation

class Game {
  constructor(seed) {
    this.seed = seed;
    this.rng = this._createRNG(seed);

    // Player state
    this.self = this._createPlayerState();
    this.opponent = this._createPlayerState();

    // Typing state
    this.sentences = this._generateSentences(50);
    this.currentSentenceIndex = 0;
    this.currentCharIndex = 0;
    this.sentenceStartTime = 0;
    this.totalChars = 0;
    this.correctChars = 0;
    this.sentenceErrors = 0;
    this.sentenceChars = 0;

    // Combo system
    this.combo = 0;
    this.lastCorrectTime = 0;

    // Stun state
    this.stunned = false;
    this.stunEndTime = 0;

    // Game state
    this.active = false;
    this.winner = null;

    // Callbacks
    this.onAttack = null;
    this.onStun = null;
    this.onGameOver = null;
  }

  _createPlayerState() {
    return {
      chaos: 0,        // 0-100, lose at 70
      corruption: 0,   // 0-100, stun at 100
      accuracy: 100,
      speed: 0,
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
      "the screen fills with chaos as you falter",
      "stay calm and keep typing through the storm",
      "your opponent is faster but you are smarter",
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

  // Process a keypress, returns { result, char }
  // result: 'correct', 'error', 'sentence-complete', 'ignored' (if stunned)
  processKey(char) {
    if (!this.active || this.winner) return { result: 'ignored' };
    if (this.stunned && Date.now() < this.stunEndTime) return { result: 'ignored' };
    if (this.stunned && Date.now() >= this.stunEndTime) {
      this.stunned = false;
    }

    const sentence = this.getCurrentSentence();
    const expected = sentence[this.currentCharIndex];

    this.totalChars++;
    this.sentenceChars++;

    if (char === expected) {
      this.correctChars++;
      this.currentCharIndex++;
      this._updateCombo(true);

      // Check if sentence complete
      if (this.currentCharIndex >= sentence.length) {
        return this._completeSentence();
      }

      return { result: 'correct', charIndex: this.currentCharIndex - 1 };
    } else {
      // Wrong character
      this.sentenceErrors++;
      this._updateCombo(false);
      this._addCorruption(5);
      this._updateAccuracy();

      return { result: 'error', charIndex: this.currentCharIndex };
    }
  }

  _completeSentence() {
    const elapsed = (Date.now() - this.sentenceStartTime) / 1000;
    this.self.speed = elapsed;
    this.self.sentencesCompleted++;
    this._updateAccuracy();

    // Calculate damage
    const damage = this._calculateDamage(elapsed, this._getSentenceAccuracy());
    const isCritical = this.combo >= 5 && this.rng() < 0.3;
    const finalDamage = isCritical ? damage * 1.5 : damage;

    // Advance to next sentence
    this.currentSentenceIndex++;
    this.currentCharIndex = 0;
    this.sentenceErrors = 0;
    this.sentenceChars = 0;
    this.sentenceStartTime = Date.now();

    // Reset corruption on sentence complete
    this.self.corruption = Math.max(0, this.self.corruption - 20);

    return {
      result: 'sentence-complete',
      damage: finalDamage,
      speed: elapsed,
      accuracy: this.self.accuracy,
      isCritical,
      combo: this.combo,
    };
  }

  _calculateDamage(timeSeconds, accuracy) {
    const baseDamage = 10;

    let speedMult;
    if (timeSeconds < 2) speedMult = 2.0;
    else if (timeSeconds < 4) speedMult = 1.5;
    else if (timeSeconds < 6) speedMult = 1.0;
    else speedMult = 0.7;

    let accMult;
    if (accuracy >= 100) accMult = 1.5;
    else if (accuracy >= 95) accMult = 1.2;
    else if (accuracy >= 90) accMult = 1.0;
    else accMult = 0.8;

    // Combo bonus
    const comboMult = 1 + Math.min(this.combo, 10) * 0.05;

    return baseDamage * speedMult * accMult * comboMult;
  }

  _getSentenceAccuracy() {
    if (this.sentenceChars === 0) return 100;
    return ((this.sentenceChars - this.sentenceErrors) / this.sentenceChars) * 100;
  }

  _updateAccuracy() {
    if (this.totalChars === 0) {
      this.self.accuracy = 100;
    } else {
      this.self.accuracy = Math.round((this.correctChars / this.totalChars) * 100);
    }
  }

  _updateCombo(correct) {
    if (correct) {
      this.combo++;
      this.lastCorrectTime = Date.now();
    } else {
      this.combo = 0;
    }
  }

  _addCorruption(amount) {
    this.self.corruption = Math.min(100, this.self.corruption + amount);

    // Stun check
    if (this.self.corruption >= 100) {
      this.stunned = true;
      const stunDuration = 1000 + this.rng() * 1000; // 1-2 seconds
      this.stunEndTime = Date.now() + stunDuration;
      this.self.corruption = 0;
      if (this.onStun) this.onStun(stunDuration);
    }
  }

  // Apply damage from opponent's attack
  receiveDamage(damage) {
    this.self.chaos = Math.min(100, this.self.chaos + damage);

    // Check lose condition: chaos > 70
    if (this.self.chaos >= 70) {
      this.active = false;
      this.winner = 'opponent';
      if (this.onGameOver) this.onGameOver('lose');
    }
  }

  // Update opponent state from network
  updateOpponent(state) {
    if (state.chaos !== undefined) this.opponent.chaos = state.chaos;
    if (state.corruption !== undefined) this.opponent.corruption = state.corruption;
    if (state.accuracy !== undefined) this.opponent.accuracy = state.accuracy;
    if (state.speed !== undefined) this.opponent.speed = state.speed;
  }

  // Opponent lost (we win)
  opponentLost() {
    this.active = false;
    this.winner = 'self';
    if (this.onGameOver) this.onGameOver('win');
  }
}
