import { createState, advance, roomOf } from '../src/engine.js';
import { createPlayer } from './players.js';

// Small seeded random generator so every simulated night can be replayed exactly.
export function seeded(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable seed from any labels, e.g. seedFor('survey', 2, 'veteran', 17).
export function seedFor(...parts) {
  let hash = 2166136261;
  for (const char of parts.join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// Game time as the in-game clock: each real minute of the shift is one hour (12–6 AM).
export const clock = seconds => {
  const hour = Math.floor(seconds / 60);
  const minute = Math.floor(seconds % 60);
  return `${hour === 0 ? 12 : hour}:${String(minute).padStart(2, '0')} AM`;
};

// Play one complete night with one player, using the real game engine (src/engine.js)
// in steps of config.maxStep. The player decides before every step, so even the
// perfect bot needs a step to notice something that just happened.
export function playNight({ config, night, profile, seed, options = {}, log = false }) {
  const gameRandom = seeded(seed);
  const playerRandom = seeded(seed ^ 0x9E3779B9);
  const state = createState(config, 'playing', night);
  const player = createPlayer(profile, playerRandom, { ...options, note: log ? (text, tone) => note(text, tone) : null });
  const step = config.maxStep;
  const doorSeconds = { left: 0, right: 0 };
  const visits = {};
  const blocks = {};
  let monitorSeconds = 0;
  let rooms = Object.fromEntries(Object.values(state.enemies).map(e => [e.id, roomOf(e, config)]));
  let doors = { ...state.doors };
  let outageAt = null;
  const timeline = [];
  const note = (text, tone = 'normal') => { if (log) timeline.push({ time: state.elapsed, text, tone }); };

  while (state.mode === 'playing') {
    player(state, config);
    for (const side of ['left', 'right']) {
      if (state.doors[side] !== doors[side]) note(`Player ${state.doors[side] ? 'closes' : 'opens'} the ${side} door.`, 'player');
    }
    doors = { ...state.doors };
    advance(state, step, config, gameRandom);
    doors = { ...state.doors }; // the engine opening doors (power failure) is not a player action
    if (state.doors.left) doorSeconds.left += step;
    if (state.doors.right) doorSeconds.right += step;
    if (state.monitor) monitorSeconds += step;
    if (state.outage && outageAt === null) { outageAt = state.elapsed; note('Power runs out. Every door opens.', 'danger'); }
    for (const enemy of Object.values(state.enemies)) {
      const rule = config.enemies[enemy.id];
      const room = roomOf(enemy, config);
      const was = rooms[enemy.id];
      if (room === was) continue;
      if (room === 'door') {
        visits[enemy.id] = (visits[enemy.id] ?? 0) + 1;
        note(`${rule.name} reaches the ${rule.side} door${rule.stealth ? ' (no warning shown)' : ''}; attack in ${rule.attackDelay.toFixed(2)} s unless the door is shut.`, rule.stealth ? 'danger' : 'warning');
      } else if (was === 'door') {
        blocks[enemy.id] = (blocks[enemy.id] ?? 0) + 1;
        note(`${rule.name} is blocked and retreats.`, 'safe');
      } else if (enemy.id === 'foxy' && room === '2A') note('Foxy leaves Pirate Cove and sprints down West Hall.', 'warning');
      rooms[enemy.id] = room;
    }
  }

  const cause = state.outcome.cause;
  if (state.mode === 'won') note('6 AM. The night is survived.', 'safe');
  else note(cause === 'outage' ? 'Caught in the dark after the power failure.' : `${config.enemies[cause].name} gets in through the ${config.enemies[cause].side} door.`, 'danger');
  return {
    win: state.mode === 'won',
    cause: state.mode === 'won' ? null : cause,
    time: state.outcome.elapsed,
    power: state.power,
    outageAt,
    doorSeconds,
    monitorSeconds,
    visits,
    blocks,
    seed,
    timeline: log ? timeline : undefined,
  };
}

// Play the same night many times and summarize. `label` keeps seeds distinct per experiment.
export function playMany({ config, night, profile, runs, label, options }) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(playNight({ config, night, profile, options, seed: seedFor(label, night, profile.id, i) }));
  const wins = results.filter(r => r.win);
  const losses = results.filter(r => !r.win);
  const causes = {};
  for (const r of losses) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  const average = (list, pick) => list.length ? list.reduce((sum, r) => sum + pick(r), 0) / list.length : null;
  return {
    runs,
    winRate: wins.length / runs,
    causes,
    meanLossTime: average(losses, r => r.time),
    meanPowerAtWin: average(wins, r => r.power),
    meanOutageAt: average(results.filter(r => r.outageAt !== null), r => r.outageAt),
    outageRate: results.filter(r => r.outageAt !== null).length / runs,
    meanDoorSeconds: { left: average(results, r => r.doorSeconds.left), right: average(results, r => r.doorSeconds.right) },
    firstLossSeed: losses[0]?.seed ?? null,
    lossSeeds: Object.fromEntries(Object.keys(causes).map(id => [id, losses.find(r => r.cause === id).seed])),
  };
}
