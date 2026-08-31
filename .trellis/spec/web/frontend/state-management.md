# State Management

> No Redux, no Zustand, no Context. Three module singletons, `useState` inside screens, and
> `useRef` for anything the render does not read. That is the whole system.

---

## The four places state can live

| Kind | Where | Examples |
|---|---|---|
| server-authoritative game state | `useState` in the screen, replaced wholesale from messages | `match`, `result`, `ended`, `reveal` |
| local UI state | `useState` in the screen | `selected`, `toast`, `okuriPicks`, `memorizeLeft` |
| timing / identity the render never reads | `useRef` | `deadlineRef`, `roundEndsAt`, `startedAtCtx`, `armed`, `tappedRef` |
| long-lived connections and caches | module singleton | `audio`, `socket`, `api` |

Nothing is lifted higher than it needs to be. `App` holds only the `Screen` union and the
resume flag; each screen owns everything else and it dies with the screen.

---

## The server owns the game; the client renders it

`match` is never patched field by field. Every message that changes the board replaces the
whole `MatchView`:

```tsx
case 'roundResult':
  setResult(msg.result)
  setMatch(msg.match)      // whole view, not a merge
```

The server sends a complete `MatchView` with every `matchStart` / `stateSync` /
`roundResult` precisely so the client never has to reconcile. Do not introduce a reducer
that applies deltas — the reconnect path (`stateSync`) exists to make wholesale replacement
always available, and a delta model would have to agree with the server's rules engine.

The one deliberate exception is **optimistic local feedback**: `myPick` marks the card you
just tapped immediately, without waiting for the server's verdict. It is separate state, it
never touches `match`, and it is cleared on the next round. That is the shape any future
optimistic UI should take.

---

## `useRef` for timing, `useState` for what renders

A ref is correct when the value changes more often than the screen should re-render, or when
a callback needs the current value without re-subscribing:

```tsx
const deadlineRef = useRef(0)       // read by a rAF getter, 60×/s
const startedAtCtx = useRef(0)      // AudioContext timestamp for reaction measurement
const armed = useRef<{ roundNo, token, url, fallbackUrl? } | null>(null)
const tappedRef = useRef(false)     // guards a second tap in one round
const okuriSent = useRef(false)     // guards a double submit
const stageRef = useRef<Stage>(stage); stageRef.current = stage   // mirror, see hooks guide
```

`SlotMap` (`features/karutaBoard.ts`) is a *mutable class* in a ref, with an explicit
`forceRender((n) => n + 1)` when its contents change. That is unusual and deliberate: the
slot map's whole purpose is to preserve card positions across updates, so it must survive
re-renders unchanged rather than be rebuilt from props. Rebuilding it from `match.layout`
each render would scramble the arrangement the player memorised — which is the one thing the
game asks them to do.

Guard flags belong in refs, not state. `tappedRef.current` is checked and set synchronously
inside one handler; a state flag would not have updated yet when a second event arrives in
the same tick.

---

## Screen switching

```tsx
type Screen =
  | { name: 'start' }
  | { name: 'play'; session: SessionInfo }
  | { name: 'result'; sessionId: string; difficulty: Difficulty }
  | { name: 'lobby' }
  | { name: 'karuta'; match: MatchView; memorizeEndsAtServer: number; resumed: boolean }
```

A discriminated union in `useState`, switched in `App.tsx#body()`. Data needed by a screen
is carried in its own variant, so a screen can never be rendered without it.

`setScreen((prev) => ...)` is used whenever the transition depends on where you are — the
`welcome{resumed:false}` handler only kicks you out **if** you are currently on the board.

`<Play key={screen.session.sessionId} />` forces a full remount per session, which throws
away every ref and effect. Reach for `key` rather than writing reset logic.

---

## The three singletons

**`audio` (`AudioEngine`)** — owns the `AudioContext`, an LRU of 3 decoded buffers, the
analyser, and `preferFallback`. It exposes state as getters computed from the audio clock
(`isPlaying` compares `ctx.currentTime` against the scheduled end) rather than as flags,
because a flag plus `setTimeout` let a stale timer kill a new playback's visualisation.

