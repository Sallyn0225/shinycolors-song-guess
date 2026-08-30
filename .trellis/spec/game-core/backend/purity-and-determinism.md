# Purity and Determinism

> Every exported function here takes state in and returns new state out. Nothing mutates
> its arguments, nothing reads the clock, nothing calls `Math.random`. These are load-
> bearing properties, not style preferences.

---

## Randomness is always seeded, and the seed is always derived

`packages/game-core/src/rng.ts` is the only randomness in the package: xmur3 to hash a
string seed into 32 bits, then mulberry32. `Math.random()` appears nowhere and must not.

The pattern to copy is **deriving a sub-seed per decision** rather than threading one `Rng`
instance through everything:

```ts
// select.ts
const rng = createRng(`${state.seed}:read:${state.roundNo}`)
const rng = createRng(`${state.seed}:slice:${song.id}:${used.length}`)
// deal.ts
const rng = createRng(`${seed}:pool`)
const rng = createRng(`${seed}:deal`)
```

Each call site gets a stream that depends only on inputs it can see. That is what makes
`pickNextReading` callable twice with the same state and produce the same answer — a shared
mutable generator would make the result depend on call order, and the server does call
`adjudicate` twice per round (see below).

A match seed is stored in `MatchState.seed` (`apps/server/src/ws/room.ts` generates it with
`randomBytes(16).toString('hex')`). Any bug in a real match is reproducible from that
string alone.

---

## `adjudicate()` is called twice per round, and must agree with itself

This is the sharpest constraint in the package. `apps/server/src/ws/room.ts#resolveRound`
runs `adjudicate(state, reading, taps, config)` with **no** `choices` to discover who owes
a 送り札, broadcasts `roundReveal` with that verdict, waits up to 10s for the players to
pick, then runs `adjudicate(..., choices)` again in `finishRound` to produce the result it
actually stores.

Both calls must produce the same winner, the same verdicts and the same `takenCardId` —
otherwise the reveal the player already saw contradicts the result. Purity is what
guarantees this. Two consequences for anyone editing `karuta.ts`:

- Never let a decision depend on anything outside `(state, reading, taps, config, choices)`.
- The candidate set offered to a player must not shift between the two calls. This is why
  `sendOne` excludes cards received *this round* (`incoming`): when both players owe a card
  in the same round, including freshly received cards would make the second player's
  candidate list depend on the first player's choice, invalidating the list already shown.

---

## Always return a result; never leave the caller stuck

`adjudicate` accepts `choices` that may be missing, malformed, or reference cards the
player does not own. Every one of those falls back silently to the deterministic automatic
rule — send `layout[from][0]`, the card that has been in your territory longest. It never
throws for bad input and never returns "undecided".

The automatic rule is deterministic *because* players can predict it, which makes it part
of the strategy rather than noise. Keep that property: a random fallback would be simpler
and worse.

`pendingSends()` filters out anyone with only one candidate — offering a choice of one
interrupts the pace for no decision.

---

## Immutability in practice

State transitions build a new object:

```ts
// deal.ts
return { ...state, layout: { ...state.layout, [player]: [...order] } }
// karuta.ts#applyRound
const cards = { ...state.cards }
const layout = { A: [...state.layout.A], B: [...state.layout.B] }
```

Note that `Record` fields need their own spread — `{ ...state }` alone leaves `cards` and
`layout` aliased to the caller's objects, and the caller (`Room`) holds onto the previous
state. Copy one level deeper than feels necessary; every existing transition does.

`applyRound` deliberately *replays* the `transfers` that `adjudicate` already computed
rather than recomputing anything. Judging and committing therefore cannot disagree.

---

## No clock, no logging

`Date.now()` and `performance.now()` appear nowhere in this package. Timing enters as data:
`Tap.reactionMs` is milliseconds relative to clip start, and `KarutaConfig.windowMs` is the
budget. A rule that needs to know "how long ago" takes it as a parameter.

There is no logger and no `console.*` call in `packages/game-core`. Diagnostics belong to
the caller — `RoundResult` carries `sends[]` with `candidates` and `chosen` precisely so the
server can report what happened without this package printing anything.
