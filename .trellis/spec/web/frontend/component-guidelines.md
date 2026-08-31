# Component Guidelines

> Function components, no `React.FC`, no default exports except `App`. The interesting rules
> are all about the clip-path world the design system is built on.

---

## Component structure

Every component in `ui/` and `components/` follows the same order:

```tsx
import type { ... } from '@scg/shared'      // 1. type-only imports first
import { Icon } from '../ui/Icon'

export type OptionState = 'idle' | 'correct' | 'wrong' | 'dimmed'   // 2. exported unions

interface Props { ... }                      // 3. always named `Props`, not exported

const SLANT = 'calc(46 * var(--u))'          // 4. module constants: shapes, tone tables
const TONE: Record<CardState, {...}> = {...}

export function OptionBar({ option, index, state }: Props) { ... }  // 5. named export
```

- **`interface Props`** — local, never exported, destructured in the signature with defaults
  (`elevation = 'md'`, `className = ''`).
- **Extend a DOM props type when wrapping an element**, omitting what you control:
  `interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>`, then
  spread `{...rest}` onto the element. `Button` and `Field` both do this, which is why
  `disabled`, `onClick`, `autoFocus` and `aria-*` work without being declared.
- **A `state` prop drives appearance; the component makes no decisions.** `OptionState` and
  `CardState` are computed by the screen (`Play.tsx#stateOf`, `Karuta.tsx#cardStateFor`).
  Keep the mapping table (`TONE`) next to the component and the decision in the screen.
- **Variant maps are `Record<Variant, string>` constants**, not conditionals in JSX:
  `SIZE`, `MIN_H`, `SHAPE_CLASS`, `SHADOW_CLASS`, `TONE`, `POS`, `FLIP`.

---

## The two-layer rule for every clipped element

This is the most important structural rule in the package, and it is not optional:

```tsx
<span className="cut-shadow-sm">      {/* outer: shadow + focus ring */}
  <span className="cut-slant">        {/* inner: clip-path + fill */}
```

Both `filter: drop-shadow()` and `outline` are clipped away when they sit on the same
element as `clip-path`. The shadow loss is cosmetic; **the outline loss silently deletes the
keyboard focus ring**, which is an accessibility failure that no screenshot shows.

`index.css` lifts the ring to the wrapper:

```css
.cut-shadow:has(:focus-visible) { outline: 2px solid var(--color-accent-ink); outline-offset: 3px }
.cut-shadow :focus-visible      { outline: none }
```

So: **any new clipped interactive element must sit inside a `.cut-shadow*` wrapper.**
Prefer the `Cut` component (`ui/Cut.tsx`), which encodes the pattern with a `shape` and
`elevation` prop. `Button` and `Field` hand-roll the same two layers because they also need
the inner element to be a real `<button>` / `<input>`.

Note `Field`'s variation: the `<input>` itself is *not* clipped, because `clip-path` eats
the caret and the selection highlight at the edges. The shape comes from a clipped backing
`<span>` and the input sits transparently on top.

---

## A reserved band must be conditional on what fills it

`PrismRail` sizes itself to the spectrum bars' dynamic range (`112u`, `120u` in `mirror`),
but the rail line itself is `bottom: 0`. When a screen passes `spectrum={false}`, nothing
ever grows into that band, so the whole `112u` becomes empty space above the line —
measured at 139px on the Start hero, which is what made the hero read as pinned to the
top-left corner. The height is now conditional:

```ts
const span = mode === 'mirror' ? 'calc(120 * var(--u))' : spectrum ? undefined : '3px'
```

`mirror` stays out of the condition: the board's rail must sit on the field's geometric
midline, and its height is the precondition for being that line.

The spectrum branch resolves to `undefined` and the element takes the `.sc-rail-spectrum`
class instead (`88u` desktop / `112u` narrow). The component still owns *which* branch
applies — that is the semantic decision — but the branch's number belongs in CSS because it
is the largest non-content block in the play screen's vertical budget and has to differ per
breakpoint. Keep the trichotomy readable in the component; keep breakpoint-dependent
magnitudes out of it.

