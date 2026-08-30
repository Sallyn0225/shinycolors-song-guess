# Hook Guidelines

> Only the built-in hooks. There is no custom hook and no `hooks/` directory in this
> codebase — screens use `useState`/`useEffect`/`useRef`/`useCallback`/`useMemo` directly.

---

## Subscriptions: the singleton returns its own unsubscribe

`GameSocket.on()` and `GameSocket.onStatus()` return an unsubscribe function, so the effect
is one line:

```tsx
useEffect(() => {
  const off = socket.on((msg) => { switch (msg.t) { ... } })
  return off
}, [])

useEffect(() => {
  setOnline(socket.connected)      // seed from current truth first
  return socket.onStatus(setOnline)
}, [])
```

Two details that are load bearing:

- **Seed from the singleton's current value before subscribing.** The socket may already be
  connected when the component mounts; a subscription alone only sees the *next* change.
  `useState(() => socket.connected)` and `useState(() => socket.hasResumeToken)` do the same
  thing at initialisation.
- **Listeners are a `Set`, not a single slot.** `App` and `Karuta` are both subscribed at
  the same time. Never replace the callback registry with one handler.

**A component cannot receive a message sent before it mounted.** `Karuta` is rendered *in
response to* `matchStart`, so its own listener registers after that message has passed.
This is why `App.tsx` catches `matchStart` and `stateSync` and passes their contents down as
props (`initialMatch`, `memorizeEndsAtServer`, `resumed`). Any future screen mounted by a
message needs the same treatment.

---

## Async effects: the `cancelled` flag

Every effect that awaits must guard against unmounting and against re-running:

```tsx
useEffect(() => {
  let cancelled = false
  void (async () => {
    const q = await api.question(sid, index)
    if (cancelled) return
    setQuestion(q)
    await audio.prefetch(...)
    if (cancelled) return
    const { deadlineMs } = await api.begin(sid, index)
    if (cancelled) return
    ...
  })()
  return () => { cancelled = true; audio.stop() }
}, [index, reload, ...])
```

Check after **every** `await`, not only the first. `Play.tsx` awaits three times and checks
three times; skipping one lets a stale question overwrite the current one when a player
advances fast.

The effect body is a `void (async () => {...})()` IIFE — the effect callback itself must
stay synchronous so it can return a cleanup function.

`void` before a floating promise is the local convention for "deliberately not awaited"
(`void playClip(q)`, `void submit(...)`, `void start(d)`).

---

## Timers: one `setTimeout` beats a per-frame check

```tsx
// deadline — not a rAF loop, not a 100ms poll
useEffect(() => {
  if (phase !== 'answering') return
  const left = Math.max(0, deadlineRef.current - performance.now())
  const t = window.setTimeout(() => void submit(TIMED_OUT), left)
  return () => window.clearTimeout(t)
}, [phase, submit])
```

Countdowns that only need to display whole seconds use a coarse interval — 250ms for the
memorize clock, 500ms for the disconnect grace, 200ms for the 送り札 pick. Choose the
interval from the precision the *display* needs, not from smoothness.

Use `window.setTimeout` / `window.clearInterval` (not the bare globals) so the return type
is `number` rather than Node's `Timeout`; the whole codebase does this.

**Anything that must move every frame does not use state at all** — see below.

---

## Never `setState` per animation frame

React 18's concurrent scheduler batches per-frame `setState`; the symptom is a countdown
that "sometimes doesn't respond". `ui/PrismRail.tsx` runs exactly one rAF loop and writes
`style.clipPath`, canvas pixels and `textContent` directly.

The pattern for feeding it: the parent passes a **`useCallback` getter**, and the rail calls
it each frame.

```tsx
// Play.tsx
const getRemaining = useCallback(() => {
  if (phaseRef.current !== 'answering') return phaseRef.current === 'loading' ? 1 : 0
  return Math.max(0, (deadlineRef.current - performance.now()) / (session.answerSeconds * 1000))
}, [session.answerSeconds])
```

The getter reads **refs**, never state, so its identity stays stable and the rAF loop is
never restarted. That is why `phaseRef`, `deadlineRef`, `roundEndsAt`, `okuriEndsAt` and
`stageRef` exist.

---

## The mirror-ref pattern

```tsx
const phaseRef = useRef<Phase>('loading')
phaseRef.current = phase          // assigned during render, deliberately
```

Assigned in the render body — not in an effect — so it is correct before any callback can
fire. `Play.tsx` uses it for `phase`, `Karuta.tsx` for `stage`. Two uses:

1. rAF getters and event handlers read the current value without re-subscribing.
2. Guarding against double submission: `submit()` checks `phaseRef.current !== 'answering'`
   and then sets `phaseRef.current = 'revealed'` **before** the `await`, closing the window
   where two fast keypresses both pass the state check.

---

## `useCallback` / `useMemo`: when they are required

Not for micro-optimisation. Use them where identity or cost actually matters:

- a function passed into a rAF loop or a long-lived effect (`getRemaining`, `syncSlots`);
- a function in another effect's dependency array (`submit`, `replay`, `next`, `playClip`) —
  without `useCallback` the keyboard-listener effect re-subscribes on every render;
- a real computation per render: `computeKimariji` over 24 titles, building a
  `Map<CardId, CardView>`, generating the crease array.

Dependency arrays are complete and honest. `Play.tsx`'s loader lists all seven of its
dependencies rather than suppressing the rule.

---

## Non-visual singletons are imported, never held in state

`audio`, `socket` and `api` are module-level singletons imported directly. Putting an
`AudioContext` or a `WebSocket` in state re-creates nodes on re-render, which causes clicks,
leaks and duplicated connections.

Corollaries visible in the code:

- `audio.isPlaying` is derived from the engine's own scheduled end time, not from a state
  flag plus `setTimeout` — the earlier version let a stale timeout kill the visualisation of
  a *new* playback on replay.
- `socket.connect()` is idempotent, because the reconnect screen and the lobby both call it
  and a second socket would fight for the seat.

---

## Escape-hatch effects

Two effects manipulate the DOM directly, and both are correct:

- **`inert` on the board while an overlay is open** — `boardRef.current.setAttribute('inert', '')`.
  There is no React prop for it in React 18.
- **Focus trap in the settlement overlay** — query focusables, focus the first, intercept
  Tab. `ui/Overlay.tsx` has the reusable version; `Karuta.tsx` repeats it for the end-of-match
  dialog because that one is not an `Overlay`.

Both clean up after themselves. When reaching for the DOM, keep it to a `useEffect` with a
ref and a cleanup — never in render.

---

## Audio unlock must sit in a real gesture's call stack

```tsx
const start = useCallback(async (difficulty) => {
  await audio.unlock()          // first line, inside the click handler
  const session = await api.createSession(difficulty)
  ...
}, [])
```

Not in a mount effect, not after another `await` that could break the user-activation chain.
Getting this wrong is silent in local development and produces a completely silent first
question in production. After a reload mid-match the context is locked again, which is what
`needGesture` and the "click to continue" overlay in `Karuta.tsx` exist for.
