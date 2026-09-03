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
- `Hub`'s sweeper (`setInterval(..., SWEEP_MS)`, 5s) and its room-list flush timer
  (`setTimeout(..., LIST_FLUSH_MS)`, 250ms) are the two exceptions, and both call
  `.unref?.()` so neither can hold the process open. Do the same for any new timer in
  `hub.ts`.

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

### `broadcast()` does not exclude the subject — `peer` reaches the player it is about

`broadcast()` sends to both seats unconditionally, so `reattach()`'s
`broadcast({ t: 'peer', playerId: p, online: true })` is delivered **to `p` as well**. Since
`ws.ts` re-sends `hello` with the `resumeToken` on every `onopen`, a player whose own socket
blips mid-match receives a `peer{online:true}` describing themselves while their opponent may
still be disconnected.

That is correct on the wire — `peer` is a room fact, not a "your opponent" notification, and
the name says `playerId`, not `foe`. The contract it imposes is on the client: **every
`case 'peer'` handler must compare `msg.playerId` against its own seat before rendering
anything phrased as being about the opponent.** `Karuta.tsx` satisfies this by gating the
whole case (`if (msg.playerId === seatRef.current) break`) rather than per-effect, because
all three things it does — the grace countdown, the toast, the audio cue — take the opponent
as their subject.

The expensive half of that bug was never the false toast. It was `setPeerGraceEnds(null)`:
with the opponent genuinely offline, a self-reconnect wiped the standing banner *and* its
countdown, and **nothing re-sends it** — the next `peer` for that player only arrives if they
come back, and `sweep()`'s `forfeitIfAbandoned` speaks in `matchEnd`, not `peer`. The player
lost sight of a deadline that decides the match.

If a future message genuinely means "about the other player", send it with `send(peer, …)`
rather than teaching each client to filter — but do not retrofit that onto `peer`, whose
`playerId` field several handlers now read.

### Known gap: grace state does not survive a reload

`syncMessage()` carries `MatchView`, whose `players[foe].online` says *whether* the opponent
is offline, but no deadline — `graceEndsAtServer` rides only on the `peer` event. A socket
blip is harmless (the React tree is not remounted, so `peerGraceEnds` survives), but a full
page reload during the opponent's grace window leaves `Karuta` with `peerGraceEnds === null`
and therefore no banner and no countdown, even though the forfeit timer is still running.

Closing it means adding the deadline to `stateSync` (or sending a `peer` to the reattaching
player alone). Not done: it changes `protocol.ts`, `room.ts` and `Karuta.tsx` together, which
is wider than the client-side filter above.

---

## Reconnect and Recovery

Four pieces, all of which have to agree:

1. **Seat token & Storage.** `join()` mints `randomBytes(16).toString('hex')`. The client stores
   it in `localStorage` alongside an expiration timestamp (`RESUME_TTL_MS`), allowing reconnection
   even if the browser or tab was accidentally closed within the grace window (60s). Tab-level
   distinction (`sessionStorage` flag `scg.seatHeldInThisTab`) separates in-tab reloads (silent auto-claim)
   from new tabs.
2. **Seat probing (`hello{claim:false}`).** When a new tab opens with an existing credential, it must
   **never auto-claim** (which would snatch the seat from a live session or half-open socket). Instead, it
   sends a zero-side-effect probe: `hello{resumeToken, claim:false}`. The server checks `seatHasConnection(p)`
   and responds with `seatOffer{available, reason: 'ok' | 'busy' | 'gone'}` without mutating any room or socket state.
   - `ok`: seat is disconnected and within grace period; client offers "Rejoin / Forfeit".
   - `busy`: seat is currently connected in another tab/socket; client displays occupied status and retries.
   - `gone`: room closed, seat expired, or token already voided; client silently forgets credentials.
3. **`hello` with `resumeToken` (claim).** When claiming (`claim: true` or omitted), `Hub` calls `room.reattach()`,
   replies `welcome{resumed:true}` + `room` + `syncMessage()`, and broadcasts `peer{online:true}`.
4. **`welcome{resumed:false}` is a real answer.** When the token is not recognised the
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

### Forfeiting from Reconnection

