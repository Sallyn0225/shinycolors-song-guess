# Logging Guidelines

> The Fastify logger is off and there is no logging library. That is a decision, and it
> comes with rules about what may be printed at all.

---

## Current state

```ts
const app = Fastify({ logger: false, trustProxy: SERVER_CONFIG.trustProxy })
```

The only output the server produces is four `process.stdout.write` lines at startup in
`apps/server/src/index.ts`: the local URL, the LAN URL, and whether the web build is being
served from this process. Nothing is logged per request, per message or per round.

`console.log` appears nowhere in `apps/server/src`. Do not add one to debug — use a test in
`ws/room.test.ts`, which can observe the whole message stream.

---

## Why the request log is off

Every interesting request in this app is an answer-adjacent one. A default Fastify request
log would write clip URLs — which contain one-shot tokens — and solo session ids to disk,
in build order, on a box that may be behind someone else's reverse proxy. The access log is
also the reverse proxy's job in the deployment described in `DEPLOY.md`.

If you need request logging for an incident, turn it on locally and turn it off again in
the same session. Do not commit `logger: true`.

---

## What must never be printed

- **`sliceId`, clip tokens, `resumeToken`.** Each one is a credential or a direct step
  toward the slice ↔ song table. See
  [Secrecy and Anti-Cheat](./secrecy-and-anticheat.md).
- **The current round's song, title or `Reading`.** Anything that reveals the answer before
  `roundReveal` does.
- **Anything from `manifest.private.json`** — durations, neighbour lists, loudness.
- **Player nicknames** beyond what is needed, and never alongside an IP.

Room codes and `PlayerId` (`'A'`/`'B'`) are safe and are the right identifiers if you need
to correlate something.

---

## If real logging becomes necessary

Do it as an explicit, opt-in module rather than by enabling Fastify's logger:

- gate it behind an env flag parsed in `config.ts` (follow the existing `bool()` / `num()`
  helpers);
- log events, not payloads — `room CODE round 7 resolved winner=A` rather than the message
  objects;
- keep it out of `ws/timing.ts` and `ws/room.ts`'s hot path; those run per tap.

The startup lines in `index.ts` show the house format: `process.stdout.write` with a
trailing `\n`, two-space indentation, Chinese labels. Match it.

---

## Errors

There is no error log either. Failures reach the client as an HTTP status or a
`{ t: 'error', code }` frame, and startup failures crash the process with a message that
names the fix. An unhandled exception in a route becomes a Fastify `500`; if that ever
starts happening in practice, add an `onError` hook in `buildApp()` rather than scattering
`console.error` through the handlers.