The general rule: **when a component reserves space for an optional child, the reservation
takes the same condition as the child.** An unconditional reservation is invisible in the
component's own tests and only shows up as a void on the screens that opted out.

---

## Two title components, opposite hierarchies

| | Top row | Bottom row | Used on |
|---|---|---|---|
| `SectionTitle` | small katakana | large Jost uppercase Latin (`h1`) | section headings |
| `HeroTitle` | small Jost uppercase Latin (`p`) | large Chinese title (`h1`) | page heroes |

Both draw the same four corner marks through the shared private `TitleBox`, so the shape
language does not fork. The hierarchies are deliberately inverted: a section heading is
labelled by the site's Latin voice, but a page hero has to answer *what is this site*, and
a Latin string cannot (`SONG GUESS` says neither 闪耀色彩 nor off-vocal). The Chinese line
carries that and is the page's only `h1`; the Latin drops to a brand mark.

`HeroTitle`'s `h1` uses `text-ink`, not `text-primary` — `#615f90` is a structural colour
that DESIGN.md explicitly bars from body text, and a page title is held to body contrast.

---

## Shape primitives

| Class | Shape | Used for |
|---|---|---|
| `.cut-slant` / `.cut-slant-r` | parallelogram, mirrored pair | buttons, tags, bars |
| `.cut-card` / `.cut-card-sm` | two opposite corners cut | content cards, modals |
| `.cut-hex` | hexagon | thumbnails, cover art |
| `.cut-bar` | pointed both ends | status bars |

Corner sizes come from `--cut-sm/md/lg`. Ad-hoc polygons are written inline as module
constants (`BAR_CLIP`, `CAP_CLIP`, `TILE_CLIP`) when a component needs a shape no primitive
covers — that is fine, but **count the vertices**: omitting the final `0 CUT` vertex turns a
corner cut into a full-height diagonal that silently slices anything hugging the left edge.
Both `KarutaTile` and the quality guide carry this warning because it has bitten twice.

---

## Icons: `ui/Icon` only, and never an icon library

Every icon in this project is a hand-drawn SVG on a 24 grid, `strokeWidth: 1.8`,
`strokeLinecap="square"`, `strokeLinejoin="miter"`. The square caps are not incidental — they
are the icon-scale expression of a world where `border-radius` appears zero times.

