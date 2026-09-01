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

### What "record it" actually looks like

This has happened once, for the opening greeting and ambient BGM. Both must sit on the **same
`AudioContext`** as the quiz audio (browsers cap the number of contexts, a second one needs its
own gesture to unlock, and two contexts do not share a `currentTime`, so a crossfade scheduled
against one drifts against the other) while bypassing **both** of the nodes the quiz path uses:

- through `master` → the volume slider would control them, but their levels are fixed
- through `analyser` → `PrismRail`'s spectrum would follow the BGM instead of the question

No existing method expresses "same context, different chain", so `audio.ts` gained exactly one
read-only getter returning `{ ctx, out: ctx.destination }`. The entry in `prd.md` named the
blocker, the proposed signature, why it is additive, and the three rejected alternatives.

Two rules generalise from it:

- **Additive only.** A getter that hands back an existing object changes no scheduling,
  no latency compensation, no fallback path. `git diff -- src/audio.ts` showed `17 insertions,
  0 deletions` — if a deletion appears, the change is no longer additive and needs re-thinking.
- **No subscription mechanism in the forbidden module.** The bypass chains must follow the
  mute toggle, but `audio.ts` did not grow an observer for it. Instead the two call sites that
  already change mute (`main.tsx` on load, `VolumeControl.commit()`) call `ambience.setMuted()`
  **and** `sfx.setMuted()` explicitly — every consumer of `audio.bypass` must be synchronised
  at both call sites; adding a third bypass consumer means adding a third call at each site.
  Two visible call sites beat an implicit subscription inside a module nobody may edit.

---

## `clip-path` — four traps, all of which fail silently

The visual world is built entirely on diagonal `clip-path` cuts. Four things break in ways
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

**`mask-image` does exactly the same thing, and hides it better.** A mask's painting area is
the border-box by default, so an `outline` — which is drawn *outside* the border-box — lands
outside the mask and is composited to nothing. The tell that makes this worse than the
`clip-path` version: every programmatic check still passes.

```js
getComputedStyle(el).outline      // "rgb(0, 119, 168) solid 2px"   ← present
el.matches(':focus-visible')      // true                           ← matching
// and the screenshot shows no ring at all
```

The result-page scroll area (`.sc-resultlist`, faded top and bottom with `mask-image`) was
written as a single focusable layer and passed both assertions above; only the screenshot
showed the ring was gone. The fix is the same shape as the `clip-path` one — lift the ring to
a wrapper that carries no mask:

```css
.sc-resultlist-frame:has(:focus-visible) { outline: 2px solid var(--color-accent-ink); outline-offset: 3px }
.sc-resultlist:focus-visible            { outline: none }
```

Generalised: **any focusable element carrying `mask-*` needs its focus ring on an unmasked
ancestor**, and this class of defect cannot be caught by asserting computed styles — it needs
a rendered capture.

### 4. `inset box-shadow` draws a *rectangle's* border, so a clipped element gets a broken one

This is the one that ships and survives review, because at a glance it reads as "there is a
border". On a 44px `.cut-slant` field (`--cut-sm` ≈ 9.4px), measured off a screenshot:

| Where | What actually rendered |
|---|---|
| top edge | starts at x ≈ 9.4 — the corner before the cut has nothing |
| the diagonal | **34px of it with no border at all**; nothing draws that edge |
| left edge | clipped down to a ~7px stub at the bottom-left, at a right angle to the shape |

The stub is what people notice and report. The missing diagonal is the actual defect.

Use `.cut-ring` + a shape variant instead (`index.css`):

```tsx
<span className="glass-lit cut-slant relative">
  <span aria-hidden className="cut-ring cut-ring-slant"
        style={{ '--ring': '1.5px', '--ring-color': 'var(--color-primary)' }} />
</span>
```

Three things about that CSS are load-bearing, and each was arrived at by breaking it:

- **The middle is punched out with `evenodd`, not filled.** A solid shape behind the glass
  tints the whole surface by `1 - alpha` of the stroke colour (12% at `surface-lit`).