When a player selects "Forfeit reconnection" in a new tab:
- If `available` (`reason: 'ok'`), client claims the seat (`hello{claim:true}`) then immediately sends `{t: 'leaveRoom'}`.
  This triggers `Room.leave()`, broadcasting `peerLeft` to the surviving opponent and returning the room to `waiting`.
- If `busy` or `gone`, client performs a pure local cleanup (`forgetSeat()`), avoiding invalid claims.

---

## Leaving is not disconnecting

`detach()` and `leave()` are siblings with opposite meanings, and the whole design depends on
never letting the client confuse them. One says "they may come back, the seat is held"; the
other says "they are not coming back, the seat is already gone".

| | disconnect | deliberate leave |
|---|---|---|
| trigger | socket closes → `Room.detach()` | `{t:'leaveRoom'}` → `Room.leave()` |
| opponent receives | `peer{online:false, graceEndsAtServer}` | `peerLeft{playerId, nickname, room}` |
| seat | held, reclaimable with `resumeToken` | released immediately, token voided |
| outcome | grace expires → `matchEnd('disconnect')` | room resets to waiting, **no `matchEnd`** |

Reusing `peer{online:false}` for a leave leaves the survivor watching a reconnect countdown
for someone who will never return. Reusing `error` or `roomClosed` is equally wrong: the first
means "that operation failed, you are still here", the second means "the room is gone" —
neither can express "your opponent left but the room is still yours".

### `leave()` mid-match must reset every field `startMatch()` sets

The failure this prevents is silent and total: `Room.status` is derived from match state, so a
single field left populated pins the room at `'playing'` forever. It then vanishes from the
lobby list *and* refuses to start again — the room is alive, listed nowhere, and unusable.

`resetToLobby()` exists to be diffed against `startMatch()` field by field. It mirrors
`state` / `pool` / `poolById` / `clipTokens` / `rematchVotes` / `memorizeEndsAt` / `ready`, and
additionally clears the per-round state `startMatch()` never had to touch: `reading`,
`roundPhase`, `roundStartAt`, `armedBy`, `taps`, `okuriWait`, `taken`, `otetsuki`. `timing` is
deliberately **kept** — the anti-cheat calibration belongs to the connection, not the match.
When you add a field to `startMatch()`, add it here in the same commit.

Own the timer teardown in exactly one place. `leave()` calls `clearTimers()` unconditionally
before branching, so `resetToLobby()` must not "helpfully" clear them too — two owners means
the next reader cannot tell which one is load-bearing.

`hub.ts` ordering is also load-bearing: `dropIfDeserted` runs **after** `room.leave()`, so the
survivor's `peerLeft` is sent before a room with nobody left in it is reclaimed.

### Seat ownership transfers with `reattach`; stale session pointers must be voided

**A successful `reattach` moves ownership of the seat to the new connection. Every other
session still pointing at that `(room, playerId)` must have its pointers cleared in the same
step** — `Hub.releaseSeatPointers(room, pid, keep)` in the `hello` branch.

The failure it prevents is the half-open socket from the section below. A player who pulls
their cable sends no FIN, so the old socket's close can arrive up to a heartbeat period
*after* the client has already reconnected on a new socket and `reattach` has swapped
`seat.conn`. That late close reaches `disconnect()`, which reads the old session's stale
`playerId` and calls `room.detach(pid)` — nulling the **new** connection's seat and
broadcasting `peer{online:false}`. With immediate reclamation in place the blast radius is
larger still: if the opponent is also offline at that moment, `dropIfDeserted` destroys the
room and invalidates both seat tokens.

The match must compare **both** `room` and `playerId`. Matching on `room` alone also clears
the opponent's session in the same room.

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

**Per-connection limiting cannot carry a public deployment.** "Open a socket, create a room,
disconnect, repeat" defeats it completely: every connection is fresh. Anything that must be
budgeted across reconnects is keyed by IP instead, in `ws/quota.ts`, and therefore
**depends on `TRUST_PROXY=1`** — without it `req.ip` is the proxy's own address and every
player shares one bucket. That degrades safely (stricter, not looser) but does misfire, so it
is documented in `DEPLOY.md` rather than left to be discovered.

