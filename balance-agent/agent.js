import { configForNight, NIGHTS } from '../src/config.js';
import { PLAYERS, SURVEY_PLAYERS, HUMAN_REACTION_FLOOR } from './players.js';
import { playMany, playNight, clock } from './simulate.js';
import { auditNight } from './audit.js';

// When the agent calls something unfair. All rates are win rates between 0 and 1.
export const THRESHOLDS = {
  unwinnable: 0.5,    // the perfect bot wins less than this: nobody can beat the night
  beyondHumans: 0.15, // a Veteran wins less than this while the bot wins: beyond human ability
  expertOnly: 0.10,   // an Average player wins less than this: expert-only, review suggested
  culpritLift: 0.30,  // removing one animatronic raises the win rate this much: it is a cause
  spike: 0.40,        // the human win rate drops this much from the night before: difficulty spike
};

const pct = rate => `${Math.round(rate * 100)}%`;
const signed = lift => `${lift >= 0 ? '+' : '−'}${Math.abs(Math.round(lift * 100))} pts`;

function variant(config, keep) {
  const copy = structuredClone(config);
  for (const [id, rule] of Object.entries(copy.enemies)) rule.enabled = rule.enabled && keep(id);
  return copy;
}
const activeIds = config => Object.entries(config.enemies).filter(([, rule]) => rule.enabled).map(([id]) => id);

function mergeCauses(...summaries) {
  const total = {};
  for (const summary of summaries) for (const [cause, count] of Object.entries(summary.causes)) total[cause] = (total[cause] ?? 0) + count;
  return total;
}

function causeName(config, cause) {
  return cause === 'outage' ? 'power failure' : config.enemies[cause]?.name ?? cause;
}

// The last part of one losing night, for the reviewer to read before they play.
function trimTimeline(timeline) {
  const end = timeline.at(-1)?.time ?? 0;
  const recent = timeline.filter(event => event.time >= end - 40);
  return recent.slice(-10).map(event => ({ ...event, clock: clock(event.time) }));
}

function suggestFix(category, audit, config, others) {
  const rule = config.enemies[audit.id];
  if (category === 'reaction-window') {
    const typical = others.length ? Math.min(...others.map(a => a.warning)) : 2;
    return `Give ${audit.name} a warning a person can answer: raise attackDelay from ${rule.attackDelay} s to at least 1 s (the other animatronics tonight allow ${typical.toFixed(1)} s or more), or add a cue before it reaches the door.`;
  }
  if (category === 'no-tells') {
    return `Give ${audit.name} at least one tell: show it on a camera or in the ${audit.side} doorway light, or play footsteps when it reaches the door. Then rerun the agent.`;
  }
  if (category === 'power' && rule.moveInterval) {
    const spare = config.startingPower - config.power.base * config.nightDuration;
    const active = config.nightDuration - rule.startAt;
    const targetDuty = Math.min(0.3, (spare * 0.35) / (config.power.door * active));
    const meanMove = (rule.moveInterval[0] + rule.moveInterval[1]) / 2;
    const returnTrip = (rule.route.length - 1 - (rule.retreatIndex ?? 0)) * meanMove;
    const block = Math.max(1, targetDuty * (rule.attackDelay + returnTrip) / (1 - targetDuty));
    return `Cut ${audit.name}'s door time: lower blockDuration from ${rule.blockDuration} s to about ${block.toFixed(0)} s, or send it further back after a block (retreatIndex) so the return trip takes longer.`;
  }
  return `Tune ${audit.name} down (slower moves, a longer doorway warning, or a shorter door hold), then rerun the agent.`;
}

const CHECKLISTS = {
  'reaction-window': audit => [
    `Play the night and watch the ${audit.side} door. When the warning for ${audit.name} appears, can you shut the door before it attacks?`,
    `Look for anything that predicts its move early (a camera, a sound). If you find one, the agent missed a strategy.`,
    'Decide: unfair, or an intended "learn the pattern" challenge?',
  ],
  'no-tells': audit => [
    `Play the night. When ${audit.name} gets you, was there any picture, light, text or sound that warned you?`,
    'Check whether the missing tell is on purpose (a design choice) or a bug (missing art, sound, or camera placement).',
    'Decide: unfair, or a deliberate "guess" mechanic that needs a hint in the briefing?',
  ],
  power: audit => [
    `Play the night and shut the ${audit.side} door each time ${audit.name} arrives. Note what time the power runs out.`,
    'Try any strategy you think the agent missed (timing the door, ignoring other threats).',
    'Decide whether to shorten the door hold, lengthen the return trip, or lower power costs.',
  ],
  'beyond-humans': audit => [
    `Play the night and focus on ${audit.name}. Is it beatable once you know its pattern?`,
    'Note what made losses feel unfair (too fast, unclear, too many threats at once).',
    'Decide: unfair, or a fair top-difficulty challenge?',
  ],
  'expert-only': audit => [
    `Play the night as a normal player would. Did ${audit.name} feel beatable?`,
    'Decide whether this night is meant to be expert-only.',
  ],
};