- **The outer contour bleeds 1px past the element.** The ring sits *inside* the clipped
  element (so hover transforms and `peer-*` selectors still work), which means the diagonal
  would be antialiased twice — 50% × 50% = 25% coverage, and the diagonal renders visibly
  paler than the horizontal edges. Bleeding past the parent's edge leaves one AA pass.
- **The contour returns to its start before the seam, and the inner ring is traversed in
  reverse.** Skip either and exactly one edge disappears while the other three look fine:
  inner traversed forwards → the closing segment crosses the top band and **the whole top
  border vanishes**; inner reached without closing the outer first → **the diagonal vanishes**.

Same root cause, different symptom: a hollow diamond built from an `inset` shadow (the
`Presence` dot) renders as four disconnected specks — it reads as a spinner. Build hollow
shapes from two stacked solid clipped elements instead (`ui/Presence.tsx`).

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

The reference site uses only `vw` with a single 767px breakpoint (PC canvas 1440×900, SP canvas
375). Copying that verbatim makes everything enormous on a 2560px display, so `--u` is clamped at
both ends and equals exactly `1px` at 1440×900.

**The desktop rule is constrained by viewport height as well as width:**

```css
:root { --u: clamp(0.78px, min(0.0694444444vw, 0.1111111111vh), 1px); }
@media (max-width: 767px) { :root { --u: clamp(0.82px, 0.2666666667vw, 1.28px); } }
```

`vw/1440` and `vh/900` under `min()` is "fit the canvas into the viewport" — neither axis can
overflow. Width alone is not enough: on 16:9 displays the viewport gains far more width than
height, so a width-driven scale-up overflows vertically every time (1920×1080 measured
`doc 1150 > vp 990` on the solo play screen). The upper clamp is `1px`, not more: 1440 is the
1:1 reproduction point, and going past it means rendering larger than the canvas itself.

The narrow rule deliberately has **no `vh` term** — mobile browsers change `vh` when the URL bar
retracts, and type bound to it would jitter mid-scroll. The accepted desktop cost is that
resizing the window height rescales type; that is the existing horizontal semantics extended.

Tailwind's spacing base is wired to it (`--spacing: calc(4 * var(--u))`), so the whole
spacing and type scale follows the viewport for free.

**Do not put these through `--u`:**

- **touch targets** — `min-height` uses real `px` (`max(60px, calc(96 * var(--u)))`);
  under the low clamp a `--u`-derived height drops below 44px
- **hairlines** — always `1px`
- **the four smallest type steps** — `--text-2xs` / `--text-xs` / `--text-sm` / `--text-base`
  all carry real-px floors (11 / 12 / 12 / 13). The low clamp is routine on desktop now that
  `--u` watches height (1366×768 sits on it), and `--text-sm` carries body copy.
- Long Japanese titles and wide-tracked Latin headings need their own step-down under 767px;
  see the `.sc-title` / `.sc-song` / `.sc-figure` block in `index.css`.

**Page widths are tokens, not literals:** `--page-main` (900u), `--page-board` (1000u),
`--page-narrow` (760u), `--page-card` (520u). Screens set `maxWidth: 'var(--page-main)'`.

`--page-main` went 1300u → 1120u → 900u. The last step was driven by **horizontal scan
distance**, not by a gutter target: at 1120u the 1366 viewport gives an 874px column, and the
home screen's difficulty bar puts its name at the left end and its four stats at the right,
about 600px apart. Because the token is one value read by three screens, the whole change was
one line. DESIGN.md carries the measured before/after table; two facts from it are worth
keeping here:

- **A narrower column did not make anything taller.** `scrollHeight` on Start and Play was
  identical at 1120u and 900u on all four desktop viewports, because `.sc-bar` and
  `.sc-revealslot` are fixed-height and the blurbs still fit one line.
- **The column width is not the token's px value.** At 1440×810 `--u` is 0.9 (height-bound),
  so `900u` renders 810px. Compute gutters from a measurement, never from the literal.

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

