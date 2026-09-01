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
4. static mount for `/thumb/`
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

These roots are derived from `import.meta.url`, **not** from the process CWD. That is
deliberate and worth preserving: the server can be started from any working directory,
which is what lets the container set `WORKDIR` to `apps/server` (see below) without
breaking asset resolution.

---

## Running the server outside a dev checkout

Two things bite when this package is deployed rather than run from the repo root. Both
were found on a real VPS, not in review.

**`tsx` is a runtime dependency, not a dev dependency.** `@scg/shared` and
`@scg/game-core` declare `"exports": "./src/index.ts"` — they ship **raw TypeScript**. So
anything importing them needs a transpiling loader at runtime, and `"start": "tsx
src/index.ts"` is that loader. Keeping `tsx` under `devDependencies` means the first
`pnpm install --prod` produces a server that cannot boot.

**The CWD must be `apps/server`, because module resolution depends on it.** The entry
point is launched as `node --import tsx src/index.ts`. `tsx` there is a *bare specifier*,
which Node resolves starting from the CWD. pnpm does not hoist, so `tsx` lives in
`apps/server/node_modules` and there is no `node_modules` at the workspace root — running
from the repo root fails with `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`. Path
resolution is unaffected because of the `import.meta.url` rule above.

Launch `node` directly rather than going through `pnpm run` or the `tsx` bin wrapper:
`index.ts` installs `SIGINT`/`SIGTERM` handlers for graceful shutdown, and an intermediate
process can swallow the signal, hard-cutting matches in progress.

> A build that only *builds* the image proves none of this. The regression guard is a smoke
> test that actually starts the container against a two-song synthetic catalog and asserts
> `/api/health` — see `.github/workflows/release.yml`.
