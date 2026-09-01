# Tuning Constants

> `difficulty.ts` and `scoring.ts` are the whole tuning surface. Game feel is changed by
> editing a number here, never by editing logic elsewhere.

---

## The rule

If a number affects how the game *feels* — how long, how many, how fast, how punishing —
it belongs in `packages/shared/src/difficulty.ts` or `packages/shared/src/scoring.ts`, and
every consumer reads it from there.

Existing consumers do this consistently:

```ts
// apps/server/src/ws/room.ts
const OKURI_TIMEOUT_MS = KARUTA_DEFAULTS.okuriSeconds * 1000
const DISCONNECT_GRACE_MS = KARUTA_DEFAULTS.disconnectGraceSeconds * 1000

// apps/web/src/screens/Karuta.tsx
const ROUND_SECONDS = KARUTA_DEFAULTS.roundWindowSeconds

// apps/server/src/app.ts — /api/karuta/rules just spreads the object out to the client
app.get('/api/karuta/rules', async () => KARUTA_DEFAULTS)
```

The seconds → milliseconds conversion happens at the consumer. The constants are declared
in the unit a human tunes in (seconds), not the unit the code runs in.

Numbers that are *not* game feel stay with the code that owns them: `ARM_TIMEOUT_MS` and
`REVEAL_MS` in `room.ts`, `RTT_MAX_MS` and `TOL_FLOOR_MS` in `timing.ts`, `PING_INTERVAL_MS`
in `net/ws.ts`. Those are transport and scheduling details; moving them here would imply
they are dials worth turning.

---

## Knobs that look duplicated and are not

`DIFFICULTY_PRESETS.hard.clipSeconds` (6s) and `KARUTA_DEFAULTS.roundWindowSeconds` (8s)
are separate variables on purpose. One is the pace of answering a solo question, the other
is the pace of racing for a card. Binding them together means tuning either one silently
changes the other game mode. The comment in `difficulty.ts` says this; do not "simplify"
it away.

They were the same number (6s) for a while, and three consumers quietly re-derived the
online window from `hard.clipSeconds` anyway — `Karuta.tsx`'s `CLIP_SECONDS`, `Lobby.tsx`'s
"每回合" stat, and the `roundWindowSeconds` override in `/api/karuta/rules`. Nothing failed,
because both numbers were 6. The coupling only surfaced when the online window moved to 8s:
the client would have played and counted down 6s while the server judged against an 8s
`windowMs`. Equal values hide a wrong reference — when two knobs are documented as
independent, check that every consumer actually reads the one it means, not the one that
happens to hold the same number.

**Online mode reads exactly one knob for round pacing:** `KARUTA_DEFAULTS.roundWindowSeconds`.
It is simultaneously the playback length, the client countdown and the server's `windowMs`.
`KARUTA_DEFAULTS.difficulty` is a display label and song-selection setting; its
`clipSeconds` is not part of online pacing.

Same shape of reasoning elsewhere in the file:

- `clipSeconds` controls playback truncation only. Slice files on disk are always 15s
  (`tools/prepare-audio/src/config.ts#SLICE.durationSec`) — the file carries no difficulty
  information, which is an anti-cheat property, not an accident.
- `hard.clipSeconds` is 6, not 4 or 5. Below ~5 seconds music identification stops testing
  memory and starts testing luck; the difficulty gradient comes from question count, time
  limit, replay budget, distractor strategy and slice position instead.
- `roundWindowSeconds` is 8, wider than `hard.clipSeconds`, because an online round asks for
  two things inside one window — identify the song *and* find the matching card on the
  board — where a solo question only asks for a pick among four printed options.
- `REPLAY_PAUSES_TIMER = false` makes a replay cost real time. That is what stops
  "just replay twice every question" from being the dominant strategy, and it is why
  `SCORING.replayPenalty` only needs to be 10.
- `SCORING.speedCurve = 1.6` (applied as `left ** (1 / speedCurve)`) keeps most of the
  speed bonus alive through the first ~40% of the *decay window*. Linear decay made a
  normal-speed correct answer feel like a failure.
- `SCORING.speedGraceSeconds = 1.5` is why "decay window" is not the same as "time limit".
  The bonus stays at maximum for the first 1.5s after playback starts; only `limitMs -
  1.5s` is subject to decay. Without it the top solo tier was unreachable in practice:
  0.95 score rate required answering within **1.62s** on hard, where `clipSeconds` is 6 —
  you had to commit after hearing a quarter of the clip. With it the bar is 2.88s (hard)
  and 3.69s (easy). 1.0s was tried and only moved hard to 2.46s; 2.0s reaches 3.30s but
  visibly flattens the fast-vs-slow spread.

  Two properties worth keeping. It is **absolute, not proportional** — human reaction time
  does not shrink because the limit went from 15s to 10s, so this must never become a
  fraction of `answerSeconds`. And it absorbs **startup latency**: `elapsedMs` is measured
  from the server's `servedAt` stamp, but the client still needs a round trip plus decode
  before sound comes out, and that loss has nothing to do with recognition skill.

---

## Changing a preset

1. Edit the number here.
2. `pnpm -r test` — `apps/server/src/app.test.ts` asserts `/api/difficulties` matches
   `DIFFICULTY_PRESETS`, and `packages/game-core/src/scoring.test.ts` pins the scoring
   curve, so a change with unintended reach shows up immediately.
3. Update the comment if the reason changed. Every non-obvious value in these two files
   carries the measurement or the failed alternative that produced it — that is the format
   to follow when adding one.

`KARUTA_DEFAULTS` has an internal invariant that `dealMatch` enforces at runtime
(`packages/game-core/src/deal.ts`): `poolSize === fieldCards + karafuda`, and `fieldCards`
must be even. Change one, change all three.
