# Quality Guidelines

> Frontend quality rules for `apps/web`. Everything here was learned by getting it wrong first.

---

## Layer boundary: never touch the non-UI modules

These files encode production-only bugfixes documented in `PROGRESS.md`. They must not be
edited as a side effect of UI work:

```
src/audio.ts        AudioContext gesture gate, getOutputTimestamp() over currentTime,
                    precise scheduling, spectrum, AAC fallback
src/net/ws.ts       clock sync, sessionStorage seat token, idempotent connect(),
                    multicast status subscription
src/api.ts          question/begin split, one-shot clip token
src/features/*      kimariji, stable slot map, round narration (+ 21 tests)
```

Verify after any UI change:

```bash
cd apps/web && git diff --exit-code -- src/api.ts src/audio.ts src/net src/features
```

If a signature genuinely blocks you, stop and record it in the task's `prd.md`. Do not edit in passing.

---

## `clip-path` — three traps, all of which fail silently

The visual world is built entirely on diagonal `clip-path` cuts. Three things break in ways
that look like something else entirely.

### 1. A missing closing vertex turns a corner cut into a full-height diagonal

```css
/* WRONG — the polygon closes from (0,100%) straight back to (CUT,0),
   so the left edge is one long diagonal, not a clipped corner.
   Anything hugging the left edge (a unit-colour strip) gets sliced down to a triangle. */
polygon(CUT 0, 100% 0, 100% calc(100% - CUT), calc(100% - CUT) 100%, 0 100%)

/* RIGHT */
polygon(CUT 0, 100% 0, 100% calc(100% - CUT), calc(100% - CUT) 100%, 0 100%, 0 CUT)
```

A full-height slant is a legitimate shape (the option bars use one on purpose). The bug is
writing one when you meant a corner cut. Decide which you want and count the vertices.

### 2. `filter: drop-shadow()` on the same element gets clipped away

Shadow goes on the **parent**, clip goes on the **child**. `ui/Cut.tsx` and the
`.cut-shadow*` classes exist for exactly this; use them rather than hand-rolling.

### 3. `outline` gets clipped away too — which silently kills the focus ring

`:focus-visible` drawn on a clipped element is invisible. The ring is lifted to the wrapper:

```css
.cut-shadow:has(:focus-visible) { outline: 2px solid var(--color-accent-deep); outline-offset: 3px; }
.cut-shadow :focus-visible      { outline: none; }
```

Any new clipped interactive element must sit inside a `.cut-shadow*` wrapper, or it ships
with no keyboard focus indicator.

---

## Fixed background layers must be `z-index: -1`, never `0`

Per the CSS painting order, a `position: fixed; z-index: 0` element paints **after** the
inline content of non-positioned elements. An opaque backdrop at `z-index: 0` therefore
covers plain headings and plain buttons, while anything wrapped in a `filter` or positioned
element survives.

The symptom is maximally misleading: cards render fine, headings and text buttons vanish,
and the DOM inspector shows correct text with a correct colour. `#root` carries
`z-index: 1`, so a negative value stays inside the app.

---

## Sizing: the `--u` design unit

The reference site uses only `vw` with a single 767px breakpoint (PC canvas 1440, SP canvas 375).
Copying that verbatim makes everything enormous on a 2560px display, so `--u` is clamped at
both ends and equals exactly `1px` at 1440.

Tailwind's spacing base is wired to it (`--spacing: calc(4 * var(--u))`), so the whole
spacing and type scale follows the viewport for free.

**Do not put these through `--u`:**

- **touch targets** — `min-height` uses real `px` (`max(60px, calc(108 * var(--u)))`);
  under the low clamp a `--u`-derived height drops below 44px
- **hairlines** — always `1px`
- Long Japanese titles and wide-tracked Latin headings need their own step-down under 767px;
  see the `.sc-title` / `.sc-song` / `.sc-figure` block in `index.css`.

---

## Timing UI: rAF writing DOM, never per-frame `setState`

React 18's concurrent scheduler batches per-frame `setState`; the symptom is a countdown
that "sometimes doesn't respond". `ui/PrismRail.tsx` runs one rAF loop and writes
`style.clipPath`, canvas pixels and `textContent` directly.

Two rules that are not style preferences:

- **no `transition` on the animated `clip-path`** — a transition is an interpolation, and the
  band's whole point is that it is locked to the audio clock
- **the time mapping is linear** — no easing

`prefers-reduced-motion` switches off entrance/shudder/halo animations, but **not** the
countdown retraction or the creases: those are information, not decoration.

---

## Audio visualisation: measure the data before choosing constants

The spectrum in `PrismRail` took six wrong versions. Both root causes generalise.

### Never infer gain from the data you are drawing

Every "compute the gain from the current data" scheme is a feedback loop, and each one
walked away on its own:

| approach | measured result |
|---|---|
| normalise by the frame peak, floor at the frame median | hard-switches between left-heavy and right-heavy; no stable middle |
| normalise each bar by its own recent average | every bar parks on its own average — CV collapsed to **0.05**, a wall of equal-height bars |
| multiply by a guessed exponential tilt | when the slope disagrees with the real profile, a global knee must either clip the left or spare the right |

What works is static and inspectable: log-frequency sampling → divide by a **measured**
static profile → take the knee as a fraction of the current frame's tallest bar. The last
step adapts across songs (loudness and spectral shape differ per track) but is frame-global,
not per-band, so it cannot invert the left/right balance.

### Measure the range instead of assuming it