The checks in `createRoom` run in a fixed order, and the order carries meaning: global
capacity (`server_busy`) first, then visibility admission and the per-visibility caps
(`bad_state` "private not offered here" / `server_busy` "public full" / `server_busy`
"private full"), then per-IP holdings and rate (`too_many_rooms`). The invariant is
**global before class before personal**: an overloaded server tells everyone the same thing
instead of letting each caller conclude they personally were throttled. Within that frame,
a closed private-room configuration answers `bad_state` before any "full" wording — "not
offered here" is more honest than "full 0/0" — and a rejected `private` request is never
silently downgraded to public: `visibility` defaults to `private` in the schema precisely so
an old client that omits the field hits the rejection and learns the room would not have
been exposed. The caps live in `RoomQuotas` alongside `max`; the list the lobby renders takes
`min(cap, max)` per class so it never shows a denominator that cannot be reached.

`joinRoom` counts **failures** only, and refuses before looking up the code once the bucket is
full. This is the actual guarantee behind a "private" room: 32^6 is about 1.07 billion codes,
but without a failure limit that is a few hours of brute force, not a lifetime.

## Five ways a room ends

`ROOM_TTL_MS` alone is not enough once rooms are publicly listed. One exit fires on the event
stack (`disconnect` / `leaveRoom`); the other four are `sweep()` fallbacks:

### Immediate reclamation on desertion

**"Reconnect grace protects the expectation that someone is waiting for you to return. A room with no live connections left is recycled immediately, and its seat tokens are invalidated on the spot."**

The criterion for immediate reclamation in `Hub.disconnect()` and `leaveRoom` is `room.allOffline`, **not** `room.isEmpty`:
- `detach()` unsets the live socket connection but deliberately retains the seat for reconnects.
- Consequently, a room where one player disconnected and the other left (or both disconnected, or a solo host disconnected) is neither empty nor expired.
- When no live connection remains in the room, there is nobody left to wait. Holding the room for 65s only advertised dead rooms in the lobby, burned public room quota, and allowed lonely players to reconnect to ghost rooms.
- Therefore, `dropIfDeserted()` triggers `dropRoom()` on disconnect and `leaveRoom` as soon as `allOffline` is met.

### Sweep fallbacks

| Condition | Bound | Why it exists |
|---|---|---|
| `isEmpty` — every seat released | next sweep (≤5s) | fallback for any path where seats were freed |
| `stale` — `ROOM_TTL_MS` since last activity | 30 min | original catch-all |
| `waitedTooLong` — `waiting` past `waitingTtlMs` | 15 min | nobody ever came; host is told via `roomClosed` |
| `abandoned` — `allOffline` past `abandonedTtlMs` | 65s | **fallback only** (if abnormal path bypassed disconnect); normal exits clean up immediately |

`abandoned` in `sweep()` is now a pure safety net. Normal disconnect or leave paths reclaim deserted rooms immediately on the event stack.

`waitedTooLong` measures from `createdAt`, not `lastActivity`: a host sitting in their own
room pings every 2s and would otherwise never time out.

## Keeping the list honest

`Room` does not know the list exists — it exposes `status` / `summary()` and nothing more.
`Hub` finds out that something changed by two routes, and needs both:

1. **Explicit** `markListDirty()` on the transitions Hub itself handles (create, join, leave,
   ready, room dropped).
2. **A signature diff in `sweep()`**, because `ready → 開局` and `matchEnd` happen inside
   `Room` with Hub nowhere on the call stack.

Giving `Room` an `onChange` callback would be tidier and is the wrong trade: it means adding a
call at six separate transitions, and a missed one is a room frozen at the wrong status in
everyone's list, with nothing failing. The diff cannot miss.

Pushes are coalesced through a single 250ms timer, and seating a player sets
`listening = false` — people inside a room do not need the lobby feed, and that is where the
broadcast volume would otherwise be.

## Look-ups by token, not by scan

`hello` resolves a `resumeToken` through `Hub.bySeatToken`, not by walking every room calling
`reattach`. With a bounded-but-large room count the scan is wasted work, and worse, `reattach`
broadcasts on success — so the scan's correctness rested on an unwritten assumption that
tokens never collide. The index makes that explicit. `dropRoom()` is the single exit for a room precisely so the index, the timers, the map, and any lingering session references (`s.room = null`, `s.playerId = null`) are cleared together.