**`socket` (`GameSocket`)** — owns the WebSocket, the clock offset, the ping loop, backoff
reconnect, and the seat token in `sessionStorage`. `connect()` is idempotent. `clock` is a
plain public field, read via `socket.toLocalTime(serverTime)`; it changes every 2s and
nothing re-renders on it.

**`api`** — a plain object of typed fetch wrappers. Stateless.

**`ambience` (`Ambience`) and `sfx` (`Sfx`)** — the two consumers of `audio.bypass`: same
`AudioContext`, own parallel gain chain, never through `master`/`analyser` (see
`quality-guidelines.md`). Both keep their on/off state on themselves and let `main.tsx` +
`VolumeControl.commit()` push mute in; neither is ever React state. `sfx.play()` is
fire-and-forget: it swallows every failure silently because a missing click sound must never
break an interaction, and it caches decoded buffers so repeated sounds cost no network.

They are imported, never passed as props and never placed in Context. The rule this
enforces: **a React re-render must not be able to recreate a connection or an audio node.**

---

## Server time vs local time

Three clocks are in play and mixing them is the characteristic bug here:

| Clock | Use |
|---|---|
| `Date.now()` | wall clock; only meaningful after `socket.toLocalTime()` conversion |
| `performance.now()` | monotonic; all UI deadlines and the rAF getters |
| `AudioContext` time | scheduling playback and measuring reaction time |

The idiom for converting a server deadline into a UI deadline:

```tsx
const endsLocal = socket.toLocalTime(reveal.deadlineAtServer)
okuriEndsAt.current = performance.now() + (endsLocal - Date.now())
```

Server time → local wall clock → monotonic offset. Never store a server timestamp directly
in a ref that a `performance.now()`-based getter will read.

Reaction time is measured with `audio.reactionMsSince(startedAtCtx.current, e.timeStamp)`,
which uses `getOutputTimestamp()` rather than `currentTime`, because the two differ by the
hardware output latency — 20–40 ms wired, **150–300 ms on Bluetooth**. A player on
Bluetooth headphones hears every clip a quarter second late and loses every close round, and
this is invisible when testing on a wired desktop.

---

## `api.begin` is the clock's zero; anything pre-roll goes before it

In `Play.tsx` the answer deadline is **server-authoritative**: `deadlineRef` is seeded from
`api.begin`'s response and nothing else. The first-question 3-2-1 countdown (`'countdown'`
phase, `ui/ReadyCountdown.tsx`) is inserted **between** clip prefetch and `api.begin`, so the
countdown costs the player no answer time and the load chain reads:

```tsx
await audio.prefetch(...)        // decode done — never counted against the player
if (index === 0) await countdown // pre-roll UX; index > 0 skips it
const { deadlineMs } = await api.begin(...)   // the clock starts HERE, and only here
```

Invariants, all three verified by network timing (tick at t, go at t+3.0s, `begin` at t+3.01s):

1. `api.begin` stays **immediately before** the answering phase — any new pre-roll
   animation must be inserted before it, never between it and the deadline seeding.
2. Slow networks wait in `'loading'` first; the countdown only starts once the clip is
   decoded, so its 3 seconds are never inflated by download time.
3. Cancelling during the countdown (quit → effect cleanup) must resolve the awaited
   promise and let the chain die at the next `cancelled` check — no `begin`, no answer,
   no leaked timer. `ReadyCountdown` owns its own timeout and clears it on unmount.

`ReadyCountdown` (fixed 3-step rhythm, recursive `setTimeout`, self-owned timer) is
deliberately **not** the same component as `ui/Countdown.tsx` (continuous rAF readout that
tracks a server clock and clamps its jitter). Sharing them would weld a fixed rhythm to
clock-following constraints that only the latter has.

---

- **A global store.** Nothing is shared between screens except what the singletons already
  hold. A store would mostly hold a copy of `MatchView`, which the server already resends in
  full.
- **Context providers.** Same reason; the singletons are already module-global.
- **A reducer applying message deltas.** See above.
- **`match` derived state in state.** `cardById`, `kimariji` and the crease array are
  `useMemo`s over `match`. Keeping a second copy in `useState` guarantees they will
  eventually disagree.
