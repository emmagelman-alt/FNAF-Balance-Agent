import { act, roomOf } from '../src/engine.js';

// The fastest a person can see a warning and press a key. Lab reaction times bottom out
// near 0.2 s for a single expected light; in a game with several things to watch, 0.25 s
// is already an exceptional player. Anything shorter is treated as physically impossible.
export const HUMAN_REACTION_FLOOR = 0.25;

// The ways the agent plays. Human players only act on what the screen and speakers show
// (doorway warnings, the activity line, the camera they are looking at). They react
// after a reaction time, sometimes miss a warning until their next look around, and
// rely on the "retreated, safe to reopen" message. The perfect bot is not a human: it
// reads the true game state, including animatronics a player cannot see, and acts
// within one simulation step. It shows whether a night can be beaten at all.
export const PLAYERS = {
  rookie: {
    id: 'rookie', label: 'Rookie', kind: 'human',
    blurb: 'First few nights: slow reactions (~0.85 s), misses 1 warning in 8, rarely checks Pirate Cove.',
    reaction: { mean: 0.85, sd: 0.22, min: 0.4 }, missChance: 0.12, scanEvery: 5, foxyEvery: 28, foxyFor: 2.5,
  },
  average: {
    id: 'average', label: 'Average player', kind: 'human',
    blurb: 'Knows the rules: ~0.6 s reactions, misses 1 warning in 16, checks Pirate Cove every ~18 s.',
    reaction: { mean: 0.6, sd: 0.14, min: 0.3 }, missChance: 0.06, scanEvery: 3.5, foxyEvery: 18, foxyFor: 2.5,
  },
  veteran: {
    id: 'veteran', label: 'Veteran', kind: 'human',
    blurb: 'Top-tier human: ~0.38 s reactions (never under 0.26 s), rarely misses a warning, watches the Cove often.',
    reaction: { mean: 0.38, sd: 0.07, min: 0.26 }, missChance: 0.02, scanEvery: 2, foxyEvery: 13, foxyFor: 2.5,
  },
  perfect: {
    id: 'perfect', label: 'Perfect bot', kind: 'bot',
    blurb: 'Not a human. Sees the true game state, including hidden animatronics, and reacts in 0.05 s.',
  },
};

export const SURVEY_PLAYERS = ['rookie', 'average', 'veteran', 'perfect'];

const SIDES = ['left', 'right'];

