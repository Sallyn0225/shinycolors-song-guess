# Error Handling

> Two named error classes, thrown in exactly one situation each. Everything else falls back
> silently. Knowing which is which is most of the design.

---

## Throw when the *setup* is impossible

```ts
export class DealError extends Error {}   // deal.ts
export class SoloError extends Error {}   // solo.ts
```

Both are thrown only when the request cannot be satisfied at all, and always with a message
that names the numbers:

```ts
throw new DealError(`曲库不足：受易混淆组约束后只能抽出 ${picked.length} 首，需要 ${count} 首`)
throw new DealError(`poolSize(${config.poolSize}) 必须等于 fieldCards(${config.fieldCards}) + karafuda(${config.karafuda})`)
throw new SoloError(`无法为「${answer.id}」凑够 ${count} 个干扰项（只找到 ${out.length} 个）`)
```

Subclass rather than throwing bare `Error` when you add a comparable failure — the caller
should be able to tell "the catalog is too small" apart from a programming bug. Note that
`applyLayout` also throws `DealError` for an invalid permutation; the server catches it and
answers `{ t: 'error', code: 'bad_state' }` rather than letting it escape
(`apps/server/src/ws/room.ts#setLayout`).

Two bare `Error`s remain and are correct as such, because they signal an invariant this
package believes cannot be violated: `pick: 空数组` in `rng.ts`, and
`没有可读的曲子——对局应当已经结束` in `select.ts`. The server treats the latter as "the
match is over" (`nextRound` catches it and calls `endMatch('cleared')`), which is the honest
reading.

---

## Fall back silently when the *input* is bad

Player-supplied data is never a reason to throw. `adjudicate`'s `choices` may be absent,
too short, or name cards the player does not own; `sendOne` skips each invalid entry and
lands on `candidates[0]`. A round always resolves.

The reason is a gameplay one: a player who is slow, disconnected, or running a broken
client loses the *choice*, not the round. Throwing here would stall the match for both
players and hand a disconnect a way to avoid losing.

The same instinct appears one layer up: `Hub.handle`'s `switch` ends in `default: break`,
so an unknown-but-well-formed message is dropped rather than crashing the connection.

---

## Degrade before you fail

`pickDistractors` (solo.ts) is the model. Event-limited units have only two other songs, so
"same unit" cannot always produce three distractors. Instead of throwing, it walks a tier
chain — same unit → same album → similar title → whole library — and only throws
`SoloError` if all four tiers together came up short. The comment on the function records
that the chain is *required*, not defensive.

When you add a selection rule, add a tier, not a precondition.

---

## What not to do here

- **No `console.error`, no logging of any kind.** This package is silent; see
  [Purity and Determinism](./purity-and-determinism.md).
- **No `try/catch` around your own logic.** The only `try` in the package's callers is at
  the boundary (`room.ts`), which is where it belongs.
- **No returning `null` to mean "failed".** `null` in this package means a real domain
  value — `Card.owner === null` is "taken off the field", `RoundResult.winner === null` is
  "nobody took it". Overloading it with an error channel would break both.
- **No error codes.** The `ErrCode` union lives in `@scg/shared` and is a transport concern;
  mapping a `DealError` onto one is the server's job.
