// entry.ts
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { randomInt as cryptoRandomInt, randomBytes, createHash } from "node:crypto";

function randInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  try {
    // cryptoRandomInt is unbiased and much stronger than Math.random().
    return cryptoRandomInt(0, maxExclusive);
  } catch {
    // Fallback that still uses CSPRNG (no Math.random).
    try {
      const mod = 4294967296;
      const limit = mod - mod % maxExclusive;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const v = randomBytes(4).readUInt32BE(0);
        if (v < limit) return v % maxExclusive;
      }
      // As a last resort (should not happen), return 0 deterministically.
      return 0;
    } catch {
      return 0;
    }
  }
}

function sha256Hex(s) {
  try {
    return createHash("sha256").update(String(s)).digest("hex");
  } catch {
    return "";
  }
}

function newProvablyFairRound() {
  // Server-seed (secret until round/game ends). Clients get only commit hash during the round.
  const seed = randomBytes(32).toString("hex");
  const commit = sha256Hex(seed);
  return { pfSeed: seed, pfCommit: commit, pfReveal: null, pfCounter: 0 };
}

function pfRandInt(seed, counter, maxExclusive) {
  // Deterministic unbiased RNG from seed+counter (provably fair).
  if (maxExclusive <= 0) return { n: 0, counter };
  try {
    const mod = 4294967296;
    const limit = mod - mod % maxExclusive;
    let c = counter;
    for (let attempt = 0; attempt < 20; attempt++) {
      const h = createHash("sha256").update(`${seed}:${c}`).digest();
      c++;
      const v = h.readUInt32BE(0);
      if (v < limit) return { n: v % maxExclusive, counter: c };
    }
    // fallback (still deterministic)
    const h = createHash("sha256").update(`${seed}:${counter}`).digest();
    const v = h.readUInt32BE(0);
    return { n: v % maxExclusive, counter: counter + 1 };
  } catch {
    return { n: randInt(maxExclusive), counter };
  }
}

// ../pirate-card-game/lib/game-engine/src/game-logic.ts
var DEFAULT_CARD_COUNTS = {
  petty_thief: 2,
  guard: 6,
  ship_worker: 2,
  swordsman: 2,
  cannon: 2,
  merchant: 2,
  sailor: 1,
  captain: 1,
  spy: 2,
  pirate: 1
};

function sanitizeCardCountsOverride(override) {
  if (!override || typeof override !== "object") return {};
  const clampInt = (v, min, max) => {
    const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
    if (!Number.isFinite(n)) return void 0;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  };
  const guard = clampInt(override.guard, 0, 20);
  const merchant = clampInt(override.merchant, 0, 20);
  const out = {};
  if (guard !== void 0) out.guard = guard;
  if (merchant !== void 0) out.merchant = merchant;
  return out;
}
var CARD_VALUES = {
  petty_thief: 0,
  guard: 1,
  ship_worker: 2,
  swordsman: 3,
  spy: 4,
  cannon: 5,
  merchant: 6,
  sailor: 7,
  captain: 8,
  pirate: 9
};
var CARD_NAMES_BN = {
  petty_thief: "\u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0",
  guard: "\u09AA\u09BE\u09B9\u09BE\u09B0\u09BE\u09A6\u09BE\u09B0",
  ship_worker: "\u099C\u09BE\u09B9\u09BE\u099C \u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0",
  swordsman: "\u09A4\u09B2\u09CB\u09AF\u09BC\u09BE\u09B0\u09AC\u09BE\u099C",
  spy: "\u0997\u09C1\u09AA\u09CD\u09A4\u099A\u09B0",
  cannon: "\u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u0995",
  merchant: "\u09AC\u09A3\u09BF\u0995",
  sailor: "\u09A8\u09BE\u09AC\u09BF\u0995",
  captain: "\u0995\u09CD\u09AF\u09BE\u09AA\u09CD\u099F\u09C7\u09A8",
  pirate: "\u099C\u09B2\u09A6\u09B8\u09CD\u09AF\u09C1"
};
var __LAST_DEAL_SIG = "";
function dealSigFromDeck(a, numPlayers) {
  try {
    // Signature of the initial deal:
    // [first player's draw, all players' first cards (reverse pop order), hidden card]
    // These are the last (numPlayers + 2) cards in the shuffled deck.
    const take = numPlayers + 2;
    if (a.length < take) return "";
    return a.slice(a.length - take).join(",");
  } catch {
    return "";
  }
}
function deckBadScore(a, numPlayers) {
  try {
    if (!numPlayers || numPlayers < 2) return 0;
    try {
      const sig = dealSigFromDeck(a, numPlayers);
      if (sig && __LAST_DEAL_SIG && sig === __LAST_DEAL_SIG) return 1;
    } catch {
    }
    return 0;
  } catch {
    return 0;
  }
}

function shuffle(arr, numPlayers) {
  // Crypto-based randomness. Additionally, avoid repeating the exact same initial deal
  // as the previous game/round (to reduce perceived "patterns").
  for (let attempt = 0; attempt < 4; attempt++) {
    let a = [...arr];
    // Extra mixing + random "cut" to reduce perceived patterns when starting games repeatedly.
    for (let pass = 0; pass < 6; pass++) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
    }
    if (a.length > 1) {
      const cut = randInt(a.length);
      a = a.slice(cut).concat(a.slice(0, cut));
      const cut2 = randInt(a.length);
      a = a.slice(cut2).concat(a.slice(0, cut2));
    }
    const bad = deckBadScore(a, numPlayers);
    if (!bad || attempt === 3) {
      try {
        __LAST_DEAL_SIG = dealSigFromDeck(a, numPlayers) || __LAST_DEAL_SIG;
      } catch {
      }
      return a;
    }
  }
  return [...arr];
}

function reshuffleRemainingDeck(deck) {
  // Lightweight reshuffle of the *remaining* deck before each deal/draw.
  // This matches the requested behavior: every time a card is given, the deck is shuffled again.
  let a = [...deck];
  try {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
    }
    if (a.length > 1) {
      const cut = randInt(a.length);
      a = a.slice(cut).concat(a.slice(0, cut));
      // Extra cut-shuffle (requested): do a second cut for stronger mixing.
      const cut2 = randInt(a.length);
      a = a.slice(cut2).concat(a.slice(0, cut2));
    }
  } catch {
  }
  return a;
}

function reshuffleRemainingDeckPF(deck, state) {
  // If pfSeed exists, reshuffle using deterministic PF RNG; otherwise use normal randomness.
  if (!state?.pfSeed) return { deck: reshuffleRemainingDeck(deck), state };
  let a = [...deck];
  let counter = state.pfCounter ?? 0;
  try {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = a.length - 1; i > 0; i--) {
        const r = pfRandInt(state.pfSeed, counter, i + 1);
        counter = r.counter;
        const j = r.n;
        [a[i], a[j]] = [a[j], a[i]];
      }
    }
    if (a.length > 1) {
      const r = pfRandInt(state.pfSeed, counter, a.length);
      counter = r.counter;
      const cut = r.n;
      a = a.slice(cut).concat(a.slice(0, cut));
      // Extra cut-shuffle (requested): second cut, still deterministic.
      const r2 = pfRandInt(state.pfSeed, counter, a.length);
      counter = r2.counter;
      const cut2 = r2.n;
      a = a.slice(cut2).concat(a.slice(0, cut2));
    }
  } catch {
  }
  return { deck: a, state: { ...state, pfCounter: counter } };
}

function drawAfterReshuffle(deck, history, state) {
  const out = reshuffleRemainingDeckPF(deck, state);
  const d = out.deck;
  const card = d.pop();
  const h = Array.isArray(history) ? [...history.slice(-20), card] : [card];
  return { deck: d, card, history: h, state: out.state };
}
function createDeck(cardCounts = DEFAULT_CARD_COUNTS) {
  const deck = [];
  for (const [id, count] of Object.entries(cardCounts)) {
    for (let i = 0; i < count; i++) deck.push(id);
  }
  return deck;
}

