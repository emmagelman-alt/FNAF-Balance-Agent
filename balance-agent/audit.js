import { CAMERAS } from '../src/config.js';
import { HUMAN_REACTION_FLOOR } from './players.js';

// Reads one night's config (no simulation) and works out, for every active animatronic:
//   warning   – seconds between the first unmistakable cue and the attack
//   cues      – what a player can use to notice it (camera, doorway warning, sound)
//   doorDuty  – the smallest share of the night its door must be shut, even with
//               perfect timing (close at the last moment, open the moment it leaves)
//   minPower  – what that door time costs, in power points
// and compares them with human limits and the night's power budget.
export function auditNight(config) {
  const spare = config.startingPower - config.power.base * config.nightDuration;
  const animatronics = Object.entries(config.enemies).filter(([, rule]) => rule.enabled).map(([id, rule]) => {
    const active = config.nightDuration - rule.startAt;
    const cameras = rule.route.filter(room => CAMERAS.some(c => c.id === room && !c.audioOnly));
    const cues = rule.stealth ? [] : [
      ...(cameras.length ? [`camera (CAM ${cameras.join(', ')})`] : []),
      id === 'foxy' ? 'sprint warning' : 'doorway warning',
      'footsteps',
    ];
    let warning, doorDuty, minPower;
    if (rule.moveInterval) {
      const meanMove = (rule.moveInterval[0] + rule.moveInterval[1]) / 2;
      const returnTrip = (rule.route.length - 1 - (rule.retreatIndex ?? 0)) * meanMove;
      warning = rule.attackDelay;
      doorDuty = rule.blockDuration / (rule.attackDelay + rule.blockDuration + returnTrip);
      minPower = doorDuty * config.power.door * active;
    } else {
      // Pirate Cove style: charges up, sprints, knocks power off the door when blocked.
      const cycle = rule.thresholds.at(-1) / rule.progressionPerSecond + rule.sprintDelay + rule.attackDelay + rule.blockDuration;
      warning = rule.sprintDelay + rule.attackDelay;
      doorDuty = rule.blockDuration / cycle;
      minPower = doorDuty * config.power.door * active + (rule.knockPower ?? 0) * active / cycle;
    }
    const issues = [];
    if (!cues.length) issues.push({ id: 'no-tells', severity: 'high', text: 'Gives no cue at all: never on camera, no doorway warning, no sound. A player cannot know when to close the door.' });
    if (cues.length && warning < HUMAN_REACTION_FLOOR) issues.push({ id: 'reaction-window', severity: 'high', text: `Attacks ${warning.toFixed(2)} s after its doorway warning. Even elite players need at least ${HUMAN_REACTION_FLOOR} s to see a cue and press a key.` });
    if (minPower > spare) issues.push({ id: 'power-impossible', severity: 'critical', text: `Needs the ${rule.side} door shut at least ${(doorDuty * 100).toFixed(0)}% of the time it is active (${minPower.toFixed(0)} power), but the night only leaves ${spare.toFixed(0)} power for every device combined.` });
    else if (minPower > spare * 0.6) issues.push({ id: 'power-heavy', severity: 'medium', text: `Uses ${minPower.toFixed(0)} of the ${spare.toFixed(0)} spare power on its own.` });
    return {
      id, name: rule.name, side: rule.side, color: rule.color, startAt: rule.startAt,
      warning, cues, doorDuty, minPower, issues,
    };
  });
  return { spare, animatronics };
}
