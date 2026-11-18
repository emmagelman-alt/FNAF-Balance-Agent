# Balance agent

An automated beta tester. It plays every night of the game thousands of times as different kinds of player, finds the nights and animatronics that are unfair or too hard for a person to beat, works out why, and asks a human to confirm each finding by playing it.

The point: catch balance problems in a new game (or a new character) before players do, and spend human playtesting time only where it matters.

## Run it

From the repository folder (needs Node 22 or newer, no install):

```sh
node balance-agent/run.js
```

It prints its reasoning as it works (about 20 seconds) and writes a report to `balance-agent/reports/`:

- `balance-report.html`: the review page, with a review queue, a difficulty map, details for each night, and the agent's log
- `balance-report.md`: the same findings as text, for a pull request or a chat message
- `balance-report.json`: everything, for other tools

To review the findings, serve the folder and open the report:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://localhost:8000/balance-agent/reports/balance-report.html>. Each finding has a **Play Night N yourself** button that opens the game straight into that night in review mode (a red banner shows why it was flagged, and your real save is not touched). Afterwards, record **Confirm: unfair / Needs tuning / Not a problem** and notes on the card. Verdicts save in your browser, and **Download review verdicts** exports them.

Options:

| Command | What it does |
|---|---|
| `node balance-agent/run.js --quick` | 60 runs per player instead of 150 (about 7 s) |
| `node balance-agent/run.js --baseline` | Tests the game without the three planted animatronics, writes `baseline-report.*` (expect no findings) |
| `node balance-agent/run.js --nights 2,5` | Only some nights |
| `node balance-agent/run.js --runs 400` | More runs per player, for tighter numbers |
| `node balance-agent/run.js --ci` | Exit code 1 when a review is required, so a build can wait for a human sign-off |
| `node balance-agent/agent-tests.js` | Self-check: the agent must flag exactly the three planted problems and nothing in the original game |

## The demo: three planted animatronics

To show the agent working, this copy of the game has three deliberately overpowered animatronics in `src/config.js`, each on one night and each broken in a different way:

| Night | Animatronic | What is wrong | What the agent should conclude |
|---|---|---|---|
| 2 | **Sprocket** (left door) | Attacks 0.2 s after its doorway warning | Too fast for human reflexes. The perfect bot wins, humans can't |
| 3 | **Brassbones** (right door) | The door must stay shut 30 s, and it is back 3–5 s later | Needs more power than the night has. Nobody can win |
| 5 | **Hush** (left door) | Never on camera, not in the doorway light, no text or sound | No warning at all. Only the perfect bot, which can see it, survives |

Nights 1 and 4 are untouched and act as the control: the agent should call them fair.

## How it works

1. **Survey.** Plays every night 150 times as each of four players, using the real game engine (`src/engine.js`), not a copy. A night takes about 4 ms to simulate.
2. **Detect.** Calls a night *unwinnable* if even the perfect bot usually loses, *beyond humans* if the bot wins but Veterans don't, and *expert-only* if Average players almost never win. It also notes difficulty spikes (a sudden drop from the night before).
3. **Investigate.** For each suspicious night, it finds the cause rather than just the killer:
   - **Leave-one-out:** replays the night with each animatronic removed. The one whose removal brings the win rate back is the cause. This is how it sees that Night 3's losses are "power failure" but the real cause is Brassbones.
   - **Solo test:** that animatronic alone, against a Veteran and the perfect bot.
   - **Workaround check:** a Veteran who keeps that door shut all night. If that wins, the problem has a (boring) workaround.
   - **Config audit** (`audit.js`): reads the numbers directly. Warning time against the human reaction floor (0.25 s), how many cues a player gets (camera, warning text, sound), and the smallest share of the night the door must be shut, priced against the night's spare power.
   - **Replay:** reruns one Veteran loss with the same seed and keeps its last moments as a timeline.
4. **Call for human review.** Writes one ticket per cause, with severity, confidence (high when the simulation and the config audit agree), evidence, the timeline, a checklist of what to try when you play it, and a suggested fix.

### The players

All human players act only on what the screen and speakers show, after a reaction time drawn for each warning. They sometimes miss a warning until their next look around, and they rely on the game's "retreated, safe to reopen" message.

| Player | Reaction | Misses | Pirate Cove checks |
|---|---|---|---|
| Rookie | ~0.85 s (never under 0.4 s) | 1 in 8 warnings | every ~28 s |
| Average player | ~0.6 s (never under 0.3 s) | 1 in 16 | every ~18 s |
| Veteran | ~0.38 s (never under 0.26 s) | 1 in 50 | every ~13 s |
| Perfect bot | one 0.05 s simulation step | never; sees hidden animatronics too | only when Foxy is about to run |

The perfect bot is not meant to be human. It is the ceiling: if it can't win, nobody can, and if it wins while every human loses, the night asks for something people don't have.

Every run is seeded, so any simulated night can be replayed exactly.

### Files

| File | Job |
|---|---|
| `run.js` | Command line: runs the agent, prints its reasoning, writes the reports |
| `agent.js` | The agent: survey, detect, investigate, write review tickets. Thresholds are at the top |
| `players.js` | The four players and what a human can perceive |
| `simulate.js` | Plays one night (or many) through the real engine and records what happened |
| `audit.js` | Reads an animatronic's numbers and checks them against human limits and the power budget |
| `report.js`, `report-template.html` | The HTML, Markdown and JSON reports |
| `agent-tests.js` | Self-check for the agent |

## Using it on a new animatronic or game change

Add or change an animatronic in `src/config.js` and run the agent again. It needs no list of which characters are new: it tests whatever is in the config, the same way, every time. To change what counts as unfair, edit `THRESHOLDS` in `agent.js` or `HUMAN_REACTION_FLOOR` in `players.js`.

## Limits

- The human players are rules, not people: they model reaction time, attention lapses and reading the game's messages, but not learning, panic, or clever strategies. That is why the agent asks a person to confirm instead of deciding on its own.
- Sound is modeled only as "this warning was noticed or missed", not as how loud or clear it is.
- The perfect bot's door timing is very good but not proven optimal, so a night it can't win is "almost certainly unwinnable". The config audit's power check backs this up with arithmetic.
