# @scg/game-core Guidelines

> `packages/game-core` — the rules of both game modes, as pure functions over plain data.
> No network, no clock, no I/O, no logging.

---

## What this package is

```
src/types.ts     Card, MatchState, Tap, RoundResult, SendRecord, KarutaConfig …
src/rng.ts       createRng(seed) — mulberry32 + xmur3, the only source of randomness
src/deal.ts      selectPool / dealMatch / applyLayout / cardsLeft
src/select.ts    pickNextReading / pickSlice — what gets read next
src/karuta.ts    adjudicate / pendingSends / applyRound — the 1v1 rules
src/solo.ts      generateSoloRound / pickDistractors / gradeAnswer — the solo rules
src/scoring.ts   scoreAnswer / maxScore
src/testing.ts   makeSongs / TEST_CONFIG — fixtures, shipped in src on purpose
src/index.ts     barrel
```

59 tests in `karuta.test.ts`, `solo.test.ts`, `scoring.test.ts`. Because everything here is
deterministic and pure, an entire match can be replayed in a unit test — that is the
property the package exists to preserve.

`apps/server` owns transport, timers and authority; this package owns *what the rules say*.
The split is what lets the rules be tested without a socket. The layer directory is named
`backend/` by the Trellis scaffold; nothing here is server-specific.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Module layout, dependency direction, where a new rule goes |
| [Purity and Determinism](./purity-and-determinism.md) | The non-negotiable properties and how existing code keeps them |
| [Error Handling](./error-handling.md) | When to throw, when to fall back silently |
| [Quality Guidelines](./quality-guidelines.md) | Test conventions, verification commands |

---

**Language**: spec files are written in English; source comments here are Chinese. Match
the file you are editing.
