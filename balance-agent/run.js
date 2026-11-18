#!/usr/bin/env node
// Run the balance agent from the repo folder:
//   node balance-agent/run.js              full run (150 nights per player per night)
//   node balance-agent/run.js --quick      faster demo run (60 per player)
//   node balance-agent/run.js --baseline   the game without the three planted animatronics
//                                          (writes baseline-report.* so the main report stays)
//   node balance-agent/run.js --nights 2,3 only some nights
//   node balance-agent/run.js --ci         exit with code 1 if any review is required
import { relative } from 'node:path';
import { configForNight, NIGHTS } from '../src/config.js';
import { runAgent } from './agent.js';
import { writeReports } from './report.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const runs = Number(value('--runs')) || (flag('--quick') ? 60 : 150);
const nights = value('--nights')
  ? value('--nights').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= NIGHTS.length)
  : NIGHTS.map((_, i) => i + 1);
// --baseline removes every night-only animatronic, giving the game as it was before them.
const nightConfig = flag('--baseline')
  ? night => { const config = configForNight(night); for (const rule of Object.values(config.enemies)) if (rule.nights) rule.enabled = false; return config; }
  : configForNight;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => tty ? `\x1b[${code}m${text}\x1b[0m` : text;
const TONES = { phase: '1;33', heading: '1', danger: '31', warning: '33', safe: '32', muted: '2' };
const say = (text, tone, indent) => {
  if (tone === 'phase') console.log(`\n${paint(TONES.phase, `━━ ${text} ${'━'.repeat(Math.max(0, 52 - text.length))}`)}`);
  else console.log(`${'  '.repeat(indent)}${TONES[tone] ? paint(TONES[tone], text) : text}`);
};

console.log(paint('1', 'Balance agent · beta-testing Five Nights at Freddy’s'));
console.log(paint('2', `${nights.length} night${nights.length === 1 ? '' : 's'}${flag('--baseline') ? ' · baseline (planted animatronics removed)' : ''} · ${runs} runs per player`));

const result = runAgent({ runs, nights, nightConfig, say });
// The baseline run gets its own file so it never replaces the main report.
const files = writeReports(result, { name: flag('--baseline') ? 'baseline-report' : 'balance-report' });

console.log(`\n${paint('1', `Done: ${result.meta.simulatedNights.toLocaleString('en-US')} nights simulated in ${result.meta.seconds.toFixed(1)} s.`)}`);
if (result.tickets.length) {
  console.log(paint('1;31', `\n🚩 ${result.tickets.filter(t => t.reviewRequired).length} finding(s) need a human to play and confirm:`));
  for (const t of result.tickets) console.log(`   • Night ${t.night} · ${t.title}  ${paint('2', `(${t.severity})`)}`);
} else console.log(paint('32', '\nNo findings. Every night was beatable by human-like players.'));
const page = relative(process.cwd(), files.html);
console.log(`\nReport: ${page}  (also .md and .json)`);
console.log(paint('2', `To review: run \`python3 -m http.server 8000\` here, then open http://localhost:8000/balance-agent/reports/${files.html.split('/').pop()}`));

if (flag('--ci') && result.tickets.some(t => t.reviewRequired)) process.exitCode = 1;
