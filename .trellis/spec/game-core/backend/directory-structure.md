# Directory Structure

> One file per rules concern, flat under `src/`. No subdirectories — the package is ~900
> lines of logic and a folder tree would cost more than it buys.

---

## Dependency direction

```
types.ts   ← imported by everything, imports nothing
rng.ts     ← imports nothing
deal.ts    ← rng, types
select.ts  ← rng, types
karuta.ts  ← deal (cardsLeft), types
solo.ts    ← rng, types, @scg/shared (DIFFICULTY_PRESETS)
scoring.ts ← @scg/shared (SCORING)
index.ts   ← barrel, `export * from './x.js'` for all of the above
```

The only external dependency is `@scg/shared`, and only for constants and preset tables.
`@scg/game-core` must never import from `apps/server`, `apps/web`, or `@scg/prepare-audio`
— the server depends on it, not the reverse.

Relative imports carry a `.js` extension (`import { cardsLeft } from './deal.js'`). This is
required at runtime; see the shared package's
[directory structure](../../shared/backend/directory-structure.md) for why.

---

## The two game modes are separate files and stay separate

`karuta.ts` (1v1 card battle) and `solo.ts` (single-player quiz) share `rng.ts` and the
confusable-group idea, and nothing else. They have different state, different verdicts and
different failure modes. Resist factoring "common" helpers out of them: the one genuinely
shared concept — *never put two songs from the same `confusableGroup` in one match* — is
deliberately implemented twice, once in `selectPool` (deal.ts) and once in `pickTargets`
(solo.ts), because the surrounding constraints differ.

---

## Where a new rule goes

| The rule decides… | File |
|---|---|
| which songs are in this match, who starts with which card | `deal.ts` |
| which song/slice is read next round | `select.ts` |
| who won a round, which cards move, who owes a 送り札 | `karuta.ts` |
| which songs and distractors a solo round contains, whether an answer is right | `solo.ts` |
| how many points an answer is worth | `scoring.ts` |
| the shape of any of the above | `types.ts` |

If a "rule" needs the wall clock, a socket, or a database, it is not a rule — it belongs in
`apps/server/src/ws/room.ts`. The clearest example: `adjudicate()` judges taps by
*reaction time relative to clip start*, and the cross-check that stops a client from lying
about that number lives in `apps/server/src/ws/timing.ts`, outside this package.

---

## `testing.ts` ships in `src`

`makeSongs()` and `TEST_CONFIG` are exported from the package (though not from the
`index.ts` barrel — tests import `./testing.js` directly). Keeping fixtures next to the
code they exercise is intentional: `TEST_CONFIG` is a valid `KarutaConfig`, so if the
config shape changes, the fixture fails to compile in the same pass.