function drawFromDeckRandom(deck, history, numPlayers) {
  // Draw a random card from deck without replacement.
  // Also try to reduce very repetitive perceived patterns like ABAB or AA.
  // This does NOT prevent any specific combo; it only avoids repeating the same local pattern too often.
  const h = Array.isArray(history) ? history.slice(-20) : [];
  const d = [...deck];
  const tries = Math.min(12, d.length);
  const bad = (card) => {
    const n = h.length;
    if (n >= 1 && card === h[n - 1]) return true; // avoid immediate repeat: A A
    // avoid alternating repeat: A B A B (detect A B A and forbid B)
    if (n >= 3 && h[n - 3] === h[n - 1] && card === h[n - 2]) return true;
    // If there are multiple humans/bots, allow a bit more variety by also limiting "same last 2" repeats:
    // X Y X Y style already handled; keep it minimal.
    return false;
  };
  let pickIdx = d.length - 1;
  for (let t = 0; t < tries; t++) {
    const idx = randInt(d.length);
    const card = d[idx];
    if (!bad(card) || t === tries - 1) {
      pickIdx = idx;
      break;
    }
  }
  const [card] = d.splice(pickIdx, 1);
  const nextHistory = [...h, card];
  return { deck: d, card, history: nextHistory };
}
function getTokensToWin(n) {
  return { 2: 7, 3: 5, 4: 4, 5: 3, 6: 3 }[n] ?? 3;
}