## Layout: measure it, do not look at it

Screenshots show you that something is ugly. They do not show you that a title is 3px from
truncating, or that six cards sit 40px below the fold on a phone. `tools/ui-audit/probe.mjs`
drives a real 1v1 with two pages and reports the numbers. In the 2026-08-30 review it found
four of the six real defects; none of them were visible in a screenshot.

Three layout traps it caught, all of which generalise:

### An absolutely positioned grid child does not occupy a cell

The karuta field is `grid-template-rows: 1fr auto 1fr` so that the rail lands on the
**geometric midline** between the two territories. Making the panel `position: absolute`
took it out of cell assignment, and auto-placement promoted the rail into row 1 — the rail
silently stopped being on the midline while still looking plausible. Pin every child with an
explicit `grid-row`, and give an absolutely positioned one `grid-row: 1 / -1` so its
containing block is the whole grid rather than one row.

### `1fr auto 1fr` mirrors the tallest row into empty space

That is the price of the midline guarantee: a 130px panel in row 1 forces 130px of nothing
in row 3. At 390×844 the two territories take 333px each and only 108px is left — the
memorize panel inflated the field to 445px and pushed **all twelve** of the player's own
cards below the fold, during a stage where the 送り札 clock is 3 seconds. Before using this
pattern, budget the row against the smallest viewport; if it does not fit, float the panel
over the rail instead (which is also what removes the stage-to-stage jump).

### Sizes derived only from `--u` have no floor

Four separate failures from the same cause. `--text-2xs`/`--text-xs` at `10u`/`11u` drop to
7.8px/8.6px at the low clamp; `--text-sm`/`--text-base` at `13u`/`15u` drop to 10.1px/11.7px,
and `--text-sm` is what artist names and difficulty blurbs are set in. `Button` size `sm` at
`32px` clears WCAG 2.5.8 (24px) but not 2.5.5 (44px). A six-character room code at `0.3em`
tracking measures **1.016em per glyph** — `68u` renders it 431px wide inside a 340px container
and pushes the whole page 66px sideways.

The fixes are all "clamp against something real, not just the unit":

```css
--text-2xs: max(11px, calc(10 * var(--u)));   /* functional-text floor */
--text-xs:  max(12px, calc(11 * var(--u)));   /* body floor */
--text-sm:  max(12px, calc(13 * var(--u)));   /* body floor — artist names, blurbs */
--text-base: max(13px, calc(15 * var(--u)));
.sc-roomcode { font-size: min(calc(96 * var(--u)), 12.5vw); }  /* cap by viewport */
```

The `sm`/`base` floors were added when the desktop `--u` started watching viewport height:
that made the low clamp routine on ordinary laptops rather than a narrow-window edge case.
Tightening density must not become shrinking body copy out of legibility.

### Screen height is a budget; keep it constant

A screen the player acts on under a clock has to be measurable, not eyeballed. Two rules:

- **Never let content decide a repeated row's height.** `.sc-bar` and `.sc-revealslot` use
  `height`, not `min-height`, on desktop, so a long song title cannot make one question's page
  taller than the next one's. Narrow screens write `height: auto` back and keep `min-height`.
- **Center with `safe center`.** Plain `justify-content: center` splits overflow across *both*
  ends; the top of the page scrolls out of reach because scrollbars only travel downward.
  `.sc-vfit` uses `safe center`, which falls back to `flex-start` the moment content overflows.
- **A state transition that widens one column re-wraps its row-mates.** The solo reveal swaps
  the option bar's number glyph (~13px) for a 58u thumb; the title column loses ~45u and
  one-line titles wrap to two, so every bar grew 74 → 77.4px and answering → revealed pulsed
  the 375px page by 13px. A row's reserved height must cover the *worst state* of that row,
  not the current one: the narrow `.sc-bar` floor is 78u (content max = 22u·1.22·2 + 2u +
  14.5u·1.5 ≈ 77.4u), and the narrow `.sc-revealslot` floor is 64u (the 56u thumb is the tallest
  element once title and artist are single-lined by `truncate`). Pin every line-height inside
  a height-budgeted container — an inherited ratio re-prices the budget from under you.

