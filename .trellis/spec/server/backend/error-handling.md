# Error Handling

> Two boundaries, two disciplines: HTTP validates and answers with a status code;
> WebSocket validates and answers with an `ErrCode` — or, often, deliberately says nothing.

---

## Validate at the boundary, with zod, every time

```ts
// app.ts
const parsed = createSessionSchema.safeParse(req.body)
if (!parsed.success) return reply.code(400).send({ error: '难度参数无效' })

// ws/hub.ts — every inbound frame
const result = clientMsgSchema.safeParse(parsed)
if (!result.success) { this.reply(socket, { t: 'error', code: 'bad_message', ... }); return }
```

Always `safeParse`, never `parse` — a throw inside the socket message handler takes down
the connection. The comment in `hub.ts` states the reason for validating at all:
*TypeScript's union types are a compile-time fiction; a malicious client does not read them.*

Route params are not zod-validated but are checked explicitly, because they arrive as
strings: `Number.isInteger(index)` before use, and the `/^[0-9A-Z]{20}$/` test on a resolved
slice id before it becomes a path segment.

---

## HTTP status codes in use

| Code | Meaning here |
|---|---|
| `400` | malformed body or param (`难度参数无效`, `题号无效`, `答案格式无效`) |
| `404` | session expired, question/room/slice not found, invalid clip token |
| `409` | already answered — `answer()` returns `null` for a second submission |
| `429` | replay budget exhausted (returned with `{ used, allowed }` so the UI can show it) |

Every error body is `{ error: string }` with a Chinese message, and the client's
`apps/web/src/api.ts#req` reads exactly that field. Keep the shape.

Note the deliberate ambiguity: an unknown clip token and a missing slice file both return
the same `404 无效的切片凭证` / `切片不存在` shape. Do not add a code that distinguishes
"this token was never valid" from "this token expired" — that is an oracle.

---

## The empty-body content-type parser

`POST /begin` and `POST /replay` have no body, but browsers may still send
`content-type: application/json`. Fastify's default parser then tries to parse `''` and
returns `400`. `app.ts` installs a parser that maps empty input to `{}`:

```ts
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const raw = typeof body === 'string' ? body.trim() : ''
  if (raw === '') return done(null, {})
  ...
})
```

The client side of the same bug is handled in `apps/web/src/api.ts`, which only sets the
header when there really is a body. Both halves exist; do not remove one thinking the other
covers it.

---

## On the WebSocket: answer, or drop, but never throw

`ErrCode` (in `@scg/shared`) has seven members: `room_not_found`, `room_full`,
`not_in_room`, `bad_state`, `bad_message`, `rate_limited`, `internal`. An error message
carries a code plus a Chinese `message`.

Errors are sent for things the player did that cannot work: joining a nonexistent room, a
full room, acting before joining, an invalid layout, exceeding the rate limit.

Everything else is **silently ignored**, and that is a design decision rather than laziness.
`Room`'s methods open with guards that just `return`:

```ts
if (!this.reading || this.reading.roundNo !== roundNo) return   // tap for a stale round
if (this.taps.has(player)) return                               // second tap in one round
if (!wait.needed.has(player) || wait.submitted.has(player)) return
```

These conditions are all reachable from ordinary network reordering — a tap that arrives
after the round resolved is normal, not an error. Sending an error would make the UI show a
scary message for a race the player cannot see or control. `Hub`'s message `switch` ends in
`default: break` for the same reason.

The dividing line: **if the player could act differently, tell them; if they could not,
drop it.**

---

## `try/catch` is for I/O and for third-party surfaces only

The four kinds that exist in this package, all justified:

```ts
socket.send(...)  // wrapped — the connection may have closed between check and write
fs.readFile(...)  // wrapped — missing slice/thumb becomes a 404
applyLayout(...)  // wrapped — DealError from game-core becomes { code: 'bad_state' }
pickNextReading() // wrapped — the "no readable song" throw means the match is over
```

That last one is worth noting: `nextRound()` catches and calls `endMatch('cleared')`,
turning a game-core invariant violation into the correct game outcome. Empty catch blocks
carry a comment saying why (`/* 连接已断 */`, `/* 对局尚未开始 */`). Never write a bare
`catch {}` without one.

---

## Failing at startup is correct

`Catalog.load()` throws `曲库为空——请先跑 pnpm assets all` when there are no songs, and
`buildApp()` does not catch it. A server with no catalog cannot do anything useful; crashing
with an actionable message beats serving empty rounds. Keep new startup validation in the
same style — throw with the command that fixes it.

---

## Shutdown

`index.ts` installs `SIGINT`/`SIGTERM` handlers that call `app.close()` before exiting.
Proxies and containers send SIGTERM; without the graceful close an in-progress match is cut
mid-round and the clients only see a socket drop with no explanation. `app.close()` runs the
`onClose` hook, which disposes the hub and every room's timers.