function sanitizeTokensToWinOverride(v) {
  const n = v == null ? NaN : typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (t < 3 || t > 10) return null;
  return t;
}
function mustPlayCaptain(hand) {
  return hand.includes("captain") && (hand.includes("cannon") || hand.includes("sailor"));
}
function getActivePlayers(players) {
  return players.filter((p) => !p.isEliminated);
}
function addLog(state, msg) {
  return { ...state, log: [msg, ...state.log].slice(0, 40) };
}
function hasMultipleHumans(players) {
  return players.filter((p) => p.isHuman).length > 1;
}
function initGame(configs, online, cardCountsOverride, tokensToWinOverride) {
  const numPlayers = configs.length;
  const cardCounts = { ...DEFAULT_CARD_COUNTS, ...sanitizeCardCountsOverride(cardCountsOverride) };
  let baseState = { ...newProvablyFairRound() };
  let deck = shuffle(createDeck(cardCounts), numPlayers);
  // draw hidden card randomly too (so the top-of-deck order doesn't dominate perceived patterns)
  let drawHistory = [];
  let hiddenCard;
  ({
    deck,
    card: hiddenCard,
    history: drawHistory,
    state: baseState
  } = drawAfterReshuffle(deck, drawHistory, baseState));
  const tokensOverride = sanitizeTokensToWinOverride(tokensToWinOverride);
  const players = configs.map((cfg, i) => {
    let card;
    ({
      deck,
      card,
      history: drawHistory,
      state: baseState
    } = drawAfterReshuffle(deck, drawHistory, baseState));
    return {
      id: i,
      name: cfg.name,
      isHuman: cfg.isHuman,
      hand: [card],
      discardPile: [],
      tokens: 0,
      isEliminated: false,
      isProtected: false,
      playedThiefThisRound: false
    };
  });
  const firstIsHuman = players[0].isHuman;
  const multiHuman = hasMultipleHumans(players);
  const usePassDevice = firstIsHuman && multiHuman && !online;
  return {
    phase: "playing",
    playStep: usePassDevice ? "pass_device" : "start_turn",
    players,
    deck,
    hiddenCard,
    cardCounts,
    currentPlayerIndex: 0,
    cardBeingPlayed: null,
    targetPlayerIndex: null,
    guessedCardId: null,
    merchantOptions: null,
    peekCard: null,
    resultMessage: "",
    round: 1,
    tokensToWin: tokensOverride ?? getTokensToWin(numPlayers),
    tokensToWinOverride: tokensOverride,
    drawHistory,
    log: [`\u09B0\u09BE\u0989\u09A8\u09CD\u09A1 \u09E7 \u09B6\u09C1\u09B0\u09C1!`, `\u09B6\u09BE\u09AB\u09B2 \u09B9\u09CD\u09AF\u09BE\u09B6: ${baseState.pfCommit.slice(0, 16)}`],
    isOnline: online ?? false,
    pfCommit: baseState.pfCommit,
    pfReveal: null,
    pfSeed: baseState.pfSeed,
    pfCounter: baseState.pfCounter,
    botMem: {}
  };
}
function beginTurn(state) {
  const idx = state.currentPlayerIndex;
  let players = state.players.map((p, i) => {
    if (i === idx && p.isProtected) return { ...p, isProtected: false };
    return p;
  });
  if (state.deck.length === 0) {
    return checkRoundEnd({ ...state, players });
  }
  let deck = [...state.deck];
  let drawHistory = state.drawHistory ?? [];
  let drawn;
  ({
    deck,
    card: drawn,
    history: drawHistory,
    state
  } = drawAfterReshuffle(deck, drawHistory, state));
  players = players.map(
    (p, i) => i === idx ? { ...p, hand: [...p.hand, drawn] } : p
  );
  const player = players[idx];
  const step = player.isHuman ? "select_card" : "ai_turn";
  // This player's hand changed (drew + will play) → stale bot memory about them must be cleared.
  const memCleared = { ...(state.botMem ?? {}) };
  delete memCleared[idx];
  return addLog(
    {
      ...state,
      deck,
      players,
      drawHistory,
      cardBeingPlayed: null,
      targetPlayerIndex: null,
      guessedCardId: null,
      merchantOptions: null,
      peekCard: null,
      resultMessage: "",
      playStep: step,
      botMem: memCleared
    },
    `${player.name}-\u098F\u09B0 \u09AA\u09BE\u09B2\u09BE\u0964`
  );
}
function getValidTargets(state, cardId) {
  const active = getActivePlayers(state.players);
  const cardsThatNeedTarget = ["guard", "ship_worker", "swordsman", "cannon", "sailor"];
  if (!cardsThatNeedTarget.includes(cardId)) return [];
  return active.filter((p) => {
    if (cardId === "cannon") return true;
    return p.id !== state.currentPlayerIndex && !p.isProtected;
  }).map((p) => p.id);
}
function eliminatePlayer(players, idx, discardedCard) {
  return players.map((p, i) => {
    if (i !== idx) return p;
    const hand = p.hand;
    return {
      ...p,
      isEliminated: true,
      hand: [],
      discardPile: discardedCard ? [...p.discardPile, discardedCard, ...hand] : [...p.discardPile, ...hand]
    };
  });
}
function playCard(state, cardIndex) {
  const player = state.players[state.currentPlayerIndex];
  // Captain rule: if Captain + (Cannon or Sailor) is in hand, player MUST play Captain.
  // Enforce on server too (otherwise clients can bypass).
  if (mustPlayCaptain(player.hand) && player.hand[cardIndex] !== "captain") {
    throw new Error("must_play_captain");
  }
  const cardId = player.hand[cardIndex];
  const newHand = player.hand.filter((_, i) => i !== cardIndex);
  let players = state.players.map(
    (p, i) => i === state.currentPlayerIndex ? { ...p, hand: newHand, discardPile: [...p.discardPile, cardId] } : p
  );
  let s = { ...state, players, cardBeingPlayed: cardId };
  if (cardId === "pirate") {
    players = eliminatePlayer(players, state.currentPlayerIndex);
    s = addLog({ ...s, players }, `${player.name} \u099C\u09B2\u09A6\u09B8\u09CD\u09AF\u09C1 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8 \u098F\u09AC\u0982 \u09AC\u09BE\u09A6 \u09AA\u09A1\u09BC\u09C7\u099B\u09C7\u09A8!`);
    return resolveEndOfPlay(s);
  }
  const validTargets = getValidTargets(s, cardId);
  if (cardId === "spy") {
    players = s.players.map(
      (p, i) => i === state.currentPlayerIndex ? { ...p, isProtected: true } : p
    );
    s = addLog({ ...s, players, resultMessage: `${player.name} \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09AA\u09BE\u09B2\u09BE \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09B8\u09C1\u09B0\u0995\u09CD\u09B7\u09BF\u09A4\u0964` }, `${player.name} \u0997\u09C1\u09AA\u09CD\u09A4\u099A\u09B0 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8 \u2014 \u09B8\u09C1\u09B0\u0995\u09CD\u09B7\u09BF\u09A4!`);
    return { ...s, playStep: "show_result" };
  }
  if (cardId === "captain") {
    s = addLog({ ...s, resultMessage: `${player.name} \u0995\u09CD\u09AF\u09BE\u09AA\u09CD\u099F\u09C7\u09A8 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8 \u2014 \u0995\u09CB\u09A8\u09CB \u09AA\u09CD\u09B0\u09AD\u09BE\u09AC \u09A8\u09C7\u0987\u0964` }, `${player.name} \u0995\u09CD\u09AF\u09BE\u09AA\u09CD\u099F\u09C7\u09A8 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8\u0964`);
    return { ...s, playStep: "show_result" };
  }
  if (cardId === "petty_thief") {
    players = s.players.map(
      (p, i) => i === state.currentPlayerIndex ? { ...p, playedThiefThisRound: true } : p
    );
    s = addLog({ ...s, players, resultMessage: `${player.name} \u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8 \u2014 \u098F\u0987 \u09B0\u09BE\u0989\u09A8\u09CD\u09A1\u09C7 \u098F\u0995\u09AE\u09BE\u09A4\u09CD\u09B0 \u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0 \u09B9\u09B2\u09C7 \u098F\u09AC\u0982 \u099F\u09BF\u0995\u09C7 \u09A5\u09BE\u0995\u09B2\u09C7 \u09AC\u09CB\u09A8\u09BE\u09B8 \u099F\u09CB\u0995\u09C7\u09A8 \u09AA\u09BE\u09AC\u09C7\u09A8!` }, `${player.name} \u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0 \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8\u0964`);
    return { ...s, playStep: "show_result" };
  }
  if (cardId === "merchant") {
    let deck = [...s.deck];
    const extra = [];
    let st2 = s;
    let dh = st2.drawHistory ?? [];
    if (deck.length > 0) {
      let card;
      ({ deck, card, history: dh, state: st2 } = drawAfterReshuffle(deck, dh, st2));
      extra.push(card);
    }
    if (deck.length > 0) {
      let card;
      ({ deck, card, history: dh, state: st2 } = drawAfterReshuffle(deck, dh, st2));
      extra.push(card);
    }
    const merchantOptions = [...newHand, ...extra];
    s = { ...st2, deck, drawHistory: dh, merchantOptions };
    if (player.isHuman) {
      return { ...s, playStep: "merchant_select" };
    } else {
      return aiMerchantSelect(s);
    }
  }
  if (validTargets.length === 0 && ["guard", "ship_worker", "swordsman", "sailor"].includes(cardId)) {
    s = addLog({ ...s, resultMessage: `\u0995\u09CB\u09A8\u09CB \u09AC\u09C8\u09A7 \u09B2\u0995\u09CD\u09B7\u09CD\u09AF \u09A8\u09C7\u0987 \u2014 ${CARD_NAMES_BN[cardId]} \u098F\u09B0 \u0995\u09CB\u09A8\u09CB \u09AA\u09CD\u09B0\u09AD\u09BE\u09AC \u09A8\u09C7\u0987\u0964` }, `${player.name} ${CARD_NAMES_BN[cardId]} \u0996\u09C7\u09B2\u09C7\u099B\u09C7\u09A8 \u2014 \u0995\u09CB\u09A8\u09CB \u09B2\u0995\u09CD\u09B7\u09CD\u09AF \u09A8\u09C7\u0987\u0964`);
    return { ...s, playStep: "show_result" };
  }
  if (["guard", "ship_worker", "swordsman", "cannon", "sailor"].includes(cardId)) {
    if (player.isHuman) {
      return { ...s, playStep: "select_target" };
    } else {
      return aiSelectTarget(s, validTargets);
    }
  }
  return resolveEndOfPlay(s);
}
function resolveWithTarget(state, targetIdx) {
  const cardId = state.cardBeingPlayed;
  const s = { ...state, targetPlayerIndex: targetIdx };
  if (cardId === "guard") {
    if (s.players[s.currentPlayerIndex].isHuman) {
      return { ...s, playStep: "select_guess" };
    } else {
      return aiGuardGuess(s, targetIdx);
    }
  }
  if (cardId === "ship_worker") {
    const target = s.players[targetIdx];
    const peekCard = target.hand[0] ?? null;
    const msg = `${s.players[s.currentPlayerIndex].name} ${target.name}-\u098F\u09B0 \u0995\u09BE\u09B0\u09CD\u09A1 \u09A6\u09C7\u0996\u09C7\u099B\u09C7\u09A8\u0964`;
    // If attacker is a bot, remember the peeked card for future smart play.
    let s2 = s;
    const attacker = s.players[s.currentPlayerIndex];
    if (attacker && !attacker.isHuman && peekCard) s2 = setMem(s, targetIdx, peekCard);
    return addLog(
      { ...s2, peekCard, resultMessage: `${target.name}-\u098F\u09B0 \u09B9\u09BE\u09A4\u09C7 \u0986\u099B\u09C7: ${peekCard ? CARD_NAMES_BN[peekCard] : "???"}`, playStep: "peek_result" },
      msg
    );
  }
  if (cardId === "swordsman") {
    return resolveSwordsman(s, targetIdx);
  }
  if (cardId === "cannon") {
    return resolveCannon(s, targetIdx);
  }
  if (cardId === "sailor") {
    return resolveSailor(s, targetIdx);
  }
  return resolveEndOfPlay(s);
}
function resolveGuard(state, guessedCard) {
  const target = state.players[state.targetPlayerIndex];
  const attacker = state.players[state.currentPlayerIndex];
  let players = state.players;
  let msg = "";
  if (target.hand.length > 0 && target.hand[0] === guessedCard) {
    players = eliminatePlayer(players, target.id);
    msg = `${attacker.name} ${CARD_NAMES_BN[guessedCard]} \u0985\u09A8\u09C1\u09AE\u09BE\u09A8 \u0995\u09B0\u09C7\u099B\u09C7\u09A8 \u2014 \u09B8\u09A0\u09BF\u0995! ${target.name} \u09AC\u09BE\u09A6 \u09AA\u09A1\u09BC\u09C7\u099B\u09C7\u09A8!`;
  } else {
    msg = `${attacker.name} ${CARD_NAMES_BN[guessedCard]} \u0985\u09A8\u09C1\u09AE\u09BE\u09A8 \u0995\u09B0\u09C7\u099B\u09C7\u09A8 \u2014 \u09AD\u09C1\u09B2\u0964 ${target.name} \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u0964`;
  }
  const s = addLog({ ...state, players, guessedCardId: guessedCard, resultMessage: msg }, msg);
  return { ...s, playStep: "show_result" };
}
function resolveSwordsman(state, targetIdx) {
  const attacker = state.players[state.currentPlayerIndex];
  const target = state.players[targetIdx];
  const attackerCard = attacker.hand[0];
  const targetCard = target.hand[0];
  const attackerVal = attackerCard ? CARD_VALUES[attackerCard] : -1;
  const targetVal = targetCard ? CARD_VALUES[targetCard] : -1;
  let players = state.players;
  let msg = "";
  if (attackerVal > targetVal) {
    players = eliminatePlayer(players, targetIdx);
    msg = `${attacker.name} \u09AC\u09A8\u09BE\u09AE ${target.name} \u2014 ${target.name} \u09B9\u09C7\u09B0\u09C7\u099B\u09C7\u09A8!`;
  } else if (targetVal > attackerVal) {
    players = eliminatePlayer(players, state.currentPlayerIndex);
    msg = `${attacker.name} \u09AC\u09A8\u09BE\u09AE ${target.name} \u2014 ${attacker.name} \u09B9\u09C7\u09B0\u09C7\u099B\u09C7\u09A8!`;
  } else {
    msg = `${attacker.name} \u09AC\u09A8\u09BE\u09AE ${target.name} \u2014 \u099F\u09BE\u0987! \u0995\u09C7\u0989 \u09AC\u09BE\u09A6 \u09AA\u09A1\u09BC\u09C7\u09A8\u09A8\u09BF\u0964`;
  }
  const s = addLog({ ...state, players, resultMessage: msg }, msg);
  return { ...s, playStep: "show_result" };
}
function resolveCannon(state, targetIdx) {
  const attacker = state.players[state.currentPlayerIndex];
  const target = state.players[targetIdx];
  let players = state.players;
  let deck = [...state.deck];
  let st2 = state;
  let dh = st2.drawHistory ?? [];
  let msg = "";
  if (target.isProtected && targetIdx !== state.currentPlayerIndex) {
    msg = `${target.name} \u09B8\u09C1\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u2014 \u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u0995\u09C7\u09B0 \u0995\u09CB\u09A8\u09CB \u09AA\u09CD\u09B0\u09AD\u09BE\u09AC \u09A8\u09C7\u0987!`;
  } else {
    const discarded = target.hand[0];
    const isPirate = discarded === "pirate";
    if (deck.length > 0) {
      let newCard;
      ({ deck, card: newCard, history: dh, state: st2 } = drawAfterReshuffle(deck, dh, st2));
      if (isPirate) {
        players = eliminatePlayer(players, targetIdx, discarded);
        msg = `${attacker.name} ${target.name}-\u098F\u09B0 \u0989\u09AA\u09B0 \u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u09BF\u09AF\u09BC\u09C7\u099B\u09C7\u09A8 \u2014 \u09A4\u09BF\u09A8\u09BF \u099C\u09B2\u09A6\u09B8\u09CD\u09AF\u09C1 \u09A1\u09BF\u09B8\u0995\u09BE\u09B0\u09CD\u09A1 \u0995\u09B0\u09C7 \u09AC\u09BE\u09A6 \u09AA\u09A1\u09BC\u09C7\u099B\u09C7\u09A8!`;
      } else {
        players = players.map(
          (p, i) => i === targetIdx ? { ...p, hand: [newCard], discardPile: discarded ? [...p.discardPile, discarded] : p.discardPile } : p
        );
        msg = `${attacker.name} ${target.name}-\u098F\u09B0 \u0989\u09AA\u09B0 \u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u09BF\u09AF\u09BC\u09C7\u099B\u09C7\u09A8 \u2014 ${discarded ? CARD_NAMES_BN[discarded] : "?"} \u09A1\u09BF\u09B8\u0995\u09BE\u09B0\u09CD\u09A1 \u0995\u09B0\u09C7 \u09A8\u09A4\u09C1\u09A8 \u0995\u09BE\u09B0\u09CD\u09A1 \u09A8\u09BF\u09AF\u09BC\u09C7\u099B\u09C7\u09A8\u0964`;
      }
    } else {
      msg = `${attacker.name} ${target.name}-\u098F\u09B0 \u0989\u09AA\u09B0 \u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u09BF\u09AF\u09BC\u09C7\u099B\u09C7\u09A8 \u2014 \u09A1\u09C7\u0995 \u0996\u09BE\u09B2\u09BF! \u09A8\u09A4\u09C1\u09A8 \u0995\u09BE\u09B0\u09CD\u09A1 \u09A8\u09C7\u0987\u0964`;
      if (isPirate) {
        players = eliminatePlayer(players, targetIdx, discarded);
        msg += ` ${target.name} \u099C\u09B2\u09A6\u09B8\u09CD\u09AF\u09C1 \u09A1\u09BF\u09B8\u0995\u09BE\u09B0\u09CD\u09A1 \u0995\u09B0\u09C7 \u09AC\u09BE\u09A6 \u09AA\u09A1\u09BC\u09C7\u099B\u09C7\u09A8!`;
      } else {
        players = players.map(
          (p, i) => i === targetIdx ? { ...p, hand: [], discardPile: discarded ? [...p.discardPile, discarded] : p.discardPile } : p
        );
      }
    }
  }
  // Cannon changed target's card → invalidate any memory bots had about them.
  let sCM = { ...st2, players, deck, drawHistory: dh, resultMessage: msg };
  sCM = clearMem(sCM, targetIdx);
  const s = addLog(sCM, msg);
  return { ...s, playStep: "show_result" };
}
function resolveSailor(state, targetIdx) {
  const attacker = state.players[state.currentPlayerIndex];
  const target = state.players[targetIdx];
  const attackerHand = attacker.hand;
  const targetHand = target.hand;
  const players = state.players.map((p, i) => {
    if (i === state.currentPlayerIndex) return { ...p, hand: targetHand };
    if (i === targetIdx) return { ...p, hand: attackerHand };
    return p;
  });
  const msg = `${attacker.name} ${target.name}-\u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09B9\u09BE\u09A4 \u09AC\u09A6\u09B2 \u0995\u09B0\u09C7\u099B\u09C7\u09A8!`;
  // After swap: bots involved gain perfect info about the other player's new hand.
  let s = { ...state, players, resultMessage: msg };
  // Attacker now holds target's old card; target now holds attacker's old card (single-card hand each).
  const targetOldCard = targetHand[0] ?? null;
  const attackerOldCard = attackerHand[0] ?? null;
  if (!attacker.isHuman && attackerOldCard) s = setMem(s, targetIdx, attackerOldCard);
  else s = clearMem(s, targetIdx);
  if (!target.isHuman && targetOldCard) s = setMem(s, state.currentPlayerIndex, targetOldCard);
  else s = clearMem(s, state.currentPlayerIndex);
  s = addLog(s, msg);
  return { ...s, playStep: "show_result" };
}
// ======================= SMART AI HELPERS =======================
function getUnseenCounts(state, selfIdx) {
  const counts = { ...(state.cardCounts ?? DEFAULT_CARD_COUNTS) };
  for (const p of state.players) {
    for (const d of p.discardPile) counts[d] = (counts[d] ?? 0) - 1;
  }
  const self = state.players[selfIdx];
  if (self) for (const c of self.hand) counts[c] = (counts[c] ?? 0) - 1;
  // Known opponent cards (from peeks etc) also reduce unseen pool
  const mem = state.botMem ?? {};
  for (const k of Object.keys(mem)) {
    const idx = Number(k);
    if (idx === selfIdx) continue;
    const known = mem[k];
    if (known) counts[known] = (counts[known] ?? 0) - 1;
  }
  for (const k of Object.keys(counts)) if (counts[k] < 0) counts[k] = 0;
  return counts;
}
function totalCount(counts) {
  let t = 0; for (const k of Object.keys(counts)) t += counts[k] ?? 0; return t;
}
function knownCard(state, idx) {
  const mem = state.botMem ?? {};
  return mem[idx] ?? null;
}
// Probability distribution for opponent oppIdx from selfIdx POV.
function oppDist(state, selfIdx, oppIdx) {
  const known = knownCard(state, oppIdx);
  if (known) return { [known]: 1 };
  const counts = getUnseenCounts(state, selfIdx);
  const total = totalCount(counts);
  if (total <= 0) return {};
  const out = {};
  for (const k of Object.keys(counts)) if (counts[k] > 0) out[k] = counts[k] / total;
  return out;
}
function expectedValue(dist) {
  let e = 0; for (const k of Object.keys(dist)) e += (CARD_VALUES[k] ?? 0) * dist[k]; return e;
}
function probHigherThan(dist, val) {
  let p = 0; for (const k of Object.keys(dist)) if ((CARD_VALUES[k] ?? 0) > val) p += dist[k]; return p;
}
function probEqualOrHigher(dist, val) {
  let p = 0; for (const k of Object.keys(dist)) if ((CARD_VALUES[k] ?? 0) >= val) p += dist[k]; return p;
}
function probIs(dist, card) { return dist[card] ?? 0; }
function setMem(state, idx, card) {
  const mem = { ...(state.botMem ?? {}) };
  mem[idx] = card;
  return { ...state, botMem: mem };
}
function clearMem(state, idx) {
  const mem = { ...(state.botMem ?? {}) };
  delete mem[idx];
  return { ...state, botMem: mem };
}
function clearAllMem(state) { return { ...state, botMem: {} }; }