`.trellis/tasks/archive/2026-08/08-31-page-width-and-result-layout/measure.mjs` is the harness
(superseding the copy under `08-31-desktop-density-tuning`, which predates the splash screen —
note that one is archived at the same depth, not at the path this file used to give): it drives the real
pages in Chrome across six viewports and reports `scrollHeight - innerHeight`, per-bar heights,
gutter ratio, the px floors, and — since the result-page work — list box vs list content height
and the document-space bottom of the actions row. Re-run it before claiming a layout change fits.

**A measurement harness expires, and it expires green.** The density-tuning copy was written
before the `Splash` overlay shipped. Re-run as-is afterwards, it reported `overflowY 0 ✓` and
`gutter -` for Start on all six viewports — it was measuring the overlay, and a screen it never
reached looked like a screen that passed. The harness now dismisses `[role="dialog"]` in
`fresh()` before probing.

Two habits follow:

- **Before trusting an old harness, check that its entry path still exists.** A selector that
  no longer resolves throws and is obvious; an overlay that renders *over* the target does not.
- **Sanity-check one number against a known value.** Start at 1366×678 is documented at
  `+15/+16` overflow. A run reporting `0` there is measuring something else, not a fix.

**Fixtures make a fair comparison; do not read noise as a regression.** Before the 78u bar
floor, the narrow-viewport Play rows came out 74 or 77.41 depending on whether that draw's
titles wrapped, so `overflowY` moved ±30px between runs on 375×667 with no code change (the
floor now absorbs the wrap, but the rule stands). Comparing a baseline against an after
run, confirm the widths you actually changed moved (`main` width) before attributing a
height delta to the change — at 375 the column is 375px in both runs, so `--page-main` cannot
be the cause of anything there.

**`Start.tsx` has no vertical budget left.** Measured at 1366×678 (where `--u` bottoms out at
0.78) it was `doc 674.6 / vp 678` — 3.4px of slack. Adding the 44px tool rail above the prism
rail cost `py` one step and the `mt` of both the difficulty section and the volume group one
step each, and it still ends up 16px over on that one viewport (1440×810, 1536×774 and
1920×990 all fit). Before adding anything that occupies its own row on this screen, measure all
four; do not assume there is room.

Where to stop compressing is a judgement, so make it explicitly: the remaining 16px were left
on the table because buying them means padding against the viewport edge or tightening the
title group, and a home screen that scrolls a little costs nothing. **"Must fit one screen" is
the karuta board's rule** (The Both-Territories Rule — grabbing cards lasts seconds, so
scrolling to find your own card means you cannot play), not this screen's. `.sc-vfit`'s
`safe center` already handles content taller than the viewport.

For touch targets on plain text buttons, grow the box without moving the text, and do not
reach for `::after` — these buttons usually sit inside a `clip-path` container that would
clip the pseudo-element away:

```css
.tap-line { display: inline-flex; align-items: center; min-height: 44px;
            padding-inline: 9px; margin-inline: -9px; }
```

## Feedback belongs at the moment of the penalty, not after it

`roundReveal` opens a 10-second window in which the player who committed an お手つき waits
while their opponent picks the card they will be given. For that whole window the panel said
only "{opponent} 正在挑送り札…" — the word お手つき never appeared, and `cardStateFor`
returned early in the `choosing` branch so the mis-tapped card was never marked. The player
learned what happened after the cards had already changed hands.

空札 is 6 of 24 rounds, and お手つき is the game's central punishment. When a mechanic
punishes the player, name it while the punishment is happening, mark what caused it, and put
the text in a live region — the reveal narration arriving later does not cover the window.

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

The rule is symmetric, and the reverse case is the one that got missed: on the dark brand
gradient, `--color-accent` #5ee2ff measures **3.9:1** against the `--grad-brand-ink` lower
stop #615f90. Accent text on a dark surface uses `--color-accent-lit` #b9f2ff (4.85:1
measured). Whenever a token crosses from surface to text, or from a light ground to a dark
one, recompute — do not assume the pairing inherits.

