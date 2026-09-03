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
| local persistent stats | localStorage facade (`useState` in screen on mount, written on solo settlement) | `records.ts`, `features/records.ts` |
| long-lived connections and caches | module singleton | `audio`, `socket`, `api` |

Nothing is lifted higher than it needs to be. `App` holds only the `Screen` union, the resume
flag and the seat offer being decided on `Splash`; each screen owns everything else and it
dies with the screen.

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
  | { name: 'room'; room: RoomView }
  | { name: 'karuta'; match: MatchView; memorizeEndsAtServer: number; resumed: boolean }
  | { name: 'records' }
```

A discriminated union in `useState`, switched in `App.tsx#body()`. Data needed by a screen
is carried in its own variant, so a screen can never be rendered without it.

`setScreen((prev) => ...)` is used whenever the transition depends on where you are — the
`welcome{resumed:false}` handler only kicks you out **if** you are currently on the board.

`<Play key={screen.session.sessionId} />` forces a full remount per session, which throws
away every ref and effect. Reach for `key` rather than writing reset logic.

---

## Local statistics: truth in localStorage, read once on mount

Solo match statistics are stored locally on the client (`records.ts`, `features/records.ts`).
The single source of truth is `localStorage['scg.stats']`.
The statistics screen (`screens/Records.tsx`) loads the snapshot into `useState` once on mount (`useState(() => loadRecords())`).
Writes only happen when solo match settlements are completed (`recordSolo(sessionId, summary)` in `screens/Result.tsx`).
Any clear action (`clearRecords()`) updates `localStorage` and resets screen state immediately.

---

## A credential with a TTL expires from "last held", not from "issued"

The seat token lives in `localStorage['scg.resumeToken']` as `{ token, exp }`, while
`sessionStorage['scg.seatHeldInThisTab']` marks the tab that owns it. That pair is what
separates the two recovery paths: **same-tab F5** (marker present → silent auto-claim) from
**new tab** (no marker → probe with `hello{claim:false}` and offer 找回 / 放弃). The storage
split is deliberate — `localStorage` is what lets a *closed* tab's credential survive,
`sessionStorage` is what still distinguishes the tabs.

`exp` must track **the last moment this client was still in the seat**, so the 2 s ping loop
in `GameSocket` pushes it forward, throttled to 10 s (`localStorage` writes are synchronous
and the board judges in milliseconds — do not write it every tick).

Writing `exp` only when the token is issued silently redefines it as "75 s after sitting
down". A match runs far longer than that, so the credential expires **while the match is
still running**: the disconnect offer never appears, and same-tab F5 stops recovering too,
because both paths are gated on `hasResumeToken`. Grace is 60 s server-side, so the throttle
must stay under `TTL − grace` (75 − 60 = 15 s) for the worst-case `exp` to still cover the
whole window.

The local `exp` is only a convenience. The authority on whether a seat can be reclaimed is
always the server's `seatOffer` — never decide "it's gone" from the client clock alone.

---

## One flag cannot mean both "in progress" and "what this visit is"

`resuming` in `App.tsx` is a **loading state**: it has to flip to `false` the moment recovery
succeeds, or the 「正在找回对局…」 placeholder never leaves. `Splash` needs a different
question answered — *is this visit a return to a match already in progress?* — and there,
success is exactly when the answer becomes `true`. The two meanings demand opposite values
at the same instant, so one flag cannot carry both.

Passing the loading flag for both made `Splash` fall back to its first-visit branch and play
the full 5–6 s opening greeting before handing off, because recovery almost always completes
before the user clicks the overlay away — the click is the audio-unlock gesture, so the
overlay outlives the recovery by design.

Derive the second meaning rather than adding a second flag; `screen` already records it:

```tsx
// Wrong
<Splash resume={resuming} />

// Correct — while the overlay is still up, reaching karuta/room can only be recovery
const resumePath = resuming || screen.name === 'karuta' || screen.name === 'room'
<Splash resume={resumePath} />
```

Deriving also sidesteps a race: both failure paths (the `RESUME_TIMEOUT_MS` timer and
`welcome{resumed:false}`) leave `screen` on `start` and flip `resuming` off, so the fallback
to the normal opening happens on its own — there is no timer to cancel on success.

---

## The three singletons

**`audio` (`AudioEngine`)** — owns the `AudioContext`, an LRU of 3 decoded buffers, the
analyser, and `preferFallback`. It exposes state as getters computed from the audio clock
(`isPlaying` compares `ctx.currentTime` against the scheduled end) rather than as flags,
because a flag plus `setTimeout` let a stale timer kill a new playback's visualisation.

**`socket` (`GameSocket`)** — owns the WebSocket, the clock offset, the ping loop, backoff
reconnect, and the seat credential (`localStorage` + the per-tab marker in `sessionStorage`,
see above). `connect()` is idempotent. `clock` is a
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
