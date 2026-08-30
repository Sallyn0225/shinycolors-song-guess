# Quality Guidelines

> `@scg/shared` has no tests of its own — it has no behaviour to test. Its quality bar is
> the type system plus the four packages that break when it is wrong.

---

## Verification

```bash
pnpm --filter @scg/shared typecheck    # tsc --noEmit
pnpm -r typecheck                      # the real check: every consumer still compiles
pnpm -r test                           # 143 tests, all downstream
```

`packages/shared/package.json` has no `test` script. Do not add a vitest file here to
manufacture coverage; if a change needs a test, the test belongs where the behaviour is
(`packages/game-core` for rules, `apps/server` for the wire loop).

`pnpm -r typecheck` is the one that matters. Because consumers compile this package's
source directly (no `dist`), a wrong type here surfaces as a compile error in
`apps/web`/`apps/server`, not locally.

---

## Type conventions inherited from `tsconfig.base.json`

`strict`, plus three flags that shape how code in this repo is written:

- **`noUncheckedIndexedAccess`** — `arr[i]` is `T | undefined`. This is why the codebase is
  full of `arr[i] as T` and `?? fallback`. Prefer the explicit fallback; reach for the
  assertion only where the index was just derived from `length` (as in
  `packages/game-core/src/rng.ts`).
- **`noImplicitOverride`**, **`noFallthroughCasesInSwitch`** — a `switch` on a message `t`
  must `break` or `return` in every arm.
- **`declaration: true`, `target: ES2023`, `module: ESNext`** — no CommonJS anywhere.

---

## Style that the whole repo follows

- **No semicolons, single quotes, 2-space indent, trailing commas.** There is no ESLint or
  Prettier config in this repo — formatting is maintained by matching surrounding code.
  Read the file before you write in it.
- **`interface` for object shapes, `type` for unions and aliases.** `protocol.ts` follows
  this exactly: `interface PlayerView`, `type TapVerdict = 'correct' | ...`.
- **`as const` on every constant table** — `DIFFICULTY_PRESETS`, `SCORING`,
  `KARUTA_DEFAULTS`, `ROOM_CODE_ALPHABET`. It is what makes `DIFFICULTIES[number]` a
  literal union instead of `string`.
- **Doc comments explain *why*, never *what*.** `/** 每轮题目数 */` is fine on a field whose
  name is `questionCount`; a comment restating the type is not. The valuable ones record a
  rejected alternative or a measured number — see the `hard.clipSeconds` and
  `speedCurve` comments.

---

## Common mistakes in this package

- Adding a field to a `*View` interface without asking whether it leaks the answer. Run
  through [Protocol and Contracts](./protocol-and-contracts.md) first.
- Adding a client message type to `ClientMsg` by hand instead of to `clientMsgSchema`.
  `ClientMsg` is derived from the schema; a hand-added member either does not compile or
  silently bypasses validation.
- Reaching for `z.infer` when a field has `.default()`. `ClientMsg` is `z.input<...>`,
  not `z.infer` (= `z.output`): a defaulted field is *optional* on the sending side and
  *required* after parsing. Senders (`apps/web/src/net/ws.ts`, `room.test.ts`) need the
  input type; `hub.ts` reads `safeParse(...).data`, which is already the output type.
  Switching `ClientMsg` to the output type makes every existing caller stop compiling.
- Importing anything from `@scg/game-core` here. The dependency runs the other way
  (`packages/game-core/package.json` depends on `@scg/shared`); a back-import is a cycle.
- Collapsing two constants that happen to hold the same number. See
  [Tuning Constants](./tuning-constants.md).
