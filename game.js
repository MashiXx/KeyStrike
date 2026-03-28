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
  constructor(seed, loadout = 'warrior', lang = 'en') {
    this.seed = seed;
    this.rng = this._createRNG(seed);
    this.loadout = LOADOUTS[loadout] || LOADOUTS.warrior;
    this.loadoutName = loadout;
    this.lang = lang;

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
    const pools = {
      en: [
        // Fairy tales
        "mirror mirror on the wall who is the fairest of them all",
        "she left behind a single glass slipper on the palace steps",
        "jack climbed the beanstalk and found a castle above the clouds",
        "little red riding hood walked through the dark forest alone",
        "the wolf huffed and puffed and blew the house down",
        "rapunzel rapunzel let down your long golden hair",
        "she bit into the poisoned apple and fell into a deep sleep",
        "the ugly duckling grew into the most beautiful swan of all",
        "he followed the trail of breadcrumbs through the dark woods",
        "the frog turned into a handsome prince with a single kiss",
        "the emperor paraded through town wearing no clothes at all",
        "goldilocks found three bowls of porridge on the table",
        "cinderella danced with the prince until the clock struck midnight",
        "once upon a time in a faraway kingdom there lived a princess",
        "and they all lived happily ever after the end",
        "the magic carpet soared high above the moonlit desert sands",
        "rumpelstiltskin could spin straw into the finest gold",
        // Song lyrics
        "somewhere over the rainbow way up high",
        "let it be let it be whisper words of wisdom",
        "what a wonderful world this could be",
        "yesterday all my troubles seemed so far away",
        "we are the champions my friends",
        "imagine all the people living life in peace",
        "every breath you take every move you make",
        "don't stop believing hold on to that feeling",
        "here comes the sun and i say it's all right",
        "you may say i'm a dreamer but i'm not the only one",
        "i will always love you and i will always care",
        // Quotes and proverbs
        "the only thing we have to fear is fear itself",
        "to be or not to be that is the question",
        "all that glitters is not gold look deeper within",
        "a journey of a thousand miles begins with a single step",
        "the pen is mightier than the sword",
        "actions speak louder than words ever will",
        "where there is a will there is always a way",
        "fortune favors the bold and the brave",
        "knowledge is power guard it well",
        "in the middle of difficulty lies opportunity",
        "not all who wander are lost in this world",
        "the truth will set you free if you let it",
        "it is never too late to be what you might have been",
        "life is what happens when you are busy making other plans",
        "you miss every shot you do not take",
        "stay hungry stay foolish never settle for less",
        "the quick brown fox jumps over the lazy dog",
        "make it work make it right make it fast",
        "well done is better than well said always",
        "the best time to plant a tree was twenty years ago",
        // Fairy tales 2
        "aladdin rubbed the magic lamp three times",
        "the genie granted him three golden wishes",
        "beauty found kindness in the heart of the beast",
        "a rose slowly wilting inside a glass dome",
        "pinocchio wished to become a real boy",
        "every time he lied his nose grew longer",
        "peter pan flew across the midnight sky",
        "all children grow up except one lost boy",
        "second star to the right and straight on till morning",
        "alice fell down the rabbit hole wondering why",
        "off with her head the red queen shouted",
        "curiouser and curiouser said alice looking around",
        "humpty dumpty sat on a high stone wall",
        "the three little pigs built houses of straw",
        "in a hole in the ground there lived a hobbit",
        "one ring to rule them all and in darkness bind them",
        // Literature and movie quotes
        "we are such stuff as dreams are made on",
        "the lady doth protest too much it seems",
        "though she be but little she is fierce",
        "it was the best of times and the worst of times",
        "all animals are equal but some are more equal",
        "it is a truth universally acknowledged by all",
        "so we beat on boats against the current endlessly",
        "may the force be with you always my friend",
        "after all tomorrow is another brand new day",
        "here is looking at you kid always and forever",
        "to infinity and beyond we shall go together",
        "just keep swimming just keep swimming through it all",
        "life is like a box of chocolates they say",
        "you are braver than you believe and stronger too",
        "a dream is a wish your heart makes tonight",
        // Song lyrics 2
        "let it go let it go into the wind and sky",
        "the cold never bothered me anyway she said",
        "under the sea life is better down where its wetter",
        "a whole new world shining shimmering splendid and bright",
        "i see the light and everything has changed now",
        "is this the real life or is this just fantasy",
        "we will rock you sang the crowd together as one",
        "bohemian days and nights under the pale moonlight",
        "i got sunshine on a cloudy day when its cold outside",
        "paint it black i see a red door and want it black",
        "stairway to heaven there is a lady who is sure",
        "sweet child of mine where do we go now",
        "another one bites the dust and another one gone",
        "i can see clearly now the rain is gone at last",
      ],
      vi: [
        // Truyện cổ tích
        "Tấm ơi Tấm đừng khóc nữa hãy nhìn vào giỏ cá đi",
        "Cám giả làm Tấm để vào cung vua nhưng sự thật rồi cũng sáng tỏ",
        "Thạch Sanh vung rìu chém chết chằn tinh cứu công chúa",
        "Lý Thông lừa Thạch Sanh rồi cướp công về làm của mình",
        "Vua Lê Lợi trả gươm thần cho Rùa Vàng giữa hồ",
        "Từ đó hồ mang tên Hồ Gươm hay Hồ Hoàn Kiếm",
        "Cây khế của người em sinh ra toàn quả ngọt lành",
        "Chim phượng hoàng bay đến ăn khế rồi nhả ra vàng bạc",
        "Sọ Dừa tuy xấu xí nhưng có tấm lòng vàng",
        "Nàng út thương Sọ Dừa nên bằng lòng lấy chàng",
        "Sơn Tinh dâng núi cao chống lại nước lũ của Thủy Tinh",
        "Hằng năm Thủy Tinh dâng nước đánh Sơn Tinh nhưng đều thua",
        "Mai An Tiêm bị đày ra đảo hoang giữa biển khơi",
        "Quả dưa hấu đỏ ngọt mọc lên trên hòn đảo hoang vu",
        "Chú Cuội ngồi gốc cây đa trên cung trăng nhìn xuống",
        "Bánh chưng bánh giầy tượng trưng cho đất trời vuông tròn",
        "Lang Liêu được vua cha truyền ngôi nhờ tấm lòng hiếu thảo",
        "Cô Tấm biến thành chim vàng anh bay về hoàng cung",
        "Con cóc là cậu ông trời ai mà đánh cóc thì trời đánh cho",
        "Trâu vàng chạy về phía đông tạo nên hồ Tây ngày nay",
        // Ca dao tục ngữ
        "Có công mài sắt có ngày nên kim",
        "Ăn quả nhớ kẻ trồng cây",
        "Một cây làm chẳng nên non ba cây chụm lại nên hòn núi cao",
        "Đói cho sạch rách cho thơm",
        "Lá lành đùm lá rách",
        "Uống nước nhớ nguồn",
        "Gần mực thì đen gần đèn thì sáng",
        "Tốt gỗ hơn tốt nước sơn",
        "Đường đi khó không khó vì ngăn sông cách núi",
        "Thương người như thể thương thân",
        "Học ăn học nói học gói học mở",
        "Không thầy đố mày làm nên",
        "Kiến tha lâu cũng đầy tổ",
        "Chớ thấy sóng cả mà ngã tay chèo",
        "Đi một ngày đàng học một sàng khôn",
        "Công cha như núi Thái Sơn nghĩa mẹ như nước trong nguồn chảy ra",
        "Anh em như thể tay chân rách lành đùm bọc dở hay đỡ đần",
        "Nhiễu điều phủ lấy giá gương người trong một nước phải thương nhau cùng",
        "Muốn sang thì bắc cầu kiều muốn con hay chữ phải yêu lấy thầy",
        // Lời bài hát
        "Việt Nam quê hương tôi biển lúa mênh mông bao la",
        "Nối vòng tay lớn từ Bắc vô Nam nối liền một dải",
        "Trời xanh đây là của chúng ta núi rừng đây là của chúng ta",
        "Em ơi Hà Nội phố ta còn em mùi hoàng lan",
        "Hà Nội mùa thu cây cơm nguội vàng cây bàng lá đỏ",
        "Sài Gòn đẹp lắm Sài Gòn ơi Sài Gòn ơi",
        "Quê hương là chùm khế ngọt cho con trèo hái mỗi ngày",
        "Từng ngày qua từng tháng năm dài thời gian sẽ mãi trôi đi",
        "Mưa rơi trên phố Huế buồn lắm chiều nay ai có hay",
        "Bụi phấn rơi rơi trắng bàn tay thầy ơi thầy vẫn nghèo lắm",
        // Truyện cổ tích 2
        "Thánh Gióng vươn vai thành tráng sĩ cưỡi ngựa sắt ra trận",
        "Ngựa sắt phun lửa đánh tan quân giặc Ân xâm lược",
        "Thánh Gióng nhổ tre đằng ngà đánh tan quân thù",
        "Chử Đồng Tử gặp nàng Tiên Dung trên bãi cát ven sông",
        "Tiên Dung không quản giàu nghèo bằng lòng lấy Chử Đồng Tử",
        "Mỵ Châu trao nỏ thần cho Trọng Thủy vì tình yêu mù quáng",
        "An Dương Vương xây thành Cổ Loa hình xoáy ốc kiên cố",
        "Lông ngỗng rắc đầy đường để Trọng Thủy đi tìm Mỵ Châu",
        "Hai Bà Trưng cưỡi voi ra trận đánh đuổi quân xâm lược",
        "Bà Triệu muốn cưỡi cơn gió mạnh đạp luồng sóng dữ",
        "Trầu cau có từ câu chuyện tình nghĩa anh em sâu nặng",
        "Hai anh em hoá thành cây trầu quấn quanh cây cau bên tảng đá",
        "Trăm năm trong cõi người ta chữ tài chữ mệnh khéo là ghét nhau",
        "Kiều càng sắc sảo mặn mà so bề tài sắc lại là phần hơn",
        "Nguyễn Du viết truyện Kiều bằng thơ lục bát tuyệt đẹp",
        "Thằng Bờm có cái quạt mo phú ông xin đổi ba bò chín trâu",
        // Ca dao tục ngữ 2
        "Ai bảo chăn trâu là khổ chăn trâu sướng lắm chứ",
        "Chiều chiều ra đứng ngõ sau trông về quê mẹ ruột đau chín chiều",
        "Trời mưa bong bóng phập phồng mẹ đi lấy chồng con ở với ai",
        "Anh đi anh nhớ quê nhà nhớ canh rau muống nhớ cà dầm tương",
        "Rủ nhau xuống bể mò cua đem về nấu quả mơ chua trên rừng",
        "Trên trời mây trắng như bông ở dưới cánh đồng bông trắng như mây",
        "Con cò bay lả bay la bay từ cửa phủ bay ra cánh đồng",
        "Bầu ơi thương lấy bí cùng tuy rằng khác giống nhưng chung một giàn",
        "Cá không ăn muối cá ươn con cãi cha mẹ trăm đường con hư",
        "Ai ơi bưng bát cơm đầy dẻo thơm một hạt đắng cay muôn phần",
        "Trúc xinh trúc mọc đầu đình em xinh em đứng một mình cũng xinh",
        "Thuyền về có nhớ bến chăng bến thì một dạ khăng khăng đợi thuyền",
        "Ơn trời mưa nắng phải thì nơi thì bừa cạn nơi thì cày sâu",
        "Đêm qua ra đứng bờ ao trông cá cá lặn trông sao sao mờ",
        // Lời bài hát 2
        "Như có Bác Hồ trong ngày vui đại thắng",
        "Đường ra trận mùa này đẹp lắm ai cũng muốn đi",
        "Việt Nam đất nước ta ơi mênh mông biển lúa đâu trời đẹp hơn",
        "Đoàn quân Việt Nam đi chung lòng cứu quốc",
        "Mùa xuân nho nhỏ lặng lẽ dâng cho đời",
        "Phố xa mờ trong sương đêm lạnh buồn tênh",
        "Cánh đồng lúa chín vàng mênh mông bát ngát",
        "Dòng sông quê hương chảy qua bao đời bao thế hệ",
        "Diều ơi bay lên cao tít trời xanh thăm thẳm",
        "Chiều nay gió lạnh trên sông Hồng nước chảy đôi dòng",
        "Hạ trắng trời mây phủ ngang tầm mắt ai",
        "Giọt mưa thu rơi nhẹ trên lá vàng bay",
        "Em đẹp như mơ giữa mùa trăng sáng",
        "Tuổi đá buồn một mình lặng lẽ giữa đời",
        "Biển nhớ tên em gọi giữa muôn trùng sóng vỗ",
        "Phượng hồng nở rực trời thương nhớ mùa hè xưa",
        "Bống bống bang bang ai cũng yêu thương nhau",
      ],
    };

    const pool = pools[this.lang] || pools.en;

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
