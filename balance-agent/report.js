import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pct = rate => `${Math.round(rate * 100)}%`;
const STATUS = { fair: 'Fair', unwinnable: 'Unwinnable', 'beyond-humans': 'Beyond humans', 'expert-only': 'Expert only' };

// A plain-text version for a README, pull request, or chat message.
export function toMarkdown(result) {
  const lines = [];
  const { meta, tickets, nights, players } = result;
  lines.push('# Balance agent report', '');
  lines.push(`${meta.simulatedNights.toLocaleString('en-US')} simulated nights in ${meta.seconds.toFixed(1)} s · ${meta.runsPerPlayer} runs per player per night · ${meta.generatedAt}`, '');
  lines.push(tickets.length ? `**${tickets.length} area${tickets.length === 1 ? '' : 's'} flagged for human review.**` : '**Every night looks fair. Nothing needs a human.**', '');
  lines.push('## Win rate by night', '');
  lines.push(`| Player | ${nights.map(n => `Night ${n.night}`).join(' | ')} |`);
  lines.push(`|---|${nights.map(() => '---:').join('|')}|`);
  for (const player of players) lines.push(`| ${player.label} | ${nights.map(n => pct(n.results[player.id].winRate)).join(' | ')} |`);
  lines.push(`| **Verdict** | ${nights.map(n => STATUS[n.status]).join(' | ')} |`, '');
  if (tickets.length) lines.push('## Human review queue', '');
  for (const ticket of tickets) {
    lines.push(`### ${ticket.reviewRequired ? '🚩' : '⚠️'} Night ${ticket.night} · ${ticket.title}`, '');
    lines.push(`**${ticket.severity.toUpperCase()}** · ${ticket.animatronic.name}, ${ticket.animatronic.side} door · ${ticket.confidence} confidence · ${ticket.reviewRequired ? 'review required' : 'review suggested'}`, '');
    lines.push(ticket.summary, '');
    lines.push('**Evidence**', '', ...ticket.evidence.map(item => `- ${item}`), '');
    if (ticket.timeline.length) lines.push('**One Veteran loss, last moments**', '', ...ticket.timeline.map(event => `- \`${event.clock}\` ${event.text}`), '');
    lines.push('**When you play it, check**', '', ...ticket.checklist.map((item, i) => `${i + 1}. ${item}`), '');
    lines.push(`**Suggested fix:** ${ticket.suggestion}`, '');
    lines.push(`**Play it:** \`index.html?review=${ticket.night}\``, '');
  }
  return lines.join('\n');
}

export function writeReports(result, { outDir = join(here, 'reports'), name = 'balance-report' } = {}) {
  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(result, null, 2);
  // Keep the embedded JSON from ending the <script> element early.
  const embedded = JSON.stringify(result).replace(/</g, '\\u003c');
  const html = readFileSync(join(here, 'report-template.html'), 'utf8').replace('/*__REPORT_DATA__*/null', () => embedded);
  const files = {
    html: join(outDir, `${name}.html`),
    markdown: join(outDir, `${name}.md`),
    json: join(outDir, `${name}.json`),
  };
  writeFileSync(files.html, html);
  writeFileSync(files.markdown, toMarkdown(result));
  writeFileSync(files.json, json);
  return files;
}
