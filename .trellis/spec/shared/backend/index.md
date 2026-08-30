# @scg/shared Guidelines

> `packages/shared` — the wire contract and every tunable number. No runtime, no I/O.

---

## What this package is

Four source files, ~450 lines, zero behaviour:

```
src/protocol.ts     ClientMsg / ServerMsg, the view types, the zod schema
src/difficulty.ts   DIFFICULTY_PRESETS, KARUTA_DEFAULTS
src/scoring.ts      SCORING constants + ScoreBreakdown
src/index.ts        barrel: export * from each of the above
```

It is imported by **every** other package (`@scg/web`, `@scg/server`, `@scg/game-core`,
`@scg/prepare-audio`). A change here is a change to all four at once — that is the whole
point of the package and also the reason to be careful in it.

The layer directory is called `backend/` because that is the Trellis scaffold's name for a
non-React layer. `@scg/shared` is neither backend nor frontend; it is consumed by both.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | File layout, the `.js` import rule, what may not enter this package |
| [Protocol and Contracts](./protocol-and-contracts.md) | Wire types, zod at the boundary, what must never reach the client |
| [Tuning Constants](./tuning-constants.md) | Where game feel lives, and why each knob is separate |
| [Quality Guidelines](./quality-guidelines.md) | Type conventions, verification commands |

---

**Language**: spec files are written in English. Source comments in this repo are Chinese;
match the file you are editing, do not convert either direction.
