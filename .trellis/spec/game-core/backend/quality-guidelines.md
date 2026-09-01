# Quality Guidelines

> 62 tests across three files. Because the package is pure and seeded, the tests can assert
> exact outcomes rather than ranges — and they do.

---

## Verification

```bash
pnpm --filter @scg/game-core test        # vitest run — 62 tests
pnpm --filter @scg/game-core typecheck   # tsc --noEmit
pnpm -r test && pnpm -r typecheck        # before reporting done
```

There is no `vitest.config.ts` anywhere in this repo; vitest runs on defaults and picks up
`src/**/*.test.ts`. Tests live beside the code (`karuta.ts` / `karuta.test.ts`), not in a
separate `__tests__` tree.

---

## Test conventions in this package

Read the top of `packages/game-core/src/karuta.test.ts` before writing a new test — it
establishes the local helpers every test reuses:

```ts
const cfg = TEST_CONFIG
function deal(seed = 'test-seed', songs = makeSongs(120)) { ... }
function ownCard(state, player, at = 0): CardId { ... }
function fieldReading(state, cardId, roundNo = 1): Reading { ... }
function karafudaReading(state, roundNo = 1): Reading { ... }
```

- **`describe` and `it` titles are Chinese, and describe behaviour, not function names.**
  `it('同一 seed 发出同一副牌，不同 seed 发出不同的')`, not `it('dealMatch works')`.
- **Fixtures come from `makeSongs(n, groups)`**, never from the real catalog. The rules do
  not depend on real song data and the tests must not either.
- **Determinism is asserted directly** — deal twice with one seed, deal once with another,
  compare. Any new stateful rule deserves the same three-way test.
- **A comment above a test explains why the case exists** when the reason is domain
  knowledge rather than code. See the `migratory-echoes` / `reflect-sign` test: it records
  that these songs have 9 and 2 near-identical versions, which is why the constraint exists.

---

## What a new rule needs before it is done

1. The happy path.
2. The **fallback** path. Every rule here has one — bad `choices`, exhausted slices,
   an empty candidate set. Untested fallbacks are how a match hangs in production.
3. The **boundary**. `tieEpsilonMs` and `minHumanReactionMs` are inequalities; test just
   inside and just outside.
4. A determinism check if the rule consumes `Rng`.

---

## Reviewing a change here

- Did anything start reading `Date.now()`, `Math.random()`, or a module-level `let`? All
  three break replayability.
- Does `adjudicate` still return identical verdicts with and without `choices`? That
  invariant is what keeps the reveal honest — see
  [Purity and Determinism](./purity-and-determinism.md).
- Did a state transition spread deeply enough? `{ ...state }` leaves `cards` and `layout`
  shared with the caller.
- Is a new `throw` reachable from player input? If so it is probably a silent fallback
  instead — see [Error Handling](./error-handling.md).

---

## Known shape of the test suite

| File | Covers |
|---|---|
| `karuta.test.ts` (592 lines) | dealing, slice rotation, reading selection, every verdict, 送り札 choice and fallback, end conditions |
| `solo.test.ts` (227 lines) | target selection, distractor tiers, confusable-group exclusion, grading |
| `scoring.test.ts` (95 lines) | the speed curve, the speed grace period and its boundaries, replay penalty clamping, `maxScore` |

If a change touches slice selection, `karuta.test.ts` already asserts the rule that matters
most: **a repeated song must play a different slice**. Six 空札 have to cover 15–25 rounds,
so repetition is certain; reusing the same audio teaches players "I have heard this one, it
is a 空札, do not tap" and deletes the mechanic. Do not weaken that test.