### The detector's pixel-contrast fallback is an antialiasing artifact

When an ancestor carries `filter` or `backdrop-filter`, the cascade engine cannot resolve the
background and falls back to per-pixel measurement. Small text is mostly partial-coverage
pixels, so the numbers come out low across the board and look like a systematic failure.

Prove it with a control from the same page rather than arguing: `--color-ink` on the same
surface is **16.77:1** in truth and the same method reports median 4.2–7.2. Then re-measure
with `tools/ui-audit/px-contrast.mjs` (DPR 4, darkest/lightest pixel in the glyph box against
the surrounding median) and use those numbers. Note it takes the pixel **farthest** from the
background, not the darkest — light text on a dark surface breaks the naive version.

The 8 unit colours are **data**, not tokens. They may be a solid cap, an edge segment, or a
thumbnail ring — never text on white (`#fff68d` disappears). Give every solid cap a
`inset 0 0 0 1px rgb(0 0 0 / .1)` so the pale units still read, and fall back to
`--color-primary` (not `--color-primary-lt`) when a song has no unit.

---

## Image assets: alpha is the hidden cost, and matte recovery has a boundary

Two things learned while producing `public/brand.webp` (`tools/prepare-opening.mjs`).

**libwebp encodes the alpha plane losslessly, and ffmpeg exposes no way to change that.**
`-quality` only touches RGB; there is no `alpha_quality` on the ffmpeg wrapper and no `cwebp`
on this machine. For a logo with large soft-glow gradients the alpha plane alone came to
~208KB: the file was 277KB at 1280 wide and still 151KB at 900 wide, while dropping quality
from 82 to 58 moved it 8%. If a transparent asset blows its size budget, **the alpha plane is
the suspect** — check it before touching `-quality`, and consider whether the transparency is
needed at all. Quantising alpha to 32 levels is the lever that works when it is (round and
clamp to 255; `floor()` lands the top bucket at 248 and veils the whole image at 97% opacity).

**A black-backed glow image is premultiplied alpha, so it can be recovered exactly** — set
`a = max(R,G,B)` (not luma, which reads a pure-red mark as 30% opaque), scale **before**
un-premultiplying (premultiplied data is what interpolates correctly), then `unpremultiply`.
Verified against a per-pixel reference: zero error on alpha, 1/255 rounding on RGB.

**But the technique only holds for pure glow.** This logo has a solid dark purple outline, and
the recovery cannot tell a dark *body* from a dim *glow* — it turned the outline
semi-transparent, so on the white ground the letterforms lost their edge and the whole mark
read as floating. Average RGB in the semi-transparent region: 0.408 hand-cut versus 0.820
recovered, and that gap is exactly the dark detail that was thrown away. **A mark with solid
dark parts must be cut by hand.** As a bonus the hand-cut alpha is mostly pure 0 or 255, which
libwebp compresses well: 93.8KB with no quantisation at all.

Consequence for the repo: `brand/` is **not** in `.gitignore` even though every other source
asset (`songs/`, `emoji/`, `bg-video.mp4`, `opening-greeting/`) is. Those can be re-fetched or
re-derived; a hand-cut matte cannot.

## Canvas export: four failures that do not throw

The share-report ticket (`ui/ticketPainter.ts`) hit all four. None produced an error.

### `ctx.font` falls back silently, and lays out at the fallback's widths

Jost and Noto Sans JP arrive from Google Fonts. Set `ctx.font` before they load and the
canvas quietly uses the default family **and measures with it** — the export is a complete
image with wrong tracking, wrong truncation points and no console output. Await the faces
before the first paint:

```ts
await Promise.all(sizes.map((f) => document.fonts.load(f).catch(() => undefined)))
```

Already-loaded faces resolve immediately, so this costs nothing on repeat opens. Do not let a
rejection block the export — a fallback-font image beats a dialog that never finishes.

