# Directory Structure

> `packages/shared/src` — four files, and a hard rule about what may not join them.

---

## Layout

```
packages/shared/src/
  index.ts        export * from './difficulty.js'
                  export * from './scoring.js'
                  export * from './protocol.js'
  protocol.ts     wire types + zod clientMsgSchema + encode()
  difficulty.ts   DIFFICULTIES, DIFFICULTY_PRESETS, KARUTA_DEFAULTS, REPLAY_PAUSES_TIMER
  scoring.ts      SCORING, ScoreBreakdown
```

`index.ts` is a pure barrel — three `export *` lines and nothing else. Consumers always
import from the package root (`import { KARUTA_DEFAULTS } from '@scg/shared'`), never from
a deep path. The package has no `dist`; `main`/`types`/`exports` all point straight at
`./src/index.ts` and every consumer compiles the TypeScript itself.

---

## The `.js` extension on relative imports

Every relative import inside this repo's Node-side packages carries a `.js` extension even
though the file on disk is `.ts`:

```ts
export * from './difficulty.js'      // packages/shared/src/index.ts
import { cardsLeft } from './deal.js' // packages/game-core/src/karuta.ts
import { SERVER_CONFIG } from './config.js'  // apps/server/src/index.ts
```

This is required: the workspace is `"type": "module"` with `moduleResolution: "Bundler"`,
and `apps/server` runs the TypeScript directly through `tsx` at runtime. Dropping the
extension type-checks fine and then fails at run time. `apps/web` is the exception — Vite
resolves extensionless relative imports, and `apps/web/src` uses `from '../api'`,
`from './audio'` with no extension. Match the package you are in.

---

## What must never enter this package

`@scg/shared` has exactly one runtime dependency (`zod`) and must keep it that way.

- **No Node built-ins.** `apps/web` imports this package into the browser bundle. A single
  `import fs from 'node:fs'` anywhere reachable from `index.ts` breaks the web build.
- **No React, no DOM types.** Its `tsconfig.json` has no `lib: ["DOM"]`; a `HTMLElement`
  reference will not compile.
- **No game logic.** Rules live in `@scg/game-core`, which depends on this package and not
  the other way round. `packages/shared/src/scoring.ts` holds the *constants*;
  `packages/game-core/src/scoring.ts` holds the *function* that consumes them. That split
  is deliberate — keep new logic on the game-core side.
- **No display strings beyond the difficulty `label`.** Card titles, artist names and error
  copy come from the catalog or the caller.

---

## Adding a file here

Only when a new concern is genuinely shared by two or more packages. Add the `export *`
line to `index.ts` in the same commit — the barrel is the package's only public surface,
and a file that is not re-exported is invisible to every consumer.
