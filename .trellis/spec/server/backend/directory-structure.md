# Directory Structure

> Flat `src/`, with one `ws/` subdirectory for the realtime layer. Two files deep, no more.

---

## Layout and dependency direction

```
index.ts ─────► app.ts ─────► catalog.ts ─────► @scg/game-core (SoloSong)
                  │  │  │
                  │  │  └──► config.ts ──► catalog.ts (REPO_ROOT only)
                  │  └─────► soloSessions.ts ──► @scg/game-core, @scg/shared
                  └────────► ws/hub.ts ──► ws/room.ts ──► ws/timing.ts
                                                    └──► @scg/game-core, @scg/shared
```

Nothing under `ws/` is imported by the HTTP routes except `hub` itself, and `hub` exposes
exactly two things to `app.ts`: `roomByCode()` (for the per-room clip route) and
`dispose()` (wired to Fastify's `onClose`). Keep that surface small.

Relative imports carry a `.js` extension — the server runs its TypeScript directly through
`tsx`, so an extensionless import type-checks and then fails at run time.

---

## `buildApp()` is the composition root

`apps/server/src/app.ts` is the only place that knows the full wiring, and it is ordered
deliberately:

1. `Fastify({ logger: false, trustProxy })`
2. the empty-body JSON content-type parser
3. `Catalog.load()` and `new SoloSessionStore(catalog)`
4. static mounts for `/cover/` and `/thumb/`
5. `new Hub(catalog)`, `fastifyWebsocket`, the `/ws` route
6. the room clip route, `onClose`, `/api/health`
7. **the optional web root and the SPA `setNotFoundHandler`**
8. the remaining `/api/...` routes

Step 7 sits where it does because `setNotFoundHandler` catches everything that did not
match; routes registered after it still work (Fastify resolves routes before the not-found
handler), but the handler itself must special-case `/api/` prefixes so a bad API path
returns JSON `404` instead of `index.html`. If you add a non-`/api` route namespace, extend
that check.

`index.ts` contains no routing. It sets `keepAliveTimeout`/`headersTimeout`, listens,
prints three lines, and installs SIGINT/SIGTERM handlers. Keep it that way — the tests build
apps without ever going through it.

---

## Where new code goes

| Adding… | File |
|---|---|
| an HTTP endpoint | `app.ts` — routes are declared inline, not in a router module |
| single-player session state | `soloSessions.ts` |
| a client→server WebSocket message | `ws/hub.ts` `switch`, then a method on `Room` |
| per-room match behaviour, timers, broadcasts | `ws/room.ts` |
| anything about trusting a client's clock | `ws/timing.ts` |
| catalog-derived data shape | `catalog.ts` |
| an env-tunable value | `config.ts` |

`app.ts` is ~320 lines with all routes inline and that is the local convention — routes are
short and read top-to-bottom next to the schema they validate. Do not introduce a
`routes/` directory for one new endpoint.

---

## Path resolution

`catalog.ts` defines the two roots everything else uses:

```ts
const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '..', '..', '..')
export const ASSETS_ROOT = path.join(REPO_ROOT, 'assets')
```

Import these rather than recomputing. `config.ts` imports `REPO_ROOT` from `catalog.ts`
(not the other way round) to find the optional web build — that import direction is load
bearing, since `catalog.ts` must not depend on config.

Note the `..` count is tied to the file's depth. Anything that moves `catalog.ts` into a
subdirectory has to fix it, and nothing will fail until the catalog fails to load at
startup.