function listOpponents(state, selfIdx, requireTargetable) {
  return state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== selfIdx && !p.isEliminated && (!requireTargetable || !p.isProtected))
    .map(({ i }) => i);
}

function pickBestGuardTarget(state, selfIdx) {
  const opps = listOpponents(state, selfIdx, true);
  if (opps.length === 0) return null;
  // Prefer opponents we have memory of (likely guaranteed kill), else opp with highest tokens
  let best = opps[0]; let bestScore = -Infinity;
  for (const idx of opps) {
    let score = 0;
    if (knownCard(state, idx) && knownCard(state, idx) !== "guard") score += 1000;
    score += (state.players[idx].tokens ?? 0) * 5;
    if (score > bestScore) { bestScore = score; best = idx; }
  }
  return best;
}
function pickBestThreatTarget(state, selfIdx) {
  // Target whoever has the highest expected card value (most threatening) and tokens
  const opps = listOpponents(state, selfIdx, true);
  if (opps.length === 0) return null;
  let best = opps[0]; let bestScore = -Infinity;
  for (const idx of opps) {
    const dist = oppDist(state, selfIdx, idx);
    const ev = expectedValue(dist);
    const score = ev * 10 + (state.players[idx].tokens ?? 0) * 3;
    if (score > bestScore) { bestScore = score; best = idx; }
  }
  return best;
}