function gaussian(random) {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function setDoor(state, side, closed) {
  if (state.doors[side] !== closed) act(state, { type: 'door', side });
}

function setMonitor(state, open, camera) {
  if (state.monitor !== open) act(state, { type: 'monitor' });
  if (open && camera && state.camera !== camera) act(state, { type: 'camera', id: camera });
}

// What a person can tell is waiting at each doorway: the office "MOVEMENT DETECTED"
// marker, the doorway warning text, and footsteps. Stealth animatronics give none of these.
// A running Foxy counts for the left door because the game shouts about it.
export function visibleThreats(state, config) {
  const threats = { left: [], right: [] };
  for (const enemy of Object.values(state.enemies)) {
    const rule = config.enemies[enemy.id];
    if (rule.stealth) continue;
    const room = roomOf(enemy, config);
    if (room === 'door' || (enemy.id === 'foxy' && enemy.position === 1)) threats[rule.side].push(enemy.id);
  }
  return threats;
}

// A rule-based human. `campSide` turns this player into a "door camper" who keeps that
// door shut from `campFrom` seconds on; the agent uses it to test for workarounds.
function createHuman(profile, random, { campSide = null, campFrom = 0, note = null } = {}) {
  const { mean, sd, min } = profile.reaction;
  const reaction = () => Math.max(min, mean + sd * gaussian(random));
  const jitter = seconds => seconds * (0.7 + 0.6 * random());
  const queue = [];
  const lastCue = new Map(); // enemy id -> whether it was showing as a threat last step
  const unnoticed = new Set();
  const reopening = { left: false, right: false };
  const holding = { left: false, right: false };
  let nextScan = jitter(profile.scanEvery);
  let nextGlance = jitter(profile.foxyEvery);
  let glanceUntil = null;
  let glanceLimit = null;

  const schedule = (at, kind, side) => queue.push({ at, kind, side });
  const camping = (side, now) => campSide === side && now >= campFrom;

  return function update(state, config) {
    const now = state.elapsed;
    const threats = visibleThreats(state, config);

    // 1. Carry out actions whose reaction time has passed.
    for (let i = queue.length - 1; i >= 0; i--) {
      const task = queue[i];
      if (task.at > now) continue;
      queue.splice(i, 1);
      if (task.kind === 'close') { holding[task.side] = true; reopening[task.side] = false; setDoor(state, task.side, true); }
      if (task.kind === 'open') {
        reopening[task.side] = false;
        // Changed their mind if a new visible threat showed up while reaching for the button.
        if (!threats[task.side].length && !camping(task.side, now)) { holding[task.side] = false; setDoor(state, task.side, false); }
      }
    }

    // 2. React to new warnings (or miss them until the next look around).
    for (const side of SIDES) {
      for (const id of threats[side]) {
        if (lastCue.get(id)) continue;
        lastCue.set(id, true);
        if (holding[side]) continue;
        const loud = id === 'foxy'; // the sprint has its own banner and running footsteps
        const name = config.enemies[id].name;
        if (random() < profile.missChance * (loud ? 0.5 : 1)) {
          unnoticed.add(id);
          note?.(`Player misses the ${name} warning (looking elsewhere).`, 'player');
        } else {
          const delay = reaction();
          schedule(now + delay, 'close', side);
          note?.(`Player sees the ${name} warning and reaches for the ${side} door (reaction ${delay.toFixed(2)} s).`, 'player');
        }
      }
    }
    for (const id of [...lastCue.keys()]) {
      if (!threats.left.includes(id) && !threats.right.includes(id)) { lastCue.delete(id); unnoticed.delete(id); }
    }

    // 3. Periodic look around: catch missed warnings and doors left shut for nothing.
    if (now >= nextScan) {
      nextScan = now + jitter(profile.scanEvery);
      for (const side of SIDES) {
        const missed = threats[side].filter(id => unnoticed.has(id));
        if (missed.length && !holding[side]) { schedule(now + reaction(), 'close', side); for (const id of missed) unnoticed.delete(id); }
      }
    }

    // 4. "Retreated. Safe to reopen." Read the message, then reopen.
    for (const side of SIDES) {
      if (camping(side, now)) { holding[side] = true; setDoor(state, side, true); continue; }
      if (holding[side] && !threats[side].length && !reopening[side]) {
        reopening[side] = true;
        schedule(now + reaction() + 0.3, 'open', side);
      }
    }

    // 5. Glance at Pirate Cove now and then. Skip glances when power is critically low.
    const foxy = state.enemies.foxy;
    if (glanceUntil !== null) {
      if (state.monitor && state.camera === '1C' && foxy?.coveStage >= 2 && glanceUntil - now < 1) glanceUntil = Math.min(glanceLimit, now + 2);
      if (now >= glanceUntil) { setMonitor(state, false); glanceUntil = null; nextGlance = now + jitter(profile.foxyEvery); }
    } else if (foxy && foxy.position === 0 && now >= nextGlance) {
      const lowPower = state.power < 8 + (config.nightDuration - now) * config.power.base * 0.5;
      if (lowPower) nextGlance = now + jitter(profile.foxyEvery);
      else { setMonitor(state, true, '1C'); glanceUntil = now + profile.foxyFor; glanceLimit = now + profile.foxyFor + 6; }
    }
  };
}

// Knows everything and wastes nothing: closes a door at the last safe moment, keeps it
// shut while anything is there, and watches Pirate Cove only when Foxy is about to run.
function createPerfect() {
  const LEAD = 0.12;
  let watching = false;
  return function update(state, config) {
    for (const side of SIDES) {
      const here = Object.values(state.enemies).filter(e => roomOf(e, config) === 'door' && config.enemies[e.id].side === side);
      if (!state.doors[side] && here.some(e => e.attackIn <= LEAD)) setDoor(state, side, true);
      else if (state.doors[side] && !here.length) setDoor(state, side, false);
    }
    const foxy = state.enemies.foxy;
    if (!foxy) return;
    if (!watching && foxy.position === 0 && foxy.activity >= 80) { watching = true; setMonitor(state, true, '1C'); }
    else if (watching && (foxy.activity <= 40 || foxy.position !== 0)) { watching = false; setMonitor(state, false); }
  };
}

export function createPlayer(profile, random, options) {
  return profile.kind === 'bot' ? createPerfect() : createHuman(profile, random, options);
}