### A missing image must have a declared fallback, or it leaves a hole

`img.onerror` → skip the op is the right default for cover art, but for anything the layout
reserves space around, skipping leaves a gap that looks like a rendering bug. Put the
fallback in the op (`{ src, fallback }`) and resolve it in the loader, keyed by the original
`src` — the painter should not know that a substitution happened.

### `object-fit` on a `<canvas>` is the wrong tool for preview sizing

Canvas content always fills the element box, so a box with the wrong aspect ratio stretches
the drawing; whether `object-fit` rescues it depends on the browser treating canvas as a
replaced element. Size the preview with `height` + `aspect-ratio` so the box is correct by
construction and there is nothing to stretch.

### Pixel-level noise makes PNG incompressible

A per-pixel paper grain at export resolution measured **3.45 MB**. Generating it at logical
resolution and upscaling changed nothing (3.45 MB) — interpolation recomputes every pixel to
a fresh intermediate value, so the entropy survives. Upscaling with
`imageSmoothingEnabled = false` produces genuine 2×2 blocks and the same image lands at
**1.46 MB**. Cache the noise layer by size, too: regenerating 1440×2160 on every open is a
visible stall between the click and the picture.

## Overlays centre their overflow into unreachable space

`ui/Overlay.tsx` is `flex … justify-center`. Content taller than the viewport is split across
*both* ends, and scrollbars only travel downward — so the top is gone. Measured on the share
dialog at 390×844: 804px of content in a 776px box, with the bottom button clipped.

Any overlay whose content can grow (a preview image, a long list) must cap and scroll itself
rather than rely on the overlay:

```tsx
<span className="cut-shadow-lg" style={{ maxHeight: '92dvh', overflowY: 'auto' }}>
```

Cap embedded media against `dvh` as well as `--u` (`min(calc(400 * var(--u)), 40dvh)`), so a
short viewport shrinks the media instead of pushing the actions off-screen.

**The same cap applies to any list whose length is decided by data, overlay or not.** The
result page's per-question list was laid out straight into page flow, so its height tracked
the question count: measured at 1366×678, 10 questions overflowed by 464px and 20 by 1061px,
putting the actions row 383px and 979px below the fold. The most common path on that screen is
"read the score, play again", and it ran through the entire song list.

Three things about the fix generalise:

- **Cap with `min(calc(N * var(--u)), Xdvh)`.** `--u` alone still crowds the actions out on a
  short window; `dvh` alone lets the list grow back on a tall one. `dvh` is safe *here* because
  it drives one container's height — unlike type, which must not be bound to `vh` (the URL bar
  would make it jitter mid-scroll).
- **The acceptance criterion is "both question counts produce the same `scrollHeight`."**
  "The list no longer stretches the page" has no other measurable definition. After the change
  both 10 and 20 measured `+174` at 1366×678, `+542` at 375×667.
- **`overflow-y: auto` turns the box into a clipping box, so the rows' `drop-shadow` gets
  shaved off at the left and right edges.** Give the container `padding-inline` for the shadow
  to land in and an equal negative `margin-inline` to keep the visual width. Note the scrollbar
  still eats ~12px on platforms that reserve a track, so the right edge sits slightly inside
  the rules above it; that is the honest cost of a scroll region, and closing it would need a
  platform-dependent magic number.

Say "there is more below" with a `mask-image` fade rather than a border — and on phones, where
no scrollbar is reserved, that fade is the *only* signal. Then read the
`mask-image`-eats-`outline` trap above, because adding it costs you the focus ring.

## A huge `--u` figure will crush its row-mates on narrow screens

`.sc-figure` is 96u. Put anything after it in a non-wrapping flex row and on a phone that
element gets whatever pixels are left — the settlement grade badge was squeezed to a few tens
of pixels and its title broke one character per line («资/深/P»). `flex-wrap` plus `w-full
sm:w-auto` on the trailing element gives it its own line when narrow and restores the desktop
arrangement. Check any row that pairs a display-scale numeral with text.

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
