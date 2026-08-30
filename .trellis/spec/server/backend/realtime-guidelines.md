# Realtime Guidelines

> `ws/hub.ts` + `ws/room.ts`. The server is authoritative on every clock and never waits on
> a client to make progress.

---

## The rule that generates most of this file

**A round advances on a server timer. A client message can only make it advance *earlier*.**

Every phase has a timeout that fires regardless:

```ts
// room.ts
this.after(ARM_TIMEOUT_MS, () => this.startRound())                   // 5s — download+decode
this.after(lead + windowMs + graceMs, () => this.resolveRound())      // the answering window
this.after(OKURI_TIMEOUT_MS, () => { if (choosing) this.finishRound() })  // 10s — 送り札 pick
this.after(REVEAL_MS, () => this.nextRound())                         // 2.8s — reveal
```

and the corresponding client message just short-circuits it:

```ts
clipReady() → if every *online* player is armed: clearTimers(); startRound()
tap()       → if every *online* player has tapped: clearTimers(); resolveRound()
okuri()     → if everyone who owes a card has submitted: clearTimers(); finishRound()
```

Note `online.every(...)`, not `['A','B'].every(...)`. A disconnected player must not be able
to stall the match by never answering — that would make pulling the plug a way to avoid
losing. Same reasoning behind `pendingSends(...).filter(p => this.seats[p.player]?.conn)`
in `resolveRound`: nobody is asked to choose a 送り札 if they are not there to answer.

Any new phase you add needs the same pair: a timer that always fires, and a fast path.

---

## `after()` / `clearTimers()` — the timer discipline

`Room` keeps every pending timeout in a `Set` and `clearTimers()` cancels all of them. There
is no per-timer handle, and that is deliberate: at any moment a room has exactly one live
deadline, so "cancel everything, then set the next one" is both correct and impossible to
get half-right.

Consequences to respect:

- Call `clearTimers()` *before* transitioning phase, not after.
- Never call `setTimeout` directly in `room.ts`. A timer outside the set survives
  `dispose()` and keeps a finished room alive.
- `Hub`'s sweeper (`setInterval(..., 15_000)`) is the one exception, and it calls
  `.unref?.()` so it cannot hold the process open. Do the same for any new interval.

---

## The round state machine

```
idle → arming → counting → open → (choosing) → revealing → arming → …
                                 ↘ revealing ↗
```

- `arming` — `roundArm` is broadcast with an opaque `clipToken`; clients download and decode.
- `counting` — start time is fixed and broadcast; taps are accepted but the audio has not
  begun. The lead is `max(600, 2 * maxOwd + 200)` ms, computed from the slower player's RTT,
  so both clients have time to schedule playback for the same instant.
- `open` — audio is audible.
- `choosing` — entered **only** when someone owes a 送り札 they can actually choose.
- `revealing` — result committed, 2.8s before the next round.

`resolveRound` guards with `if (roundPhase === 'revealing' || roundPhase === 'choosing') return`
and `finishRound` with `if (roundPhase === 'revealing') return`. Both are reachable from two
directions (timer and message), so re-entrancy guards are mandatory on any new transition.

---

## Rules stay in game-core; the room stays a shell

`Room` calls `dealMatch`, `applyLayout`, `pickNextReading`, `adjudicate`, `pendingSends`,
`applyRound` and stores what they return. It computes no verdicts of its own.

The two-pass `adjudicate` is the pattern to preserve: judge once without `choices` to find
out who must pick, broadcast that verdict as `roundReveal`, then judge again with the
collected `choices` in `finishRound`. Because `adjudicate` is pure, the reveal the player
already saw cannot contradict the stored result.

What *does* belong to `Room`: seat bookkeeping (`taken`, `otetsuki`), the clip-token map,
and relabelling a corrected tap as `verdict: 'clamped'` in `tapView()`. That verdict does
not exist in game-core, because clamping is a transport concern.

---

## Per-player views

`MatchView.you` differs per recipient, so a match update cannot be one broadcast:

```ts
private broadcastMatch(build: (p: PlayerId) => ServerMsg): void {
  for (const p of ['A', 'B'] as const) if (this.seats[p]) this.send(p, build(p))
}
```

Use `broadcast()` only for messages that are genuinely identical for both players
(`roundArm`, `roundStart`, `roundReveal`, `peer`, `rematchState`). Anything carrying a
`MatchView` or `RoomView` goes through `broadcastMatch`.

---

## Reconnect

Three pieces, all of which have to agree:

1. **Seat token.** `join()` mints `randomBytes(16).toString('hex')`; the client stores it in
   `sessionStorage` (not `localStorage` — two tabs on one machine must be two players).
2. **`hello` with `resumeToken`.** `Hub` scans every room for a matching token, calls
   `room.reattach()`, and replies `welcome{resumed:true}` + `room` + `syncMessage()`.
3. **`welcome{resumed:false}` is a real answer.** When the token is not recognised the
   server still replies, saying so. Without it the client sits forever on a "reconnecting"
   screen waiting for a `stateSync` that will never come — `apps/web/src/App.tsx` uses this
   exact case to return the player to the home screen with an explanation.

`syncMessage()` deliberately does **not** re-send `roundArm`. A reconnecting player has no
clip token and has not heard the audio; letting them into the current round would be unfair.
They get the board, the memorize deadline and the current round's end time so the UI can say
"wait", and they rejoin at the next round.

`detach()` does not free the seat — it nulls the connection, stamps `disconnectedAt`, and
broadcasts `peer{online:false, graceEndsAtServer}`. `Hub.sweep()` calls
`forfeitIfAbandoned()` every 15s, which ends the match after
`KARUTA_DEFAULTS.disconnectGraceSeconds`.

---

## Heartbeat: two layers, both needed

The client sends an application-level `ping` every 2s. That is not enough, for two distinct
reasons, so `app.ts` also runs a protocol-level ping every `WS_HEARTBEAT_MS` (25s default):

- some reverse proxies measure idleness at the frame level and ignore application messages;
- **a peer that loses power or has its cable pulled never sends a FIN.** The half-open
  socket holds the seat until TCP keepalive notices, which defaults to two hours.

The `alive` flag flips false before each ping and true on `pong`; two missed beats call
`socket.terminate()`. This is what gets a vanished player into the disconnect grace period
promptly. Do not remove it because "we already have a ping".

---

## Rate limiting and room lifetime

`Hub` allows 60 messages per second per connection (`RATE_WINDOW_MS`/`RATE_MAX`) and answers
`{ code: 'rate_limited' }` beyond that — the client's 2s ping plus taps is nowhere near it.
Rooms are swept when empty or after `ROOM_TTL_MS` (30 min) of inactivity; every state-
changing method calls `this.touch()`. If you add one that does not, the room can be
collected mid-match.