function aiMerchantSelect(state) {
  const options = state.merchantOptions;
  // Never keep pirate (auto-lose if discarded later by cannon).
  const nonPirate = options.filter((c) => c !== "pirate");
  const pool = nonPirate.length > 0 ? nonPirate : options;
  // Late game (few cards left): prefer mid-value cards to survive showdown. Otherwise pick highest playable value.
  const deckSize = state.deck?.length ?? 0;
  let best;
  if (deckSize <= 1) {
    // Showdown looming: keep the highest card.
    best = pool.reduce((a, b) => (CARD_VALUES[a] >= CARD_VALUES[b] ? a : b));
  } else {
    // Otherwise prefer cards that are powerful to play (cannon/sailor/swordsman/guard memory),
    // but avoid keeping captain when we have neither cannon nor sailor next (it's dead weight),
    // and avoid keeping spy if we're already protected. Use a utility score.
    const scoreCard = (c) => {
      const v = CARD_VALUES[c] ?? 0;
      let s = v;
      if (c === "guard") s += 1; // flexible
      if (c === "ship_worker") s += 1;
      if (c === "spy") s += 2; // protection is great
      if (c === "merchant") s += 1;
      if (c === "captain") s -= 1; // captain alone is passive
      if (c === "petty_thief") s -= 2; // weak unless solo thief
      return s;
    };
    best = pool.reduce((a, b) => (scoreCard(a) >= scoreCard(b) ? a : b));
  }
  const keptIdx = options.indexOf(best);
  return merchantSelect(state, keptIdx);
}
function merchantSelect(state, keepIndex) {
  const options = state.merchantOptions;
  const kept = options[keepIndex];
  const rest = options.filter((_, i) => i !== keepIndex);
  let deck;
  if (state?.pfSeed) {
    const out = reshuffleRemainingDeckPF([...rest, ...state.deck], state);
    deck = out.deck;
    state = out.state;
  } else {
    deck = shuffle([...rest, ...state.deck]);
  }
  const players = state.players.map(
    (p, i) => i === state.currentPlayerIndex ? { ...p, hand: [kept] } : p
  );
  const player = state.players[state.currentPlayerIndex];
  const msg = `${player.name} \u09AC\u09A3\u09BF\u0995 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u09A1 \u09B0\u09C7\u0996\u09C7\u099B\u09C7\u09A8\u0964`;
  const s = addLog({ ...state, players, deck, merchantOptions: null, resultMessage: msg }, msg);
  return { ...s, playStep: "show_result" };
}
function aiSelectTarget(state, validTargets) {
  const selfIdx = state.currentPlayerIndex;
  const me = state.players[selfIdx];
  const cardBeing = state.cardBeingPlayed;
  const myOther = me.hand[0];
  const myVal = myOther ? (CARD_VALUES[myOther] ?? 0) : 0;
  let targetIdx;
  if (cardBeing === "guard") {
    targetIdx = pickBestGuardTarget(state, selfIdx) ?? validTargets[0];
    if (!validTargets.includes(targetIdx)) targetIdx = validTargets[0];
    return aiGuardGuess({ ...state, targetPlayerIndex: targetIdx }, targetIdx);
  }
  if (cardBeing === "cannon") {
    let best = null; let bestScore = -Infinity;
    for (const idx of validTargets) {
      if (idx === selfIdx) {
        const onlyOption = validTargets.length === 1;
        const score = onlyOption ? 0 : (myVal <= 1 ? -5 : -50);
        if (score > bestScore) { bestScore = score; best = idx; }
        continue;
      }
      const known = knownCard(state, idx);
      if (known === "pirate") return resolveWithTarget({ ...state, targetPlayerIndex: idx }, idx);
      const dist = oppDist(state, selfIdx, idx);
      let score = expectedValue(dist) * 10 + (state.players[idx].tokens ?? 0) * 4;
      score += (dist["pirate"] ?? 0) * 500;
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    targetIdx = best ?? validTargets[0];
    return resolveWithTarget({ ...state, targetPlayerIndex: targetIdx }, targetIdx);
  }
  if (cardBeing === "swordsman") {
    let best = validTargets[0]; let bestProb = -1;
    for (const idx of validTargets) {
      const dist = oppDist(state, selfIdx, idx);
      let pWin = 0; for (const k of Object.keys(dist)) if ((CARD_VALUES[k] ?? 0) < myVal) pWin += dist[k];
      if (pWin > bestProb) { bestProb = pWin; best = idx; }
    }
    return resolveWithTarget({ ...state, targetPlayerIndex: best }, best);
  }
  if (cardBeing === "sailor") {
    let best = validTargets[0]; let bestEV = -Infinity;
    for (const idx of validTargets) {
      const ev = expectedValue(oppDist(state, selfIdx, idx));
      if (ev > bestEV) { bestEV = ev; best = idx; }
    }
    return resolveWithTarget({ ...state, targetPlayerIndex: best }, best);
  }
  // ship_worker default: pick high-token opp we don't already know
  let best = validTargets[0]; let bestScore = -Infinity;
  for (const idx of validTargets) {
    const known = knownCard(state, idx) ? 1 : 0;
    const score = -known * 100 + (state.players[idx].tokens ?? 0) * 5 + expectedValue(oppDist(state, selfIdx, idx));
    if (score > bestScore) { bestScore = score; best = idx; }
  }
  return resolveWithTarget({ ...state, targetPlayerIndex: best }, best);
}
function aiGuardGuess(state, targetIdx) {
  const selfIdx = state.currentPlayerIndex;
  const guessable = ["ship_worker", "swordsman", "cannon", "merchant", "sailor", "captain", "spy", "pirate", "petty_thief"];
  const known = knownCard(state, targetIdx);
  if (known && guessable.includes(known)) {
    return resolveGuard({ ...state, targetPlayerIndex: targetIdx }, known);
  }
  const dist = oppDist(state, selfIdx, targetIdx);
  let best = null; let bestP = -1;
  for (const id of guessable) {
    const p = dist[id] ?? 0;
    if (p > bestP) { bestP = p; best = id; }
  }
  if (!best) best = guessable[randInt(guessable.length)];
  return resolveGuard({ ...state, targetPlayerIndex: targetIdx }, best);
}
function acknowledgeResult(state) {
  return resolveEndOfPlay(state);
}
function resolveEndOfPlay(state) {
  const roundEnd = checkRoundEnd(state);
  if (roundEnd.phase !== "playing") return roundEnd;
  return advanceToNextPlayer(roundEnd);
}
function advanceToNextPlayer(state) {
  const active = getActivePlayers(state.players);
  if (active.length <= 1) return checkRoundEnd(state);
  let next = (state.currentPlayerIndex + 1) % state.players.length;
  while (state.players[next].isEliminated) {
    next = (next + 1) % state.players.length;
  }
  const nextPlayer = state.players[next];
  const multiHuman = hasMultipleHumans(state.players);
  const step = nextPlayer.isHuman && multiHuman && !state.isOnline ? "pass_device" : "start_turn";
  return { ...state, currentPlayerIndex: next, playStep: step };
}
function checkRoundEnd(state) {
  const active = getActivePlayers(state.players);
  if (active.length === 1) {
    return endRound(state, active[0].id);
  }
  if (state.deck.length === 0) {
    const winner = active.reduce((a, b) => {
      const aVal = a.hand[0] ? CARD_VALUES[a.hand[0]] : -1;
      const bVal = b.hand[0] ? CARD_VALUES[b.hand[0]] : -1;
      return aVal >= bVal ? a : b;
    });
    return endRound(state, winner.id);
  }
  return state;
}
function endRound(state, winnerId) {
  const thiefPlayers = state.players.filter((p) => p.playedThiefThisRound && !p.isEliminated);
  let players = state.players.map((p) => {
    if (p.id === winnerId) return { ...p, tokens: p.tokens + 1 };
    return p;
  });
  let extraMsg = "";
  if (thiefPlayers.length === 1 && thiefPlayers[0].id === winnerId) {
    extraMsg = ` ${state.players[winnerId].name} \u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09AC\u09CB\u09A8\u09BE\u09B8 \u099F\u09CB\u0995\u09C7\u09A8\u0993 \u09AA\u09C7\u09AF\u09BC\u09C7\u099B\u09C7\u09A8!`;
    players = players.map((p) => p.id === winnerId ? { ...p, tokens: p.tokens + 1 } : p);
  } else if (thiefPlayers.length === 1) {
    const thief = thiefPlayers[0];
    extraMsg = ` ${thief.name} \u099B\u09BF\u099A\u0995\u09C7 \u099A\u09CB\u09B0\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09AC\u09CB\u09A8\u09BE\u09B8 \u099F\u09CB\u0995\u09C7\u09A8 \u09AA\u09C7\u09AF\u09BC\u09C7\u099B\u09C7\u09A8!`;
    players = players.map((p) => p.id === thief.id ? { ...p, tokens: p.tokens + 1 } : p);
  }
  const winnerName = state.players[winnerId]?.name ?? "\u0995\u09C7\u0989 \u098F\u0995\u099C\u09A8";
  const resultMsg = `${winnerName} \u09B0\u09BE\u0989\u09A8\u09CD\u09A1 \u099C\u09BF\u09A4\u09C7\u099B\u09C7\u09A8!${extraMsg}`;
  const updatedPlayers = players.map((p) => ({ ...p, tokens: p.tokens }));
  const gameWinner = updatedPlayers.find((p) => p.tokens >= state.tokensToWin);
  const s = addLog(
    { ...state, players: updatedPlayers, resultMessage: resultMsg },
    resultMsg
  );
  if (gameWinner) {
    return {
      ...s,
      phase: "game_end",
      pfReveal: s.pfSeed ?? null,
      resultMessage: `${gameWinner.name} ${gameWinner.tokens} \u099F\u09CB\u0995\u09C7\u09A8 \u09A6\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u09AE \u099C\u09BF\u09A4\u09C7\u099B\u09C7\u09A8!`
    };
  }
  return { ...s, phase: "round_end", pfReveal: s.pfSeed ?? null };
}
function startNewRound(state, firstPlayerIdx) {
  const numPlayers = state.players.length;
  const pf = newProvablyFairRound();
  let deck = shuffle(createDeck(state.cardCounts ?? DEFAULT_CARD_COUNTS), numPlayers);
  let drawHistory = state.drawHistory ?? [];
  let hiddenCard;
  ({
    deck,
    card: hiddenCard,
    history: drawHistory,
    state
  } = drawAfterReshuffle(deck, drawHistory, { ...state, ...pf }));
  const players = state.players.map((p) => {
    let card;
    ({
      deck,
      card,
      history: drawHistory,
      state
    } = drawAfterReshuffle(deck, drawHistory, state));
    return {
      ...p,
      isEliminated: false,
      isProtected: false,
      hand: [card],
      discardPile: [],
      playedThiefThisRound: false
    };
  });
  const firstPlayer = players[firstPlayerIdx];
  const multiHuman = hasMultipleHumans(players);
  const step = firstPlayer.isHuman && multiHuman && !state.isOnline ? "pass_device" : "start_turn";
  const round = state.round + 1;
  return {
    ...state,
    phase: "playing",
    playStep: step,
    players,
    deck,
    hiddenCard,
    drawHistory,
    currentPlayerIndex: firstPlayerIdx,
    cardBeingPlayed: null,
    targetPlayerIndex: null,
    guessedCardId: null,
    merchantOptions: null,
    peekCard: null,
    resultMessage: "",
    round,
    pfCommit: pf.pfCommit,
    pfReveal: null,
    pfSeed: pf.pfSeed,
    pfCounter: pf.pfCounter,
    botMem: {},
    log: [`\u09B0\u09BE\u0989\u09A8\u09CD\u09A1 ${round} \u09B6\u09C1\u09B0\u09C1!`, `\u09B6\u09BE\u09AB\u09B2 \u09B9\u09CD\u09AF\u09BE\u09B6: ${pf.pfCommit.slice(0, 16)}`, ...state.log]
  };
}

// ../pirate-card-game/lib/game-engine/src/game-ai.ts
var TARGET_CARDS = ["guard", "ship_worker", "swordsman", "cannon", "sailor"];
// Heuristic scoring per card option. Larger = better play right now.
function scoreCardPlay(state, selfIdx, cardId, otherCard) {
  const otherVal = otherCard ? (CARD_VALUES[otherCard] ?? 0) : -1;
  const opps = listOpponents(state, selfIdx, true);
  const allOpps = listOpponents(state, selfIdx, false);
  const counts = getUnseenCounts(state, selfIdx);
  const total = totalCount(counts) || 1;
  const deckSize = state.deck?.length ?? 0;
  const late = deckSize <= Math.max(2, state.players.length);
  switch (cardId) {
    case "pirate": return -10000; // never voluntarily play
    case "petty_thief": {
      // Only player to play it = bonus token if survive. Slight bonus when our other card is weak (we're losing showdown anyway).
      let s = 5;
      if (otherVal <= 2) s += 8;
      if (otherVal >= 6) s -= 5; // wasteful with a strong other card
      // If others already played thief this round, less unique value
      const others = state.players.some((p, i) => i !== selfIdx && p.playedThiefThisRound);
      if (others) s -= 4;
      return s;
    }
    case "spy": {
      // Protection: best when our other card is mid/high (worth defending) or many threats around
      let s = 10;
      if (otherVal >= 6) s += 20;
      else if (otherVal >= 4) s += 10;
      if (state.players[selfIdx].isProtected) s -= 5;
      const threats = opps.length;
      s += threats * 2;
      return s;
    }
    case "guard": {
      if (opps.length === 0) return -5;
      // Find target prob we can kill
      let bestKill = 0;
      for (const oi of opps) {
        const known = knownCard(state, oi);
        if (known && known !== "guard") return 200; // guaranteed kill
        const d = oppDist(state, selfIdx, oi);
        let maxP = 0; for (const k of Object.keys(d)) if (k !== "guard" && d[k] > maxP) maxP = d[k];
        if (maxP > bestKill) bestKill = maxP;
      }
      // Base utility + expected kill value
      return 8 + bestKill * 40;
    }
    case "ship_worker": {
      if (opps.length === 0) return -5;
      // Best when we don't know any opponent and have a strong card to defend with
      const knownCount = opps.filter((i) => knownCard(state, i)).length;
      let s = 18 - knownCount * 6;
      if (otherVal >= 5) s += 4; // info matters if we'll survive
      return s;
    }
    case "swordsman": {
      if (opps.length === 0) return -10;
      // Avg win prob across opps, weighted toward best target
      let bestWin = 0;
      for (const oi of opps) {
        const d = oppDist(state, selfIdx, oi);
        let pWin = 0; for (const k of Object.keys(d)) if ((CARD_VALUES[k] ?? 0) < otherVal) pWin += d[k];
        if (pWin > bestWin) bestWin = pWin;
      }
      // Bias: if we don't have at least ~55% win chance, dangerous
      if (bestWin < 0.5) return -5 + bestWin * 10;
      return 6 + bestWin * 30;
    }
    case "cannon": {
      // Hit highest-EV target; if forced self-cannon (all protected) only OK if our other card is weak
      const targets = listOpponents(state, selfIdx, true);
      if (targets.length === 0) {
        // Only self-target valid
        if (otherVal <= 2) return 4;
        if (otherVal === 9) return -200; // pirate self-cannon = elimination
        return -15;
      }
      // Bonus if any known pirate holder
      const knownPirate = targets.some((i) => knownCard(state, i) === "pirate");
      let s = 12;
      if (knownPirate) s += 80;
      // Avg pirate-bust chance across targets
      let bustChance = 0;
      for (const oi of targets) {
        const d = oppDist(state, selfIdx, oi);
        bustChance += d["pirate"] ?? 0;
      }
      s += bustChance * 50;
      return s;
    }
    case "merchant": {
      // Lets us pick best of 3 — useful if our other card is weak
      let s = 10;
      if (otherVal <= 2) s += 8;
      if (deckSize >= 3) s += 2;
      return s;
    }
    case "sailor": {
      if (opps.length === 0) return -5;
      // Beneficial when opp's expected card is higher than ours
      let bestGain = -10;
      for (const oi of opps) {
        const ev = expectedValue(oppDist(state, selfIdx, oi));
        const gain = ev - otherVal;
        if (gain > bestGain) bestGain = gain;
      }
      let s = 4 + bestGain * 4;
      // Don't sailor if we already hold a winning card late game
      if (late && otherVal >= 6) s -= 10;
      return s;
    }
    case "captain": {
      // No effect. Play it only as last resort (low score) — but mustPlayCaptain handles forced case.
      // Captain alone (value 8) is often worth saving for compare.
      if (otherVal >= 8) return -20; // keep both? actually impossible, two captains not in deck normally
      if (otherVal <= 2) return -8;
      return -3;
    }
  }
  return 0;
}
function aiTakeTurn(state) {
  const selfIdx = state.currentPlayerIndex;
  const player = state.players[selfIdx];
  const hand = player.hand;
  if (mustPlayCaptain(hand)) return playCard(state, hand.indexOf("captain"));
  // Score every legal card in hand
  let bestIdx = 0; let bestScore = -Infinity;
  for (let i = 0; i < hand.length; i++) {
    const cardId = hand[i];
    const other = hand[1 - i];
    let score = scoreCardPlay(state, selfIdx, cardId, other);
    // If a targeted card has zero valid targets and it's not cannon, fall through to "no-op" effect
    if (TARGET_CARDS.includes(cardId) && cardId !== "cannon") {
      const t = getValidTargets(state, cardId);
      if (t.length === 0) score = Math.min(score, 0) - 1; // not great but legal
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return playCard(state, bestIdx);
}

// entry.ts
var rooms = /* @__PURE__ */ new Map();
var autoAckTimers = /* @__PURE__ */ new Map();
var autoRoundTimers = /* @__PURE__ */ new Map();

function redactPeekForOthers(state) {
  try {
    const attacker = state.players[state.currentPlayerIndex];
    const target = state.players[state.targetPlayerIndex ?? -1];
    const msg = target ? `${attacker.name} ${target.name}-এর কার্ড দেখেছে।` : `${attacker.name} কার্ড দেখেছে।`;
    return { ...state, peekCard: null, resultMessage: msg, playStep: "show_result" };
  } catch {
    return { ...state, peekCard: null, resultMessage: "", playStep: "show_result" };
  }
}

function stripServerSecrets(state) {
  try {
    if (!state || typeof state !== "object") return state;
    const s = { ...state };
    // Never send PF seed while the round/game is running.
    // It will be revealed via pfReveal after round_end/game_end.
    delete s.pfSeed;
    delete s.pfCounter;
    delete s.botMem;
    return s;
  } catch {
    return state;
  }
}

function emitState(io2, roomId, eventName, state) {
  const room = getRoom(roomId);
  if (!room) return;
  // Ship worker peek should be private (only the player who played sees the card)
  if (state?.phase === "playing" && state?.playStep === "peek_result") {
    for (const p of room.players) {
      if (!p?.socketId) continue;
      const raw = p.playerId === state.currentPlayerIndex ? state : redactPeekForOthers(state);
      const payloadState = stripServerSecrets(raw);
      io2.to(p.socketId).emit(eventName, { state: payloadState });
    }
    return;
  }
  io2.to(roomId).emit(eventName, { state: stripServerSecrets(state) });
}

function closeRoom(io2, roomId, reason = "room_closed") {
  const room = getRoom(roomId);
  if (!room) return;
  try {
    clearAutoAckTimer(roomId);
    clearAutoRoundTimer(roomId);
  } catch {
  }
  try {
    io2.to(roomId).emit("room_closed", { roomId, reason });
  } catch {
  }
  // Force-disconnect all sockets that were in the room (so clients can't stay "stuck").
  try {
    for (const p of room.players) {
      if (!p?.socketId) continue;
      const s = io2.sockets?.sockets?.get(p.socketId);
      if (s) {
        try {
          s.leave(roomId);
        } catch {
        }
        try {
          s.disconnect(true);
        } catch {
        }
      }
    }
  } catch {
  }
  rooms.delete(roomId);
}
function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i++) id += chars[randInt(chars.length)];
  return id;
}
function createRoom(socketId, playerName) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    players: [{ socketId, name: playerName, playerId: 0 }],
    gameState: null,
    phase: "lobby",
    cardCountsOverride: null,
    tokensToWinOverride: null
  };
  rooms.set(roomId, room);
  return room;
}
function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId);
  if (!room || room.phase === "playing") return null;
  if (room.players.length >= 6) return null;
  const playerId = room.players.length;
  room.players.push({ socketId, name: playerName, playerId });
  return room;
}
function rejoinRoom(roomId, playerId, socketId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const existing = room.players.find((p) => p.playerId === playerId);
  if (existing) {
    existing.socketId = socketId;
    existing.name = playerName;
  } else {
    room.players.push({ socketId, name: playerName, playerId });
  }
  return room;
}
function getRoom(roomId) {
  return rooms.get(roomId);
}
function getPlayerNames(room) {
  return room.players.map((p) => p.name);
}
function runAiIfNeeded(state) {
  let s = state;
  while (s.phase === "playing" && s.playStep === "ai_turn") {
    s = aiTakeTurn(s);
    if (s.phase === "playing" && s.playStep === "start_turn") {
      s = beginTurn(s);
    }
  }
  if (s.phase === "playing" && s.playStep === "start_turn") {
    s = beginTurn(s);
  }
  return s;
}
function startGame(roomId, cardCountsOverride, tokensToWinOverride) {
  const room = rooms.get(roomId);
  if (!room || room.players.length < 2) return null;
  const configs = room.players.map((p) => ({
    name: p.name,
    isHuman: true
  }));
  let state = initGame(configs, true, cardCountsOverride, tokensToWinOverride);
  state = beginTurn(state);
  state = runAiIfNeeded(state);
  room.gameState = state;
  room.phase = "playing";
  return state;
}
function applyAction(roomId, playerId, actionData) {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return null;
  let state = room.gameState;
  if (state.phase !== "playing") return null;
  if (state.currentPlayerIndex !== playerId) return null;
  try {
    if (actionData.action === "play_card") {
      state = playCard(state, actionData.cardIndex);
    } else if (actionData.action === "select_target") {
      state = resolveWithTarget(state, actionData.targetId);
    } else if (actionData.action === "guard_guess") {
      state = resolveGuard(state, actionData.cardId);
    } else if (actionData.action === "merchant_select") {
      state = merchantSelect(state, actionData.keepIndex);
    } else if (actionData.action === "acknowledge") {
      state = acknowledgeResult(state);
    }
    state = runAiIfNeeded(state);
  } catch {
    return null;
  }
  room.gameState = state;
  return state;
}

