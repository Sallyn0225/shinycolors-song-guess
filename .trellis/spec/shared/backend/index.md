# @scg/shared Guidelines

> `packages/shared` — the wire contract and every tunable number. No runtime, no I/O.

---

## What this package is

Four source files, ~550 lines, and exactly one function with behaviour:

```
src/protocol.ts     ClientMsg / ServerMsg, the view types, the zod schema, sanitizeRoomName
src/difficulty.ts   DIFFICULTY_PRESETS, KARUTA_DEFAULTS
src/scoring.ts      SCORING constants + ScoreBreakdown
src/index.ts        barrel: export * from each of the above
```

`sanitizeRoomName` is the exception to "no behaviour", and the bar it had to clear is worth
recording: it lives here **only because both ends must apply the identical rule** — the web
input gives live feedback, the server stores the result, and any drift between the two
produces "looked fine in the box, came back different". It is a pure string function with no
I/O, in the same category as `encode()`. `src/protocol.test.ts` (13 tests) covers it; that is
why this package now has a `test` script at all.

Do not treat it as a licence to move logic here. The next candidate needs the same argument:
both ends must run the same code, and the code touches nothing but its arguments.

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
