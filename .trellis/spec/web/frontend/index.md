# @scg/web Guidelines

> `apps/web` — React 18 + Vite 6 + Tailwind v4. The only frontend in the repo.

---

## What this package is

```
src/main.tsx      createRoot + StrictMode
src/App.tsx       screen switch, resume-on-load, the messages Karuta cannot receive itself
src/api.ts        typed fetch wrappers for the solo REST API
src/audio.ts      AudioEngine singleton — Web Audio, decode cache, output-latency correction
src/ambience.ts   Ambience singleton — opening greeting + looping BGM on a bypass chain that
                  shares audio.ts's context but skips its master gain and analyser
src/sfx.ts        Sfx singleton — the other bypass consumer; fire-and-forget UI sound cues,
                  decoded-buffer cache, mute/sfxOn gate, public/sfx/*.wav (CC0, see CREDITS.md)
src/net/ws.ts     GameSocket singleton — WebSocket, clock sync, reconnect, seat token
src/features/     pure logic: kimariji, karutaBoard (SlotMap), narrate  — 21 tests live here
src/components/   OptionBar, KarutaTile, RoomCard — game-specific, stateless
src/ui/           Backdrop, Button, Countdown, Cut, Field, Icon, IconButton/ToolRail,
                  Overlay, Presence, PrismRail, ReadyCountdown, SectionTitle, Stat, VolumeControl
src/screens/      Start, Lobby, Room, Play, Karuta, Result — one per screen, own the state
                  Splash — the opening overlay; not one of the mutually exclusive screens,
                  it sits over them and carries the gesture that unlocks audio
src/index.css     the entire design system: tokens, shape primitives, .sc-* sizing, animations
```

The visual language is documented in `DESIGN.md`; current status and known gaps in
`PROGRESS.md`. Neither is duplicated here.

`Lobby` and `Room` are two screens rather than one because their lifetimes differ, not because
of line count: the lobby subscribes to the room list and must stay usable while the socket is
down; the room owns seats and readiness and is explicitly unsubscribed by the server the
moment you sit. Merged, the list subscription would keep running inside a match.

---

## The one rule that overrides taste

Four modules are off-limits during UI work: `src/audio.ts`, `src/net/ws.ts`, `src/api.ts`,
`src/features/*`. They encode production-only bugfixes that no local dev session
reproduces. [Quality Guidelines](./quality-guidelines.md) opens with the verification
command and what to do if a signature genuinely blocks you.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | The four-tier layout and which tier a new file belongs to | Filled |
| [Component Guidelines](./component-guidelines.md) | Shape primitives, styling, props, a11y baseline | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Effects, subscriptions, refs, cancellation, timers | Filled |
| [State Management](./state-management.md) | Where state lives, singletons vs state, refs for timing | Filled |
| [Type Safety](./type-safety.md) | Shared types, discriminated unions, `strict` consequences | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Layer boundary, clip-path traps, `--u` sizing, rAF timing UI, contrast rules | Filled |

---

**Language**: spec files are written in English; source comments and all UI copy are
Chinese. Match the file you are editing.
