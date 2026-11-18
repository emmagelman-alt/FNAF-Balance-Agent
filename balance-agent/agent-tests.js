// Checks that the balance agent catches exactly the three planted animatronics, for the
// right reasons, and stays quiet on the original game. Run: node balance-agent/agent-tests.js
import { configForNight } from '../src/config.js';
import { runAgent } from './agent.js';
import { auditNight } from './audit.js';
import { PLAYERS } from './players.js';
import { playNight } from './simulate.js';
import { pathToFileURL } from 'node:url';

export function runAgentTests({ runs = 40 } = {}) {
  const results = [];
  const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
  function test(name, run) { try { run(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: error.message }); } }
  const baseline = night => { const config = configForNight(night); for (const rule of Object.values(config.enemies)) if (rule.nights) rule.enabled = false; return config; };

  const planted = runAgent({ runs });
  test('Flags exactly Nights 2, 3 and 5, one ticket each', () => {
    assert(JSON.stringify(planted.tickets.map(t => t.night)) === '[2,3,5]', `Flagged ${planted.tickets.map(t => t.night)}`);
    assert(planted.nights.filter(n => n.status === 'fair').map(n => n.night).join() === '1,4', 'Nights 1 and 4 should pass');
  });
  test('Names the planted animatronic as the cause each time', () => {
    assert(planted.tickets.map(t => t.animatronic.id).join() === 'sprocket,brassbones,hush', planted.tickets.map(t => t.animatronic.id).join());
  });
  test('Gives each one the right diagnosis and severity', () => {
    const byId = Object.fromEntries(planted.tickets.map(t => [t.animatronic.id, t]));
    assert(byId.sprocket.category === 'reaction-window' && byId.sprocket.severity === 'high');
    assert(byId.brassbones.category === 'power' && byId.brassbones.severity === 'critical');
    assert(byId.hush.category === 'no-tells' && byId.hush.severity === 'high');
    assert(planted.tickets.every(t => t.reviewRequired && t.confidence === 'high' && t.checklist.length && t.timeline.length));
  });
  test('Stays quiet on the original game (no false alarms)', () => {
    const clean = runAgent({ runs, nightConfig: baseline });
    assert(clean.tickets.length === 0, `False alarms: ${clean.tickets.map(t => t.title).join('; ')}`);
  });
  test('Config audit spots each planted problem without simulating', () => {
    const issues = (night, id) => auditNight(configForNight(night)).animatronics.find(a => a.id === id).issues.map(i => i.id);
    assert(issues(2, 'sprocket').includes('reaction-window'));
    assert(issues(3, 'brassbones').includes('power-impossible'));
    assert(issues(5, 'hush').includes('no-tells'));
    for (let night = 1; night <= 5; night++) assert(auditNight(baseline(night)).animatronics.every(a => !a.issues.some(i => i.severity !== 'medium')), `Night ${night} baseline has a serious config issue`);
  });
  test('A replayed seed gives the identical night', () => {
    const config = configForNight(2);
    const a = playNight({ config, night: 2, profile: PLAYERS.average, seed: 1234, log: true });
    const b = playNight({ config, night: 2, profile: PLAYERS.average, seed: 1234, log: true });
    assert(JSON.stringify(a) === JSON.stringify(b));
  });
  test('Human players never see a stealth animatronic', () => {
    const config = configForNight(5);
    const run = playNight({ config, night: 5, profile: PLAYERS.veteran, seed: 7, log: true });
    assert(!run.win && run.cause === 'hush', `Expected a loss to Hush, got ${run.cause}`);
  });
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAgentTests();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ` — ${r.error}`}`);
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
