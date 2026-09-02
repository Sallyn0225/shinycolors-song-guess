# Protocol and Contracts

> `packages/shared/src/protocol.ts` is the only description of what crosses the wire.
> Both ends compile against it, so a mistake here is a mistake in four packages at once.

---

## The two directions are typed differently, on purpose

| Direction | Type | Validation |
|---|---|---|
| client → server | `clientMsgSchema` (zod discriminated union on `t`) | **runtime**, every message |
| server → client | `ServerMsg` (plain TS discriminated union on `t`) | none |

Inbound messages get a real zod schema because a TypeScript union is a compile-time
fiction — see `apps/server/src/ws/hub.ts`, which `safeParse`s every frame and answers
`{ t: 'error', code: 'bad_message' }` on failure. Outbound messages are produced by our own
server, so a hand-written union is enough and cheaper.

When you add a client message, add it to `clientMsgSchema` — not to a separate type. The
`ClientMsg` type is `z.input<typeof clientMsgSchema>`, so the schema *is* the type and the
two cannot drift.

`z.input`, not `z.infer`: `createRoom.visibility` carries `.default('private')`, and a
defaulted field is optional going out and guaranteed coming in. `ClientMsg` describes what a
client may *send*, so it must be the input type. The server never uses it — `hub.ts` reads
`safeParse(...).data`, which zod already types as the output.

Give every field a bound. The existing entries all do: `z.string().max(200)` for
`resumeToken`, `.max(40)` for card ids, `.max(64)` for a layout array, `.max(5000)` on a
reported RTT, `.max(64)` on a raw room name. An unbounded string in a WebSocket message is an
allocation attack.

---

## Defaults must fail towards "less exposed"

`createRoom.visibility` defaults to `private`. That direction is not a style preference: a
client that omits the field — an old build, a hand-rolled script, a bug — must not have its
room published to every stranger holding the URL. Any future field that gates exposure gets
the same treatment, and `packages/shared/src/protocol.test.ts` asserts it explicitly so the
default cannot be flipped by accident.

The same reasoning splits validation in two. `name` is bounded at `.max(64)` in zod but
normalised by `sanitizeRoomName` afterwards, not rejected at 24. Clipping first would read
"24 visible characters plus a few zero-width" as over-length and refuse a legitimate name;
zod is the allocation guard, the sanitiser is the semantic one.

## What a list entry may carry

`RoomSummary` is read by anyone, anonymously, without joining. Every field on it is
published. `Room.creatorIp` exists for per-IP quotas and is deliberately absent from both
`summary()` and `roomView()`; `apps/server/src/ws/lobby.test.ts` pins the exact key set so a
future field cannot be added there without someone noticing.

Private rooms never carry an *identifiable* form in `roomList`: no code, no name, no host
nickname, no status. What the message does carry is `privateTotal`, one aggregate number,
plus a `limits` object (`publicMax` / `privateMax` / `allowPrivate`). An aggregate count
identifies no room and does not shorten the 32^6 code enumeration — the cost of guessing a
code is still governed by `JOIN_FAIL_PER_MIN` in [the server's realtime guidelines](../../server/backend/realtime-guidelines.md).

Two totals stay public-only on purpose: `waitingTotal` and `busyTotal` count public rooms
exactly (they are pre-truncation totals), so no separate `publicTotal` field exists — adding
one would create two sources of truth that can drift. The public count shown in the lobby is
their sum. `limits` is a UX input only; the server re-validates every `createRoom` itself and
never trusts the client's view of the limits.

---

## What may never appear in a server → client message

This is a guessing game. The client is the adversary. Three categories are permanently
excluded from every view type in this file:

- **The answer for the current round.** `RevealView` exists precisely so that the song is
  disclosed at one explicit moment (`roundReveal` / `roundResult`) and never before.
  `roundArm` deliberately carries only an opaque `clipToken` and a URL.
- **`sliceId`, slice counts, durations.** With 233 songs a duration is very nearly a unique
  identifier. The client sees a per-round random token; the token → sliceId map lives in
  server memory only.
- **`answerIndex` for a solo question.** Grading is server-side
  (`packages/game-core/src/solo.ts#gradeAnswer`); the client submits an index and is told
  the result afterwards.

`CardView` carries `title`/`artist` on purpose — karuta is played with the cards face up,
so titles must be on screen. The secret is *which card is currently being read*, nothing
else.

---

## The comments on these types are load-bearing

Several fields exist to solve a specific problem and will look redundant to anyone who
does not know it. Keep the doc comments when you touch them:

- `PlayerView.rttMs` — both players' RTT is public. Transparency was chosen over pretending
  the match is symmetric.
- `ping.rttMs` — client-reported and therefore forgeable. The server clamps and
  self-calibrates it (`apps/server/src/ws/timing.ts`); it is a hint, never a fact.
- `TapVerdict.'clamped'` — appears only in `TapView`, never in game-core's own verdict set.
  The rules engine does not know about clamping; the transport layer relabels a tap that it
  corrected, so the post-match stats can show it.
- `welcome.resumed` — distinguishes "this connection took over your old seat" from "this is
  a fresh session". `apps/web/src/App.tsx` uses the `false` case to kick a player off a
  board whose seat is gone; without the flag they sit staring at a dead board.
- `roundReveal` is sent **only** when someone has a 送り札 to choose. Rounds without a
  choice go straight to `roundResult`. Adding an unconditional reveal would cost a
  round-trip on every round.

---

## Adding a message type

1. Add the variant to `clientMsgSchema` or the `ServerMsg` union.
2. Handle it in `apps/server/src/ws/hub.ts` (inbound) — the `switch` has a `default: break`,
   so an unhandled message is silently dropped rather than crashing.
3. Handle it in `apps/web/src/App.tsx` and/or `apps/web/src/screens/Karuta.tsx` (outbound).
   Both listen through `socket.on()`; a message type nobody handles is a no-op, so the
   compiler will not catch the omission for you.
4. Extend `apps/server/src/ws/room.test.ts` — it drives a real `ws` client against a real
   listening server, which is the only place the whole loop is exercised.

`encode()` at the bottom of the file is just `JSON.stringify`. It exists so that a future
change of wire format has one place to live; use it rather than stringifying inline.
