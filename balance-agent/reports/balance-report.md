# Balance agent report

5,160 simulated nights in 17.2 s · 150 runs per player per night · 2026-11-18T21:23:15.697Z

**3 areas flagged for human review.**

## Win rate by night

| Player | Night 1 | Night 2 | Night 3 | Night 4 | Night 5 |
|---|---:|---:|---:|---:|---:|
| Rookie | 97% | 0% | 0% | 75% | 0% |
| Average player | 100% | 0% | 0% | 100% | 0% |
| Veteran | 100% | 0% | 0% | 100% | 0% |
| Perfect bot | 100% | 100% | 0% | 100% | 100% |
| **Verdict** | Fair | Beyond humans | Unwinnable | Fair | Beyond humans |

## Human review queue

### 🚩 Night 2 · Sprocket attacks faster than a person can react

**HIGH** · Sprocket, left door · high confidence · review required

Sprocket's doorway warning lasts 0.20 s before it attacks, under the 0.25 s human floor. Veterans won 0% of the night; the perfect bot, reacting within one 0.05 s step, won 100%.

**Evidence**

- Survey (150 nights per player): Rookie 0%, Average player 0%, Veteran 0%, Perfect bot 100%.
- Taking Sprocket out raises the Veteran win rate from 0% to 100% (+100 pts).
- Sprocket alone: Veteran 0%, perfect bot 100%.
- Keeping the left door shut all night does not work (Veteran 0%) (power runs out around 4:39 AM).
- Config: Attacks 0.20 s after its doorway warning. Even elite players need at least 0.25 s to see a cue and press a key.
- Difficulty spike: human win rate fell 100 points from Night 1.

**One Veteran loss, last moments**

- `12:44 AM` Sprocket reaches the left door; attack in 0.20 s unless the door is shut.
- `12:44 AM` Player sees the Sprocket warning and reaches for the left door (reaction 0.43 s).
- `12:45 AM` Sprocket gets in through the left door.

**When you play it, check**

1. Play the night and watch the left door. When the warning for Sprocket appears, can you shut the door before it attacks?
2. Look for anything that predicts its move early (a camera, a sound). If you find one, the agent missed a strategy.
3. Decide: unfair, or an intended "learn the pattern" challenge?

**Suggested fix:** Give Sprocket a warning a person can answer: raise attackDelay from 0.2 s to at least 1 s (the other animatronics tonight allow 4.6 s or more), or add a cue before it reaches the door.

**Play it:** `index.html?review=2`

### 🚩 Night 3 · Brassbones needs more power than the night has

**CRITICAL** · Brassbones, right door · high confidence · review required

Stopping Brassbones takes the right door shut at least 75% of the time it is active. Even perfect play wins 0%, running out of power around 5:13 AM.

**Evidence**

- Survey (150 nights per player): Rookie 0%, Average player 0%, Veteran 0%, Perfect bot 0%.
- Taking Brassbones out raises the Perfect bot win rate from 0% to 100% (+100 pts).
- Brassbones alone: Veteran 0%, perfect bot 0%.
- Keeping the right door shut all night does not work (Veteran 0%) (power runs out around 4:29 AM).
- Config: Needs the right door shut at least 75% of the time it is active (53 power), but the night only leaves 45 power for every device combined.

**One Veteran loss, last moments**

- `4:42 AM` Bonnie is blocked and retreats.
- `4:42 AM` Player opens the left door.
- `4:43 AM` Brassbones is blocked and retreats.
- `4:43 AM` Player opens the right door.
- `4:46 AM` Chica reaches the right door; attack in 5.95 s unless the door is shut.
- `4:46 AM` Player sees the Chica warning and reaches for the right door (reaction 0.51 s).
- `4:46 AM` Player closes the right door.
- `4:46 AM` Brassbones reaches the right door; attack in 6.00 s unless the door is shut.
- `4:47 AM` Power runs out. Every door opens.
- `5:05 AM` Caught in the dark after the power failure.

**When you play it, check**

1. Play the night and shut the right door each time Brassbones arrives. Note what time the power runs out.
2. Try any strategy you think the agent missed (timing the door, ignoring other threats).
3. Decide whether to shorten the door hold, lengthen the return trip, or lower power costs.

**Suggested fix:** Cut Brassbones's door time: lower blockDuration from 30 s to about 3 s, or send it further back after a block (retreatIndex) so the return trip takes longer.

**Play it:** `index.html?review=3`

### 🚩 Night 5 · Hush gives players no warning at all

**HIGH** · Hush, left door · high confidence · review required

Hush never appears on camera, in the doorway light, in the warning text, or in sound. Veterans won 0%; the perfect bot, the only player that can see it, won 100%.

**Evidence**

- Survey (150 nights per player): Rookie 0%, Average player 0%, Veteran 0%, Perfect bot 100%.
- Taking Hush out raises the Veteran win rate from 0% to 100% (+100 pts).
- Hush alone: Veteran 0%, perfect bot 100%.
- Keeping the left door shut all night does not work (Veteran 0%) (power runs out around 4:33 AM).
- Config: Gives no cue at all: never on camera, no doorway warning, no sound. A player cannot know when to close the door.
- Difficulty spike: human win rate fell 100 points from Night 4.

**One Veteran loss, last moments**

- `12:57 AM` Bonnie reaches the left door; attack in 4.62 s unless the door is shut.
- `12:57 AM` Player sees the Bonnie warning and reaches for the left door (reaction 0.35 s).
- `12:57 AM` Player closes the left door.
- `1:00 AM` Bonnie is blocked and retreats.
- `1:01 AM` Player opens the left door.
- `1:24 AM` Hush reaches the left door (no warning shown); attack in 3.00 s unless the door is shut.
- `1:27 AM` Hush gets in through the left door.

**When you play it, check**

1. Play the night. When Hush gets you, was there any picture, light, text or sound that warned you?
2. Check whether the missing tell is on purpose (a design choice) or a bug (missing art, sound, or camera placement).
3. Decide: unfair, or a deliberate "guess" mechanic that needs a hint in the briefing?

**Suggested fix:** Give Hush at least one tell: show it on a camera or in the left doorway light, or play footsteps when it reaches the door. Then rerun the agent.

**Play it:** `index.html?review=5`