`AnalyserNode`'s `minDecibels −100` / `maxDecibels −30` compress a loud mix into
**0.44–1.0** after `getByteFrequencyData` normalisation — the whole useful range sits in the
top half. Knees were set at 0.12 and then 0.36; both are *below the data*, so both produced
a saturated wall, and both looked like a shaping problem rather than a range problem.

The way out: temporarily replace the mapping with identity, sample **at each bar's centre**
(sampling every pixel column counts the ~54% gaps between bars as zeros and drags the mean
down by half), and read the real distribution. Choose constants from that, then invert the
formula from a rendered measurement to check.

### Verify a timing-dependent visual with numbers, not screenshots

The answering window is 8–15s and the MCP round trip is seconds, so screenshots land in the
wrong state more often than not — one measured "CV 2.46" turned out to be cover art and
the 不正解 label, captured after `audio.stop()`. Measure inside the page in a single call
(wait, sample, reduce) and assert the state (`h1` reads LISTENING, a 重听 button exists)
before trusting any capture.

## Colour: check contrast against the surface the text actually lands on

The trap that caught this project twice: tokens were tuned against `--color-ground`, then
used as text on **tinted surfaces built from the same token**. Six pairings that looked fine
on white measured 3.7–4.1:1 in place — including the disconnect banner, which is the one
telling a player their opponent has vanished and a forfeit clock is running.

The judgement colours are therefore chosen against their **worst** surface, not against white:

| surface | how it is built | text | ratio |
|---|---|---|---|
| white | — | `--color-correct` `#0a6b50` | 6.50:1 |
| 18% green tint | `rgb(10 107 80 / .18)` over ground | `--color-correct` | 4.74:1 |
| white | — | `--color-wrong` `#b3123a` | 6.85:1 |
| 16% rose tint | `rgb(179 18 58 / .16)` over ground | `--color-wrong` | 4.93:1 |

Before shipping any new tinted panel, compute the composite (`token × alpha` over
`--color-ground`) and test the text against **that**, not against white. `--color-ink-faint`
in particular passes on white (4.95:1) and fails on a 12% rose panel (3.86:1) — on tinted
surfaces step up to `--color-ink-sub`.

## Colour: the bright brand colours are surface colours, not text colours

On the white ground, `#5ee2ff` (2.4:1), `#e2669b` (3.2:1) and `#a2a2c0` (2.5:1) all fail as
text. Text uses the deepened companions: `--color-accent-ink`, `--color-rose-ink`,
`--color-ink-faint` (4.95:1). Body copy is never `--color-primary`.

The 8 unit colours are **data**, not tokens. They may be a solid cap, an edge segment, or a
thumbnail ring — never text on white (`#fff68d` disappears). Give every solid cap a
`inset 0 0 0 1px rgb(0 0 0 / .1)` so the pale units still read, and fall back to
`--color-primary` (not `--color-primary-lt`) when a song has no unit.

---

## Tailwind gotcha: co-listed utilities of the same property

`line-clamp-2` works by setting `display: -webkit-box`. Writing
`class="line-clamp-2 block"` lets `block` win and the clamp silently does nothing —
long titles then blow the element's height and push content below the fold.
Same trap for any two utilities that set one property.

---

## Overlays are modals, and modals are more than a fixed div

Every full-screen overlay (`ui/Overlay.tsx`, the karuta settlement) carries
`role="dialog"` + `aria-modal="true"` + an accessible name, moves focus in on mount, and
traps Tab. The board behind gets the `inert` attribute while any overlay is open — without
it the 24 card buttons stay in the tab order behind a 90%-opaque sheet, and a keyboard user
walks through two dozen invisible buttons to reach the two live actions.

A whole-screen click target (the audio-unlock overlay) still needs a real focusable button
inside it; `onClick` on a `div` is mouse-only.

## Live regions: the 1v1 feedback loop is invisible without them

Every outcome the player learns by watching text change needs `role="status"` +
`aria-live="polite"`: the round narration (空札 / お手つき / who took the card), the
answer reveal, the reconnect toast, the rematch vote line, the lobby connection line.
Missing these does not degrade the screen-reader experience — it deletes the game's entire
feedback loop for those users.

## Verification before reporting done

```bash
pnpm --filter @scg/web typecheck
pnpm --filter @scg/web test        # 21 tests, none of them may be edited
pnpm --filter @scg/web build
```

Plus, by hand: keyboard-only run (`1`–`4` / `R` / `Enter`), reduced-motion, Tab through every
screen checking the focus ring survives the clip, and both 1536×1024 and 390×844.

### Capturing evidence at an exact viewport

Two capture traps, both of which silently produce screenshots at the wrong size and
therefore hide real defects (the karuta board passes at 500px and fails at 390px):

- `resize_page` sizes the browser **window**, not the layout viewport — the window chrome
  eats ~75px of height and ~110px of width.
- `emulate` with a mobile/touch profile (`390x844x3,mobile,touch`) applies a page scale:
  `visualViewport` reads 390×844 while the **layout** viewport stays 470×1018, so media
  queries and `vw` still resolve at the wrong width.

What works: `emulate` with a plain `WxHx1` and no mobile flag. It is cleared by every
navigation, so the sequence is emulate → navigate → re-emulate → assert
`innerWidth`/`innerHeight` from inside the page → capture → `ffprobe` the file. Also prefer
viewport captures over full-page ones for size-critical evidence: a full-page capture loses
~10px to the scrollbar.