function clearAutoAckTimer(roomId) {
  const t = autoAckTimers.get(roomId);
  if (t) clearTimeout(t);
  autoAckTimers.delete(roomId);
}

function clearAutoRoundTimer(roomId) {
  const t = autoRoundTimers.get(roomId);
  if (t) clearTimeout(t);
  autoRoundTimers.delete(roomId);
}

function scheduleAutoAcknowledge(io2, roomId) {
  clearAutoAckTimer(roomId);
  const room = getRoom(roomId);
  if (!room?.gameState) return;
  const s = room.gameState;
  if (s.phase !== "playing") return;
  if (s.playStep !== "show_result" && s.playStep !== "peek_result") return;
  const expectedPlayerId = s.currentPlayerIndex;
  const expectedStep = s.playStep;
  const t = setTimeout(() => {
    const r2 = getRoom(roomId);
    if (!r2?.gameState) return;
    const cur = r2.gameState;
    if (cur.phase !== "playing") return;
    if (cur.currentPlayerIndex !== expectedPlayerId) return;
    if (cur.playStep !== expectedStep) return;
    const nextState = applyAction(roomId, expectedPlayerId, { action: "acknowledge" });
    if (!nextState) return;
    emitState(io2, roomId, "game_action_ack", nextState);
    scheduleAutoAcknowledge(io2, roomId);
    scheduleAutoNextRound(io2, roomId);
  }, 5e3);
  autoAckTimers.set(roomId, t);
}

