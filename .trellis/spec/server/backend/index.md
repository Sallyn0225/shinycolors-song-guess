# @scg/server Guidelines

> `apps/server` — Fastify HTTP + WebSocket. Owns authority, timers, secrecy and transport.
> It owns no rules; those live in `@scg/game-core`.

---

## What this package is

```
src/index.ts        process entry: keepAlive tuning, listen, SIGTERM
src/app.ts          buildApp(): all routes, static mounts, /ws registration
src/config.ts       SERVER_CONFIG from env, coverUrl()
src/catalog.ts      Catalog.load() — the public/private manifest split
src/soloSessions.ts SoloSessionStore — in-memory single-player sessions
src/ws/hub.ts       socket ↔ session ↔ room routing, zod validation, rate limit,
                    the public room registry and its coalesced list push
src/ws/room.ts      one 1v1 room: seats, round state machine, timers, broadcasts
src/ws/quota.ts     IpQuota — per-IP sliding windows for room creation and join failures
src/ws/timing.ts    PlayerTiming — the anti-cheat reaction-time adjudicator
```

72 tests: `app.test.ts` drives routes through `app.inject()`, `ws/room.test.ts` and
`ws/lobby.test.ts` drive real `ws` clients against a real listening server, `ws/quota.test.ts`
is a plain unit test with fake timers.

`buildApp()` takes an optional `{ rooms }` override for the room quotas. Production never
passes it. It exists because the two halves of the suite need opposite settings: a full match
needs generous limits to finish, and the throttling tests need limits tight enough to trip.
Environment variables cannot give you both in one process.

There is no database. All state is in-memory and intentionally so: a match is worthless
after it ends, and the private catalog must never be reachable over HTTP. Do not introduce
persistence without revisiting [Secrecy and Anti-Cheat](./secrecy-and-anticheat.md).

---

## The one-sentence architecture

`buildApp()` composes everything and returns a Fastify instance; `index.ts` only listens.
That split is what lets every test build a fresh app in `beforeAll` without a port.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Module layout, `buildApp` composition, where new code goes |
| [Realtime Guidelines](./realtime-guidelines.md) | Room state machine, server-authoritative timers, reconnect, heartbeat |
| [Secrecy and Anti-Cheat](./secrecy-and-anticheat.md) | Public/private catalog split, clip tokens, cache headers, reaction-time adjudication |
| [Error Handling](./error-handling.md) | zod at every boundary, `ErrCode`, when to answer and when to drop |
| [Logging Guidelines](./logging-guidelines.md) | Why the Fastify logger is off, what must never be printed |
| [Quality Guidelines](./quality-guidelines.md) | Test conventions, verification commands |

---

**Language**: spec files are written in English; source comments here are Chinese, and so
are the user-facing `message` strings in `ServerMsg`. Match the file you are editing.
