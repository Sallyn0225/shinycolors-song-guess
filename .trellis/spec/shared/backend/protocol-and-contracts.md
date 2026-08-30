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
`ClientMsg` type is `z.infer<typeof clientMsgSchema>`, so the schema *is* the type and the
two cannot drift.

Give every field a bound. The existing entries all do: `z.string().max(200)` for
`resumeToken`, `.max(40)` for card ids, `.max(64)` for a layout array, `.max(5000)` on a
reported RTT. An unbounded string in a WebSocket message is an allocation attack.

---

## What may never appear in a server → client message

This is a guessing game. The client is the adversary. Three categories are permanently
excluded from every view type in this file:

- **The answer for the current round.** `RevealView` exists precisely so that the song is
  disclosed at one explicit moment (`roundReveal` / `roundResult`) and never before.
  `roundArm` deliberately carries only an opaque `clipToken` and a URL.
- **`sliceId`, slice counts, durations.** With 234 songs a duration is very nearly a unique
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
