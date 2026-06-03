// entry.ts
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

// ../pirate-card-game/lib/game-engine/src/game-logic.ts
var CARD_COUNTS = {
  petty_thief: 1,
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
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function createDeck() {
  const deck = [];
  for (const [id, count] of Object.entries(CARD_COUNTS)) {
    for (let i = 0; i < count; i++) deck.push(id);
  }
  return deck;
}
function getTokensToWin(n) {
  return { 2: 7, 3: 5, 4: 4, 5: 3, 6: 3 }[n] ?? 3;
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
function initGame(configs, online) {
  const numPlayers = configs.length;
  const deck = shuffle(createDeck());
  const hiddenCard = deck.pop();
  const players = configs.map((cfg, i) => ({
    id: i,
    name: cfg.name,
    isHuman: cfg.isHuman,
    hand: [deck.pop()],
    discardPile: [],
    tokens: 0,
    isEliminated: false,
    isProtected: false,
    playedThiefThisRound: false
  }));
  const firstIsHuman = players[0].isHuman;
  const multiHuman = hasMultipleHumans(players);
  const usePassDevice = firstIsHuman && multiHuman && !online;
  return {
    phase: "playing",
    playStep: usePassDevice ? "pass_device" : "start_turn",
    players,
    deck,
    hiddenCard,
    currentPlayerIndex: 0,
    cardBeingPlayed: null,
    targetPlayerIndex: null,
    guessedCardId: null,
    merchantOptions: null,
    peekCard: null,
    resultMessage: "",
    round: 1,
    tokensToWin: getTokensToWin(numPlayers),
    log: [`\u09B0\u09BE\u0989\u09A8\u09CD\u09A1 \u09E7 \u09B6\u09C1\u09B0\u09C1!`],
    isOnline: online ?? false
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
  const deck = [...state.deck];
  const drawn = deck.pop();
  players = players.map(
    (p, i) => i === idx ? { ...p, hand: [...p.hand, drawn] } : p
  );
  const player = players[idx];
  const step = player.isHuman ? "select_card" : "ai_turn";
  return addLog(
    {
      ...state,
      deck,
      players,
      cardBeingPlayed: null,
      targetPlayerIndex: null,
      guessedCardId: null,
      merchantOptions: null,
      peekCard: null,
      resultMessage: "",
      playStep: step
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
    const deck = [...s.deck];
    const extra = [];
    if (deck.length > 0) extra.push(deck.pop());
    if (deck.length > 0) extra.push(deck.pop());
    const merchantOptions = [...newHand, ...extra];
    s = { ...s, deck, merchantOptions };
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
    return addLog(
      { ...s, peekCard, resultMessage: `${target.name}-\u098F\u09B0 \u09B9\u09BE\u09A4\u09C7 \u0986\u099B\u09C7: ${peekCard ? CARD_NAMES_BN[peekCard] : "???"}`, playStep: "peek_result" },
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
  let msg = "";
  if (target.isProtected && targetIdx !== state.currentPlayerIndex) {
    msg = `${target.name} \u09B8\u09C1\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u2014 \u0995\u09BE\u09AE\u09BE\u09A8 \u099A\u09BE\u09B2\u0995\u09C7\u09B0 \u0995\u09CB\u09A8\u09CB \u09AA\u09CD\u09B0\u09AD\u09BE\u09AC \u09A8\u09C7\u0987!`;
  } else {
    const discarded = target.hand[0];
    const isPirate = discarded === "pirate";
    if (deck.length > 0) {
      const newCard = deck.pop();
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
  const s = addLog({ ...state, players, deck, resultMessage: msg }, msg);
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
  const s = addLog({ ...state, players, resultMessage: msg }, msg);
  return { ...s, playStep: "show_result" };
}
function aiMerchantSelect(state) {
  const options = state.merchantOptions;
  const best = options.reduce((a, b) => CARD_VALUES[a] >= CARD_VALUES[b] ? a : b);
  const keptIdx = options.indexOf(best);
  return merchantSelect(state, keptIdx);
}
function merchantSelect(state, keepIndex) {
  const options = state.merchantOptions;
  const kept = options[keepIndex];
  const rest = options.filter((_, i) => i !== keepIndex);
  const deck = shuffle([...rest, ...state.deck]);
  const players = state.players.map(
    (p, i) => i === state.currentPlayerIndex ? { ...p, hand: [kept] } : p
  );
  const player = state.players[state.currentPlayerIndex];
  const msg = `${player.name} \u09AC\u09A3\u09BF\u0995 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u09A1 \u09B0\u09C7\u0996\u09C7\u099B\u09C7\u09A8\u0964`;
  const s = addLog({ ...state, players, deck, merchantOptions: null, resultMessage: msg }, msg);
  return { ...s, playStep: "show_result" };
}
function aiSelectTarget(state, validTargets) {
  const targetIdx = validTargets[Math.floor(Math.random() * validTargets.length)];
  const s = { ...state, targetPlayerIndex: targetIdx };
  if (state.cardBeingPlayed === "guard") {
    return aiGuardGuess(s, targetIdx);
  }
  return resolveWithTarget(s, targetIdx);
}
function aiGuardGuess(state, targetIdx) {
  const guessable = ["ship_worker", "swordsman", "cannon", "merchant", "sailor", "captain", "spy", "pirate", "petty_thief"];
  const guess = guessable[Math.floor(Math.random() * guessable.length)];
  return resolveGuard({ ...state, targetPlayerIndex: targetIdx }, guess);
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
    return { ...s, phase: "game_end", resultMessage: `${gameWinner.name} ${gameWinner.tokens} \u099F\u09CB\u0995\u09C7\u09A8 \u09A6\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u09AE \u099C\u09BF\u09A4\u09C7\u099B\u09C7\u09A8!` };
  }
  return { ...s, phase: "round_end" };
}
function startNewRound(state, firstPlayerIdx) {
  const deck = shuffle(createDeck());
  const hiddenCard = deck.pop();
  const players = state.players.map((p) => ({
    ...p,
    isEliminated: false,
    isProtected: false,
    hand: [deck.pop()],
    discardPile: [],
    playedThiefThisRound: false
  }));
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
    currentPlayerIndex: firstPlayerIdx,
    cardBeingPlayed: null,
    targetPlayerIndex: null,
    guessedCardId: null,
    merchantOptions: null,
    peekCard: null,
    resultMessage: "",
    round,
    log: [`\u09B0\u09BE\u0989\u09A8\u09CD\u09A1 ${round} \u09B6\u09C1\u09B0\u09C1!`, ...state.log]
  };
}

// ../pirate-card-game/lib/game-engine/src/game-ai.ts
var TARGET_CARDS = ["guard", "ship_worker", "swordsman", "cannon", "sailor"];
var PLAY_PRIORITY = [
  "guard",
  "ship_worker",
  "swordsman",
  "cannon",
  "merchant",
  "sailor",
  "spy",
  "captain",
  "petty_thief"
];
function aiTakeTurn(state) {
  const player = state.players[state.currentPlayerIndex];
  const hand = player.hand;
  if (mustPlayCaptain(hand)) {
    return playCard(state, hand.indexOf("captain"));
  }
  for (const cardId of PLAY_PRIORITY) {
    const idx = hand.indexOf(cardId);
    if (idx === -1) continue;
    if (TARGET_CARDS.includes(cardId)) {
      const targets = getValidTargets(state, cardId);
      if (targets.length > 0) return playCard(state, idx);
      if (cardId === "cannon") return playCard(state, idx);
    } else {
      return playCard(state, idx);
    }
  }
  const best = hand.reduce(
    (acc, c, i) => {
      if (c === "pirate") return acc;
      const v = CARD_VALUES[c];
      return v < acc.val ? { idx: i, val: v } : acc;
    },
    { idx: 0, val: Infinity }
  );
  return playCard(state, best.val === Infinity ? 0 : best.idx);
}

// entry.ts
var rooms = /* @__PURE__ */ new Map();
var autoAckTimers = /* @__PURE__ */ new Map();
function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
function createRoom(socketId, playerName) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    players: [{ socketId, name: playerName, playerId: 0 }],
    gameState: null,
    phase: "lobby"
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
function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.length < 2) return null;
  const configs = room.players.map((p) => ({
    name: p.name,
    isHuman: true
  }));
  let state = initGame(configs, true);
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
    if (state.phase === "round_end") {
      const lastWinner = state.players.reduce((a, b) => b.tokens > a.tokens ? b : a);
      state = startNewRound(state, lastWinner.id);
      state = runAiIfNeeded(state);
    }
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
    io2.to(roomId).emit("game_action_ack", { state: nextState });
    scheduleAutoAcknowledge(io2, roomId);
  }, 5e3);
  autoAckTimers.set(roomId, t);
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
      socket.emit("room_created", { roomId: room.id, playerId: 0 });
      io.to(room.id).emit("lobby_update", { players: getPlayerNames(room) });
    } catch {
      socket.emit("error", "\u09B0\u09C1\u09AE \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
    }
  });
  socket.on("join_room", ({ roomId, playerName }) => {
    const room = joinRoom(roomId, socket.id, playerName);
    if (!room) {
      socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF \u0985\u09A5\u09AC\u09BE \u09AA\u09C2\u09B0\u09CD\u09A3 \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7");
      return;
    }
    const playerId = room.players.find((p) => p.socketId === socket.id)?.playerId ?? -1;
    socket.join(roomId);
    socket.emit("room_joined", { roomId, playerId });
    io.to(roomId).emit("lobby_update", { players: getPlayerNames(room) });
  });
  socket.on("rejoin_room", ({ roomId, playerId, playerName }) => {
    const room = rejoinRoom(roomId, playerId, socket.id, playerName);
    if (!room) {
      socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF");
      return;
    }
    socket.join(roomId);
    if (room.phase === "lobby") {
      io.to(roomId).emit("lobby_update", { players: getPlayerNames(room) });
    } else if (room.gameState) {
      socket.emit("game_state", { state: room.gameState });
    }
  });
  socket.on("start_game", ({ roomId, playerId }) => {
    const room = getRoom(roomId);
    if (!room) {
      socket.emit("error", "\u09B0\u09C1\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF");
      return;
    }
    if (playerId !== 0) {
      socket.emit("error", "\u09B6\u09C1\u09A7\u09C1 \u09B9\u09CB\u09B8\u09CD\u099F \u0996\u09C7\u09B2\u09BE \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u09A8");
      return;
    }
    if (room.players.length < 2) {
      socket.emit("error", "\u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09E8 \u099C\u09A8 \u0996\u09C7\u09B2\u09CB\u09AF\u09BC\u09BE\u09A1\u09BC \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8");
      return;
    }
    const state = startGame(roomId);
    if (!state) {
      socket.emit("error", "\u0996\u09C7\u09B2\u09BE \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7");
      return;
    }
    io.to(roomId).emit("game_state", { state });
    scheduleAutoAcknowledge(io, roomId);
  });
  socket.on("game_action", ({ roomId, playerId, ...actionData }) => {
    const state = applyAction(roomId, playerId, actionData);
    if (!state) {
      socket.emit("error", "\u0985\u09AC\u09C8\u09A7 \u09AA\u09A6\u0995\u09CD\u09B7\u09C7\u09AA");
      return;
    }
    io.to(roomId).emit("game_action_ack", { state });
    scheduleAutoAcknowledge(io, roomId);
  });
});
httpServer.listen(port, () => {
  console.log(`Multiplayer server listening on :${port}`);
});