// The balance agent. Plays every night as each kind of player, spots nights that are
// unfair or beyond human ability, investigates which animatronic causes it and why,
// and writes a review ticket asking a person to confirm each finding by playing.
// `say(text, tone, indent)` streams the agent's reasoning as it works.
export function runAgent({ runs = 150, nights = NIGHTS.map((_, i) => i + 1), nightConfig = configForNight, say = () => {} } = {}) {
  const startedAt = new Date();
  const log = [];
  const note = (text, tone = 'normal', indent = 0) => { log.push({ text, tone, indent }); say(text, tone, indent); };
  const probeRuns = Math.max(40, Math.round(runs * 0.6));
  let simulated = 0;
  const play = args => { simulated += args.runs; return playMany(args); };

  // Phase 1: play everything.
  note('Phase 1 · Survey', 'phase');
  note(`Playing every night as ${SURVEY_PLAYERS.length} kinds of player, ${runs} times each.`);
  const report = {};
  for (const night of nights) {
    const config = nightConfig(night);
    const results = {};
    for (const id of SURVEY_PLAYERS) results[id] = play({ config, night, profile: PLAYERS[id], runs, label: 'survey' });
    const audit = auditNight(config);
    report[night] = { night, roster: activeIds(config).map(id => config.enemies[id].name), results, audit };
    note(`Night ${night} (${report[night].roster.join(', ')}): ${SURVEY_PLAYERS.map(id => `${PLAYERS[id].label} ${pct(results[id].winRate)}`).join(' · ')}`, 'normal', 1);
  }

  // Phase 2: decide which nights look wrong.
  note('Phase 2 · Detect', 'phase');
  const suspects = [];
  let previous = null;
  for (const night of nights) {
    const entry = report[night];
    const { results } = entry;
    const human = (results.average.winRate + results.veteran.winRate) / 2;
    const drop = previous === null ? 0 : previous - human;
    entry.humanRate = human;
    entry.spike = drop >= THRESHOLDS.spike ? drop : 0;
    previous = human;
    const spikeText = entry.spike ? ` Human win rate fell ${Math.round(drop * 100)} points from Night ${night - 1}.` : '';
    if (results.perfect.winRate < THRESHOLDS.unwinnable) {
      entry.status = 'unwinnable';
      note(`Night ${night}: even the perfect bot wins only ${pct(results.perfect.winRate)}. Nobody can beat this night.${spikeText}`, 'danger', 1);
    } else if (results.veteran.winRate < THRESHOLDS.beyondHumans) {
      entry.status = 'beyond-humans';
      note(`Night ${night}: the perfect bot wins ${pct(results.perfect.winRate)}, but Veterans win ${pct(results.veteran.winRate)}. Something here needs more than human reflexes or senses.${spikeText}`, 'danger', 1);
    } else if (results.average.winRate < THRESHOLDS.expertOnly) {
      entry.status = 'expert-only';
      note(`Night ${night}: only Veterans get through (${pct(results.veteran.winRate)}); Average players win ${pct(results.average.winRate)}.${spikeText}`, 'warning', 1);
    } else {
      entry.status = 'fair';
      const watch = entry.audit.animatronics.flatMap(a => a.issues.map(issue => `${a.name}: ${issue.text}`));
      note(`Night ${night} looks fair: Average ${pct(results.average.winRate)}, Veteran ${pct(results.veteran.winRate)}, Rookie ${pct(results.rookie.winRate)}.${watch.length ? ` Config note: ${watch.join(' ')}` : ''}`, 'safe', 1);
    }
    if (entry.status !== 'fair') suspects.push(night);
  }
  if (!suspects.length) note('No suspicious nights. Nothing to investigate.', 'safe', 1);

  // Phase 3: find the cause of each suspicious night.
  const tickets = [];
  if (suspects.length) note('Phase 3 · Investigate', 'phase');
  for (const night of suspects) {
    const entry = report[night];
    const config = nightConfig(night);
    const probe = entry.status === 'unwinnable' ? 'perfect' : entry.status === 'expert-only' ? 'average' : 'veteran';
    const baseRate = entry.results[probe].winRate;
    const causes = mergeCauses(entry.results.average, entry.results.veteran);
    const totalLosses = Object.values(causes).reduce((sum, n) => sum + n, 0);
    const [topCause, topCount] = Object.entries(causes).sort((a, b) => b[1] - a[1])[0] ?? [];
    note(`Night ${night}`, 'heading');
    if (topCause) {
      note(`${pct(topCount / totalLosses)} of human losses are to ${causeName(config, topCause)}.${topCause === 'outage' ? ' A power failure is a symptom, not a cause, so the agent will look for what is eating the power.' : ''}`, 'normal', 1);
    }
    note(`Removing one animatronic at a time and replaying as the ${PLAYERS[probe].label} (${probeRuns} nights each):`, 'normal', 1);
    const removal = [];
    for (const id of activeIds(config)) {
      const without = play({ config: variant(config, other => other !== id), night, profile: PLAYERS[probe], runs: probeRuns, label: `remove-${id}` });
      const lift = without.winRate - baseRate;
      removal.push({ id, name: config.enemies[id].name, winRate: without.winRate, lift });
      note(`without ${config.enemies[id].name}: ${pct(baseRate)} → ${pct(without.winRate)} (${signed(lift)})${lift >= THRESHOLDS.culpritLift ? '  ← cause' : ''}`, lift >= THRESHOLDS.culpritLift ? 'danger' : 'muted', 2);
    }
    entry.removal = removal;
    let culprits = removal.filter(r => r.lift >= THRESHOLDS.culpritLift).sort((a, b) => b.lift - a.lift);
    if (!culprits.length) {
      // No single animatronic explains it: blame the biggest contributor and say so.
      culprits = [...removal].sort((a, b) => b.lift - a.lift).slice(0, 1);
      note(`No single animatronic explains it; the combination is the problem. ${culprits[0].name} contributes most.`, 'warning', 1);
    }

    for (const culprit of culprits) {
      const audit = entry.audit.animatronics.find(a => a.id === culprit.id);
      const others = entry.audit.animatronics.filter(a => a.id !== culprit.id);
      const solo = {
        veteran: play({ config: variant(config, id => id === culprit.id), night, profile: PLAYERS.veteran, runs: probeRuns, label: `solo-${culprit.id}` }),
        perfect: play({ config: variant(config, id => id === culprit.id), night, profile: PLAYERS.perfect, runs: probeRuns, label: `solo-${culprit.id}` }),
      };
      note(`${culprit.name} on its own: Veteran ${pct(solo.veteran.winRate)} · Perfect bot ${pct(solo.perfect.winRate)}.`, 'normal', 1);

      const campFrom = Math.max(0, audit.startAt - 5);
      const camp = play({ config, night, profile: PLAYERS.veteran, runs: probeRuns, label: `camp-${culprit.id}`, options: { campSide: audit.side, campFrom } });
      const campDetail = camp.outageRate >= 0.5 && camp.meanOutageAt !== null ? ` (power runs out around ${clock(camp.meanOutageAt)})` : '';
      note(`Workaround check: a Veteran who keeps the ${audit.side} door shut from ${clock(campFrom)} on wins ${pct(camp.winRate)}${campDetail}.`, camp.winRate >= 0.5 ? 'warning' : 'normal', 1);
      for (const issue of audit.issues) note(`Config check: ${issue.text}`, 'warning', 1);

      const issueIds = audit.issues.map(issue => issue.id);
      const category = entry.status === 'unwinnable' ? (issueIds.includes('power-impossible') || topCause === 'outage' ? 'power' : 'unwinnable')
        : entry.status === 'expert-only' ? 'expert-only'
          : issueIds.includes('no-tells') ? 'no-tells'
            : issueIds.includes('reaction-window') ? 'reaction-window' : 'beyond-humans';
      const severity = entry.status === 'unwinnable' ? 'critical' : entry.status === 'beyond-humans' ? 'high' : 'medium';
      const staticAgrees = audit.issues.some(issue => ['critical', 'high'].includes(issue.severity));
      const vet = entry.results.veteran;
      const bot = entry.results.perfect;
      const lossSeed = vet.lossSeeds[culprit.id] ?? vet.lossSeeds.outage ?? vet.firstLossSeed;
      const replay = lossSeed === null ? null : playNight({ config, night, profile: PLAYERS.veteran, seed: lossSeed, log: true });

      const title = {
        'reaction-window': `${culprit.name} attacks faster than a person can react`,
        'no-tells': `${culprit.name} gives players no warning at all`,
        power: `${culprit.name} needs more power than the night has`,
        unwinnable: `${culprit.name} makes the night unwinnable`,
        'beyond-humans': `${culprit.name} is beyond human ability`,
        'expert-only': `${culprit.name} makes the night expert-only`,
      }[category];
      const summary = {
        'reaction-window': `${culprit.name}'s doorway warning lasts ${audit.warning.toFixed(2)} s before it attacks, under the ${HUMAN_REACTION_FLOOR} s human floor. Veterans won ${pct(vet.winRate)} of the night; the perfect bot, reacting within one 0.05 s step, won ${pct(bot.winRate)}.`,
        'no-tells': `${culprit.name} never appears on camera, in the doorway light, in the warning text, or in sound. Veterans won ${pct(vet.winRate)}; the perfect bot, the only player that can see it, won ${pct(bot.winRate)}.`,
        power: `Stopping ${culprit.name} takes the ${audit.side} door shut at least ${Math.round(audit.doorDuty * 100)}% of the time it is active. Even perfect play wins ${pct(bot.winRate)}${bot.meanOutageAt ? `, running out of power around ${clock(bot.meanOutageAt)}` : ''}.`,
        unwinnable: `With ${culprit.name} active, even the perfect bot wins only ${pct(bot.winRate)} of the night.`,
        'beyond-humans': `With ${culprit.name} active, Veterans win ${pct(vet.winRate)} while the perfect bot wins ${pct(bot.winRate)}.`,
        'expert-only': `With ${culprit.name} active, Average players win ${pct(entry.results.average.winRate)}; only Veterans get through (${pct(vet.winRate)}).`,
      }[category];
      const evidence = [
        `Survey (${runs} nights per player): ${SURVEY_PLAYERS.map(id => `${PLAYERS[id].label} ${pct(entry.results[id].winRate)}`).join(', ')}.`,
        `Taking ${culprit.name} out raises the ${PLAYERS[probe].label} win rate from ${pct(baseRate)} to ${pct(culprit.winRate)} (${signed(culprit.lift)}).`,
        `${culprit.name} alone: Veteran ${pct(solo.veteran.winRate)}, perfect bot ${pct(solo.perfect.winRate)}.`,
        `Keeping the ${audit.side} door shut all night does ${camp.winRate >= 0.5 ? '' : 'not '}work (Veteran ${pct(camp.winRate)})${campDetail}.`,
        ...audit.issues.map(issue => `Config: ${issue.text}`),
        ...(entry.spike ? [`Difficulty spike: human win rate fell ${Math.round(entry.spike * 100)} points from Night ${night - 1}.`] : []),
      ];
      const ticket = {
        id: `night-${night}-${culprit.id}`,
        night,
        animatronic: { id: culprit.id, name: culprit.name, side: audit.side, color: audit.color },
        severity,
        category,
        reviewRequired: severity !== 'medium',
        confidence: staticAgrees ? 'high' : 'medium',
        title,
        summary,
        evidence,
        checklist: (CHECKLISTS[category] ?? CHECKLISTS['beyond-humans'])(audit),
        suggestion: suggestFix(category, audit, config, others),
        play: { night, note: `${culprit.name}: ${title.replace(`${culprit.name} `, '')}` },
        timeline: replay ? trimTimeline(replay.timeline) : [],
        metrics: { survey: Object.fromEntries(SURVEY_PLAYERS.map(id => [id, entry.results[id].winRate])), removal: culprit, solo: { veteran: solo.veteran.winRate, perfect: solo.perfect.winRate }, camp: camp.winRate },
      };
      tickets.push(ticket);
      note(`Verdict: ${title} (${severity}, ${ticket.confidence} confidence).`, severity === 'medium' ? 'warning' : 'danger', 1);
    }
  }

  // Phase 4: hand the findings to a person.
  note('Phase 4 · Call for human review', 'phase');
  if (!tickets.length) note('Nothing needs a human. Every night was beatable by human-like players.', 'safe', 1);
  for (const ticket of tickets) {
    note(`${ticket.reviewRequired ? 'REVIEW REQUIRED' : 'Review suggested'} · Night ${ticket.night} · ${ticket.title}`, ticket.reviewRequired ? 'danger' : 'warning', 1);
  }

  return {
    meta: {
      generatedAt: startedAt.toISOString(),
      seconds: (Date.now() - startedAt.getTime()) / 1000,
      runsPerPlayer: runs,
      investigationRuns: probeRuns,
      simulatedNights: simulated,
      reactionFloor: HUMAN_REACTION_FLOOR,
    },
    thresholds: THRESHOLDS,
    players: SURVEY_PLAYERS.map(id => ({ id, label: PLAYERS[id].label, kind: PLAYERS[id].kind, blurb: PLAYERS[id].blurb })),
    nights: nights.map(night => report[night]),
    tickets,
    log,
  };
}
