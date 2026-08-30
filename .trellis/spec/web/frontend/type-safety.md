# Type Safety

> No `any` anywhere in `apps/web/src`. Wire types come from `@scg/shared`; the boundary
> where they enter is the only place a cast is acceptable, and it is always a narrowing one.

---

## Wire types are imported, never redeclared

```tsx
import type { CardView, MatchView, PlayerId, RoundResultView, ServerMsg } from '@scg/shared'
```

Every message and view type comes from the shared package. If the client needs a shape the
server does not send, that shape is a *local* type with a different name — never a
hand-written copy of a server type.

`api.ts` declares the REST response types locally (`SessionInfo`, `QuestionView`,
`AnswerResult`, `Summary`) because the solo REST API's responses are assembled inline in
`apps/server/src/app.ts` and have no shared declaration. This is a known duplication: when
you change one of those route handlers, update `api.ts` in the same commit. Nothing catches
it for you — the two ends are only connected through `res.json() as T`.

---

## Narrowing at the boundary

Two casts exist per network hop, and both are the honest minimum:

```ts
// api.ts
const body = (await res.json().catch(() => ({}))) as { error?: string }
return (await res.json()) as T

// net/ws.ts
msg = JSON.parse(String(ev.data)) as ServerMsg
```

Both are wrapped: the fetch helper checks `res.ok` first and throws `ApiError` with the
server's `{ error }` message, and the socket's `JSON.parse` is inside a `try` that returns
on failure. Inbound *client* messages are validated with zod on the server; the client
trusts the server, which is the correct asymmetry for this app.

Do not add runtime validation of `ServerMsg` on the client. It would double the schema
surface to defend against our own server.

---

## Discriminated unions do the work

Three unions structure the whole app, all switched on a string tag:

```ts
ServerMsg      // { t: 'roundStart' } | { t: 'roundResult' } | …   — from @scg/shared
Screen         // { name: 'play'; session } | { name: 'karuta'; match } | …  — App.tsx
Phase / Stage  // 'loading' | 'answering' | 'revealed' | 'error'   — per screen
```

`noFallthroughCasesInSwitch` is on, so every arm must `break` or `return`, and message
switches end in `default: break` — an unhandled message type is a deliberate no-op.

Extracting one variant uses `Extract`, not a redeclaration:

```ts
type RevealMsg = Extract<ServerMsg, { t: 'roundReveal' }>
```

Union-keyed lookup tables are typed `Record<Union, T>` so adding a variant is a compile
error at every table: `SIZE`, `MIN_H`, `SHAPE_CLASS`, `SHADOW_CLASS`, `TONE`, `POS`, `FLIP`.
Prefer this over a `switch` in JSX — it is what makes an added `CardState` impossible to
forget.

---

## `strict` consequences you will meet immediately

From `tsconfig.base.json`, inherited by `apps/web/tsconfig.json`:

**`noUncheckedIndexedAccess`** — `arr[i]` is `T | undefined`. The codebase resolves this
three ways, in order of preference:

```ts
const f = faults[0]!                       // just checked faults.length
const head = list[0] as HTMLElement        // just checked list.length
option.unitColor ?? 'var(--color-primary)' // real fallback, and the fallback matters
```

Prefer a genuine fallback. Note `?? 'var(--color-primary)'` in `OptionBar` and `KarutaTile`
is not defensive filler — songs with no unit exist, and falling back to `--color-primary-lt`
would make the cap invisible on white.

**Type predicates for filters** — `.filter((x): x is CardId => x !== null)`
(`features/karutaBoard.ts`). Without the predicate the result stays `(CardId | null)[]`.

**`useState` with an explicit parameter** when the initial value does not imply the type:
`useState<QuestionView | null>(null)`, `useState<Stage>(() => ...)`.

**Lazy initialisers read singletons**: `useState(() => socket.connected)` — the function
form, so it is evaluated once at mount rather than every render.

---

## React typing conventions

- **No `React.FC`.** Plain function declarations with a destructured `Props` parameter.
- **`interface Props`**, local, not exported. Exported are the *state* unions the screen
  needs to compute (`OptionState`, `CardState`, `CutShape`, `CutElevation`, `Crease`,
  `CardPick`).
- **Extend DOM prop types when wrapping an element**, omitting what you own:
  `Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>`, then `{...rest}`.
- **`import type` for type-only imports**, always. `verbatimModuleSyntax` is not set, but the
  codebase is consistent and mixing styles makes the tree-shaking story harder to read.
- **`ReactNode` for children**, `CSSProperties` for style props.
- One documented oddity in `audio.ts`:
  `a.getByteFrequencyData(f as unknown as Uint8Array<ArrayBuffer>)` — a lib.dom typing
  mismatch, not a design decision. Leave it unless the DOM types change.

---

## CSS custom properties in `style`

TypeScript rejects unknown properties on `CSSProperties`, so a custom property needs an
index cast:

```tsx
style={{ ['--tc' as string]: `calc(${c} * var(--u))` }}
```

That is the accepted form (`ui/SectionTitle.tsx`). Do not widen the whole style object to
`any` to avoid it.

---

## Verification

```bash
pnpm --filter @scg/web typecheck    # tsc --noEmit
pnpm --filter @scg/web build        # tsc -b && vite build
pnpm -r typecheck                   # catches shared-type drift across packages
```

`tsc --noEmit` is not optional before reporting done; `apps/web/tsconfig.json` sets
`noEmit: true` and `types: ["vite/client"]`, and the build runs `tsc -b` first, so a type
error fails the build too.