function scheduleAutoNextRound(io2, roomId) {
  clearAutoRoundTimer(roomId);
  const room = getRoom(roomId);
  if (!room?.gameState) return;
  const s = room.gameState;
  if (s.phase !== "round_end") return;
  if (s.isOnline !== true) return;
  const expectedRound = s.round;
  const lastWinner = s.players.reduce((a, b) => b.tokens > a.tokens ? b : a);
  const firstPlayerId = lastWinner.id;
  const t = setTimeout(() => {
    const r2 = getRoom(roomId);
    if (!r2?.gameState) return;
    const cur = r2.gameState;
    if (cur.phase !== "round_end") return;
    if (cur.round !== expectedRound) return;
    let nextState = startNewRound(cur, firstPlayerId);
    nextState = runAiIfNeeded(nextState);
    r2.gameState = nextState;
    emitState(io2, roomId, "game_action_ack", nextState);
    scheduleAutoAcknowledge(io2, roomId);
  }, 5e3);
  autoRoundTimers.set(roomId, t);
}
var port = Number(process.env.PORT ?? "3000");
var httpServer = createServer((req, res) => {
  if (req.url?.startsWith("/api/healthz")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Jolodosshu multiplayer server is running.");
});
var io = new SocketIOServer(httpServer, {
  path: "/api/socket.io",
  cors: { origin: "*" }
});
io.on("connection", (socket) => {
  socket.on("create_room", ({ playerName }) => {
    try {
      const room = createRoom(socket.id, playerName);
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerId = 0;
      socket.emit("room_created", { roomId: room.id, playerId: 0 });
      io.to(room.id).emit("lobby_update", { players: getPlayerNames(room) });
    } catch {
      socket.emit("error", "\u09B0\u09C1\u09AE \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
    }
  });
  socket.on("join_room", ({ roomId, playerName }) => {
    try {
      const room = joinRoom(roomId, socket.id, playerName);
      if (!room) {
        socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF \u0985\u09A5\u09AC\u09BE \u09AA\u09C2\u09B0\u09CD\u09A3 \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7");
        return;
      }
      const playerId = room.players.find((p) => p.socketId === socket.id)?.playerId ?? -1;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerId = playerId;
      socket.emit("room_joined", { roomId, playerId });
      io.to(roomId).emit("lobby_update", { players: getPlayerNames(room) });
    } catch (e) {
      console.error(e);
      socket.emit("error", "\u09B0\u09C1\u09AE\u09C7 \u09AF\u09CB\u0997 \u09A6\u09BF\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
    }
  });
  socket.on("rejoin_room", ({ roomId, playerId, playerName }) => {
    try {
      const pid = typeof playerId === "number" ? playerId : Number.parseInt(String(playerId), 10);
      const room = rejoinRoom(roomId, Number.isFinite(pid) ? pid : playerId, socket.id, playerName);
      if (!room) {
        socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF");
        return;
      }
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerId = Number.isFinite(pid) ? pid : playerId;
      if (room.phase === "lobby") {
        io.to(roomId).emit("lobby_update", { players: getPlayerNames(room) });
      } else if (room.gameState) {
        const st = room.gameState;
        if (st?.phase === "playing" && st?.playStep === "peek_result" && st.currentPlayerIndex !== pid) {
          socket.emit("game_state", { state: stripServerSecrets(redactPeekForOthers(st)) });
        } else {
          socket.emit("game_state", { state: stripServerSecrets(st) });
        }
      }
    } catch (e) {
      console.error(e);
      socket.emit("error", "\u09B0\u09C1\u09AE \u09AB\u09BF\u09B0\u09C7 \u09AA\u09C7\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
    }
  });
  // Host-only: close the room and kick everyone out.
  socket.on("close_room", ({ roomId, playerId }) => {
    try {
      const pid = typeof playerId === "number" ? playerId : Number.parseInt(String(playerId), 10);
      const rid = roomId ?? socket.data.roomId;
      const room = getRoom(rid);
      if (!room) return;
      const host = room.players.find((p) => p.playerId === 0);
      const isHost = (Number.isFinite(pid) ? pid : playerId) === 0 && host?.socketId === socket.id;
      if (!isHost) {
        socket.emit("error", "\u09B6\u09C1\u09A7\u09C1 \u09B9\u09CB\u09B8\u09CD\u099F \u09B0\u09C1\u09AE \u09AC\u09A8\u09CD\u09A7 \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u09A8");
        return;
      }
      closeRoom(io, rid, "host_closed");
    } catch (e) {
      console.error(e);
    }
  });
  socket.on("start_game", ({ roomId, playerId, cardCounts, tokensToWinOverride }) => {
    try {
      const pid = typeof playerId === "number" ? playerId : Number.parseInt(String(playerId), 10);
      const room = getRoom(roomId);
      if (!room) {
        socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF");
        return;
      }
      if (pid !== 0) {
        socket.emit("error", "\u09B6\u09C1\u09A7\u09C1 \u09B9\u09CB\u09B8\u09CD\u099F \u0996\u09C7\u09B2\u09BE \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u09A8");
        return;
      }
      if (room.players.length < 2) {
        socket.emit("error", "\u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09E8 \u099C\u09A8 \u0996\u09C7\u09B2\u09CB\u09AF\u09BC\u09BE\u09A1\u09BC \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8");
        return;
      }
      // If restarting a match, clear any pending timers from the previous round/game.
      clearAutoAckTimer(roomId);
      clearAutoRoundTimer(roomId);
      const override = sanitizeCardCountsOverride(cardCounts);
      room.cardCountsOverride = override;
      const tokOverride = sanitizeTokensToWinOverride(tokensToWinOverride);
      room.tokensToWinOverride = tokOverride;
      const state = startGame(roomId, override, tokOverride);
      if (!state) {
        socket.emit("error", "\u0996\u09C7\u09B2\u09BE \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
        return;
      }
      emitState(io, roomId, "game_state", state);
      scheduleAutoAcknowledge(io, roomId);
      scheduleAutoNextRound(io, roomId);
    } catch (e) {
      console.error(e);
      socket.emit("error", "\u0996\u09C7\u09B2\u09BE \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
    }
  });
  socket.on("game_action", ({ roomId, playerId, ...actionData }) => {
    try {
      const pid = typeof playerId === "number" ? playerId : Number.parseInt(String(playerId), 10);
      const state = applyAction(roomId, Number.isFinite(pid) ? pid : playerId, actionData);
      if (!state) {
        socket.emit("error", "\u0985\u09AC\u09C8\u09A7 \u09AA\u09A6\u0995\u09CD\u09B7\u09C7\u09AA");
        return;
      }
      emitState(io, roomId, "game_action_ack", state);
      scheduleAutoAcknowledge(io, roomId);
      scheduleAutoNextRound(io, roomId);
    } catch (e) {
      console.error(e);
      socket.emit("error", "\u0985\u09AC\u09C8\u09A7 \u09AA\u09A6\u0995\u09CD\u09B7\u09C7\u09AA");
    }
  });

  socket.on("disconnect", () => {
    try {
      const roomId = socket.data?.roomId;
      if (!roomId) return;
      const room = getRoom(roomId);
      if (!room) return;
      // Mark socket as gone (allow rejoin by playerId).
      // IMPORTANT: We DO NOT auto-close the room on host disconnect here, because on platforms like
      // Render/Railway short disconnect/reconnect can happen and would instantly delete the room.
      const p = room.players.find((pp) => pp.socketId === socket.id);
      if (p) p.socketId = null;
      if (room.phase === "lobby") {
        io.to(roomId).emit("lobby_update", { players: getPlayerNames(room) });
      }
    } catch (e) {
      console.error(e);
    }
  });
});
httpServer.listen(port, () => {
  console.log(`Multiplayer server listening on :${port}`);
});