**Do not add Lucide, Font Awesome, Heroicons, or any other icon package.** They all ship round
caps and round joins (Lucide's default is `strokeLinecap="round"`), so a single imported icon
puts two different pen strokes on one screen. That reads worse than being one icon short, and
it cannot be fixed by overriding `strokeLinecap`: the paths themselves are drawn for round ends.

Need a shape `Icon` does not have? Redraw it on the 24 grid and add it to `PATHS`. Using an
icon library as a **shape reference** is fine and encouraged — copying its markup is not.

Two conventions the existing set already follows:

- **Off-states change the glyph, not just the colour.** `volume` → `mute` swaps the sound waves
  for a cross; `music` → `music-off` adds a full-width slash. Colour alone fails for anyone who
  cannot distinguish it, and `aria-pressed` is not visible.
- **Pick the negation mark by what fits.** `mute` uses a cross because the speaker body only
  occupies the left half, leaving room beside it. `music` fills the whole grid, so a cross would
  land on top of the stems and turn to mush — that one takes a slash across the glyph instead.

Circles inside an icon (`replay`'s arc, `music`'s note heads) are fine. The no-radius rule
governs **surfaces** in the layout, not forms drawn inside a 24px glyph.

---

## Styling: Tailwind for layout, inline `style` for design tokens

The consistent split across the codebase:

- **`className`** — flex/grid, spacing, text size, color utilities that map to theme tokens
  (`text-ink-sub`, `text-correct`), state variants (`enabled:hover:-translate-y-px`).
- **`style={{ ... }}`** — anything computed from `--u`, gradients, `clipPath`, `boxShadow`,
  `letterSpacing`, `animationDelay`.

`style={{ width: 'calc(58 * var(--u))' }}` rather than an arbitrary Tailwind value, because
these sizes are design-canvas pixels and reading them as such matters more than staying in
one syntax.

Three traps:

- **Two utilities that set the same property.** `class="line-clamp-2 block"` — `line-clamp`
  works via `display: -webkit-box`, `block` wins, the clamp silently does nothing and a long
  title blows the element's height.
- **`--u` has no floor.** Touch targets and hairlines use real px:
  `minHeight: 'max(44px, calc(62 * var(--u)))'`, borders always `1px`. `Button`'s `MIN_H`
  carries the comment explaining that `sm` at 32px passed WCAG 2.5.8 (24px) and failed
  2.5.5 (44px).
- **A component class that must beat a Tailwind utility cannot be a utility.** See
  `.sc-panelrow` in `index.css`.

---

## Accessibility baseline

Non-negotiable, and each item is here because its absence broke something real:

- **Every clipped interactive element inside a `.cut-shadow*` wrapper** — otherwise no focus
  ring.
- **Text-only buttons get `.tap-line`** — grows the box to 44px without moving the text.
  Do not use `::after` to enlarge a hit area; these buttons usually sit inside a clip-path
  container that would clip the pseudo-element away.
- **Overlays are real modals.** `role="dialog"`, `aria-modal="true"`, an accessible `label`,
  focus moved in on mount, Tab trapped. `ui/Overlay.tsx` does all of it — use it rather than
  a fixed `div`. The board behind gets `inert`; without it, 24 invisible card buttons stay
  in the tab order behind a 90%-opaque sheet.
- **Anything the player learns by watching text change needs `role="status"` +
  `aria-live="polite"`** — round narration, answer reveal, reconnect toast, rematch votes,
  lobby connection line. Missing these does not degrade the screen-reader experience, it
  deletes the game's feedback loop.
- **Decorative elements get `aria-hidden`** — colour caps, corner marks, the prism rail's
  bars. Meaningful icons get `role="img"` and an `aria-label` (`正确答案`,
  `你选的，答错了`).
- **A whole-screen click target still needs a real focusable button inside it.** `onClick`
  on a `div` is mouse-only.
- **Colour is never the only signal.** 決まり字 is marked with weight and lightness, not a
  second hue; correct/wrong carry an icon as well as a tint.

---

## Colour rules that are easy to get wrong

The bright brand colours are **surface** colours. On white, `#5ee2ff` (2.4:1),
`#e2669b` (3.2:1) and `#a2a2c0` (2.5:1) all fail as text. Text uses the deepened
companions — `--color-accent-ink`, `--color-rose-ink`, `--color-ink-faint`. The reverse
case is the one that got missed once: on the dark brand gradient, `--color-accent` measures
3.9:1, so accent text there uses `--color-accent-lit`.

Before shipping a new tinted panel, compute the composite (`token × alpha` over
`--color-ground`) and check the text against **that**, not against white. Full measured
table in [Quality Guidelines](./quality-guidelines.md).

The 8 unit colours are **data**, not tokens: a solid cap, an edge strip, a thumbnail ring —
never text. Give every solid cap an `inset 0 0 0 1px rgb(0 0 0 / .1)` so pale units still
read, and fall back to `--color-primary` (not `--color-primary-lt`) when a song has no unit.

---

## Motion

Entrance is `.anim-appear` (blur → sharp), staggered with
`style={{ animationDelay: `${index * 60}ms` }}`. Error feedback is `.anim-shudder`.

`prefers-reduced-motion` disables `.anim-*` and collapses transitions — handled globally in
`index.css`, so no component needs its own media query. But note what stays on: the
countdown retraction and the rail creases are **information**, not decoration, and must
never be animated away.

Never put a `transition` on an animated `clip-path` that is locked to the audio clock —
a transition is an interpolation, and the point of the prism rail is that it is not
interpolated.
