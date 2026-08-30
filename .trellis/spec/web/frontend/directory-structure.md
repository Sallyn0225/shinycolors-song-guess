# Directory Structure

> Four tiers under `src/`, ordered by how much they know about the game. A file's tier
> decides what it may import.

---

## The tiers

| Tier | Knows about | May import |
|---|---|---|
| `ui/` | nothing — shapes, elevation, focus, motion | `@scg/shared` types, other `ui/` |
| `components/` | one game object (an option, a card) | `ui/`, `@scg/shared` types |
| `features/` | game logic, **no React** | `@scg/shared` types only |
| `screens/` | a whole screen: state, effects, orchestration | everything |

Plus three singletons that sit outside the tiers — `api.ts`, `audio.ts`, `net/ws.ts` — and
`index.css`, which owns every token and shape primitive.

`App.tsx` is the router: a `Screen` discriminated union in `useState`, no routing library,
no URL. The game is a single session with no linkable states, so a router would add a
dependency and a class of bug (deep-linking into a match that no longer exists) for nothing.

---

## `features/` is where testable logic goes

```
features/kimariji.ts      computeKimariji(titles) → Map<title, prefixLength>
features/karutaBoard.ts   class SlotMap — stable card positions
features/narrate.ts       narrateRound(result, names, me) → { headline, detail, tone }
```

These are pure functions and one plain class. They import no React and touch no DOM, which
is exactly why the package's 21 tests live here (`karutaBoard.test.ts`, `narrate.test.ts`).

**If a piece of screen logic is worth testing, move it here first.** `narrate.ts` is the
proof: round narration has 11 distinct cases (空札 / field card × nobody / one / both
tapped, and within "both" the correct/wrong/tie/too-early splits). As inline JSX
conditionals that is untestable; as a function returning a `Narration` it has a test per
case.

`SlotMap` is a mutable class held in a `useRef`, not state — see
[State Management](./state-management.md).

---

## `ui/` vs `components/`

`ui/` primitives are reusable and game-agnostic. `Cut`, `Button`, `Field`, `Overlay`,
`SectionTitle`, `Stat`, `Icon`, `Backdrop`, `PrismRail`. If it would still make sense in a
different app built on the same design language, it belongs here.

`components/` holds the two things that only exist in this game: `OptionBar` (a quiz answer)
and `KarutaTile` (a card on the board). Both are stateless — they take a `state` prop
(`OptionState`, `CardState`) and render it. All decisions about *which* state applies are
made by the screen.

That split is what keeps `Karuta.tsx` legible despite being 1000 lines: the tile does not
know what 送り札 means, it knows `'sendable'`.

---

## Where a new file goes

| You are adding… | Put it in |
|---|---|
| a shape/interaction primitive with no game knowledge | `ui/` |
| a rendering of one game object | `components/` |
| a computation you want a test for | `features/` |
| canvas/image rendering | split it — see below |
| a screen, or state that spans one screen | `screens/` |
| a network call | `api.ts` (REST) or a message in `net/ws.ts` |
| a token, shape, breakpoint-specific size, or animation | `index.css` |

### Canvas rendering splits across two tiers

`CanvasRenderingContext2D` is DOM, so a `draw(ctx, data)` that knows the game fits no tier:
`features/` may not touch DOM, `ui/` may not know the game. The share-report ticket resolves
this by making the layout a value:

```
features/shareCard.ts    结算数据 → DrawOp[]（纯数据的显示列表）   tested
ui/ticketPainter.ts      DrawOp[] → ctx                          DOM, zero game knowledge
```

The payoff is not tier compliance, it is testability. Layout maths — truncation, alignment,
overflow, per-row caps — is where this kind of feature actually breaks, and as a `DrawOp[]`
it is an ordinary array assertion in vitest with no canvas and no browser.

Text width is the one thing layout cannot compute alone. Inject it rather than importing it:

```ts
export type Measure = (text: string, font: string) => number
export function buildSoloTicket(input: SoloReportInput, m: Measure): DrawOp[]
```

Production passes `ctx.measureText`; tests pass a fixed-width fake, which is what makes
"truncates after the 4th character at 50px" a writable assertion.

`features/` may only import `@scg/shared`, so a builder that needs `Summary` (which lives in
`api.ts`) declares its **own** structurally-compatible input type. Screens then pass the
`Summary` straight in — TypeScript's structural typing accepts it, and no mapping code or
cross-tier import is needed.

---

Do not create `hooks/`, `utils/`, or `contexts/`. There is no shared custom hook in this
codebase and no context provider; screens hold their own state and the three singletons are
imported directly. Adding those directories would be inventing a structure the code does
not use.

---

## Import style

`apps/web` omits extensions on relative imports (`from '../api'`, `from './audio'`) —
Vite resolves them. This differs from every Node-side package in the repo, which requires
`.js`. Match the package you are in.

Cross-package imports use the workspace name: `import type { MatchView } from '@scg/shared'`.
`@scg/web` depends on `@scg/shared` only — never on `@scg/game-core`. The rules run on the
server; the client renders what it is told. Importing game-core here would put the rules in
the bundle and invite the client to disagree with the server.

---

## `index.css` is one file on purpose

528 lines, in `@theme` / `@layer base` / `@layer components` / `@layer utilities` order.
Tailwind v4 is configured entirely in CSS — there is no `tailwind.config.js`.

Every custom class is prefixed by intent: `.cut-*` (clip-path shapes), `.cut-shadow*`
(the wrapper that carries shadow and focus ring), `.glass` / `.glass-lit`, `.sc-*`
(project-specific sizing with a 767px breakpoint step-down), `.anim-*`, `.tap-line`,
`.jp-wrap`, `.latin`, `.tnum`.

Layer order matters and has already caused a bug: `.sc-panelrow` is written in
`@layer components`, and its comment records that Tailwind utilities sit in a later layer
and would override `position`/`align-items`. When a component class must win over a
utility, it cannot be a utility.
