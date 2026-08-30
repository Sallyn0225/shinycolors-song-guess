# Quality Guidelines

> 49 tests in two files, at two very different levels. Both build a real app; neither mocks
> the catalog.

---

## Verification

```bash
pnpm --filter @scg/server test        # vitest run — 49 tests
pnpm --filter @scg/server typecheck   # tsc --noEmit
pnpm -r test && pnpm -r typecheck     # before reporting done
```

The tests require built assets: `Catalog.load()` reads `assets/manifest.*.json`, and
`app.test.ts` asserts `/api/health` reports **234** songs. If the catalog is missing, run
`pnpm assets all` first — a failure here is an environment problem, not a code problem.

There is no `vitest.config.ts`; vitest runs on defaults and collects `src/**/*.test.ts`.
Tests sit beside the code (`app.ts` / `app.test.ts`, `ws/room.ts` / `ws/room.test.ts`).

---

## `app.test.ts` — routes via `app.inject()`

```ts
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close() })
```

No port, no HTTP client. Local helpers (`newSession()`, `question()`) wrap the inject calls
and assert `statusCode` inline, so individual tests read as game steps rather than as HTTP.
Follow that: a new route gets a helper if it is used more than twice.

The suite pins cross-package agreement — `/api/difficulties` is asserted equal to
`DIFFICULTY_PRESETS` from `@scg/shared`. Keep adding that kind of assertion for any endpoint
that merely reflects shared constants; it is the cheapest way to catch a drifting contract.

---

## `ws/room.test.ts` — a real socket against a real listener

```ts
await app.listen({ port: 0, host: '127.0.0.1' })   // port 0 → OS picks a free one
```

This one binds a port because `@fastify/websocket` cannot be exercised through `inject`.
`beforeAll` carries a 30s timeout for exactly that reason.

The `TestClient` helper at the top of the file is the thing to read before writing a new
realtime test. Its design encodes two hard-won points:

- **It buffers every message** (`received: ServerMsg[]`) and `wait(t)` checks the buffer
  before subscribing. A test that only listens forward will miss messages that arrived
  during the previous `await`.
- **It auto-answers `roundReveal`** with `candidates.slice(0, count)` — the same card the
  server's automatic fallback would pick. That keeps existing expectations unchanged while
  avoiding a real 10-second 送り札 wait in every round. `autoOkuri = false` switches it off
  to test the timeout fallback specifically, and `pickOkuri` overrides the choice.

When you add a phase with a timeout, add both: a test that answers, and a test that does
not.

---

## What a change here needs before it is done

1. **Both players' perspective.** `MatchView.you` differs per recipient; a bug that only
   affects player B is invisible if the test only inspects A.
2. **The disconnected path.** Nearly every rule in `room.ts` has an `online.every(...)`
   variant. Assert that a match still progresses with one seat detached.
3. **The stale-message path.** Taps and `okuri` for the wrong `roundNo` must be dropped
   silently, not error.
4. **No leak.** If you added a field to a broadcast, check it against
   [Secrecy and Anti-Cheat](./secrecy-and-anticheat.md).

---

## Reviewing a change here

- Does every new phase have a server timer that fires without the client?
- Was `clearTimers()` called before the phase transition, and is the new transition
  re-entrancy-guarded? Both timer and message can reach it.
- Did you use `broadcast` where the message contains a `MatchView`? It must be
  `broadcastMatch`.
- Does a new `setInterval` call `.unref?.()`?
- Did a route start returning a `CatalogSong` directly instead of going through
  `optionView()`?
- Is a new empty `catch {}` annotated with why?

---

## Manual checks the tests do not cover

`DEPLOY.md` describes the production shape; `PROGRESS.md` records current status and the
known gaps. Two things only a real run catches:

- **Serving the web build from this process.** `SERVER_CONFIG.webRoot` is auto-detected, so
  the SPA fallback and `index.html` caching only get exercised after
  `pnpm --filter @scg/web build`.
- **Behaviour behind a reverse proxy** — `TRUST_PROXY`, the 90s `keepAliveTimeout` (which
  must exceed nginx's 75s default), and whether protocol-level pings survive the proxy.
