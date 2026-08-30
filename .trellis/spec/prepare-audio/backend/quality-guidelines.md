# Quality Guidelines

> 14 tests, all on the two pure modules. Everything else is verified by running the build
> and reading what it prints.

---

## Verification

```bash
pnpm --filter @scg/prepare-audio test        # vitest run — 14 tests
pnpm --filter @scg/prepare-audio typecheck   # tsc --noEmit
pnpm -r test && pnpm -r typecheck            # before reporting done
```

Tests do **not** require `songs/`, `ffmpeg`, or a built `assets/`. `planSlices.test.ts` and
`slice.test.ts` cover the pure parts — slice planning under the degrade ladder, and id
generation / padding arithmetic. Keep new tests in that category; a test that shells out to
ffmpeg is not a unit test and will not run on a fresh clone.

No `vitest.config.ts` — defaults, `src/**/*.test.ts`, tests beside their module.

---

## What is testable and what is not

| Testable in vitest | Verified by running the build |
|---|---|
| `planSlices` — every rung of the ladder, `degradeLevel` | `analyze` numbers on real audio |
| `newSliceId` distribution, `padAac` arithmetic | ffmpeg flag behaviour |
| `similarity` neighbour ranking | performer resolution coverage |
| `manifest` boundary assertion (pure over a JSON string) | encode success rate |

For the right column the harness is the CLI itself:

```bash
pnpm assets scan            # prints resolution-source distribution + unresolved list
pnpm assets slice --only <substring>   # encode one song, incl. selfCheck
pnpm assets manifest        # rewrites manifests + runs the boundary assertion
pnpm assets review          # risk report → REVIEW_MD / REVIEW_JSON
pnpm assets preview         # generate a solo round against the built catalog
pnpm assets stress          # repeat preview to catch rare distractor failures
```

`--only` exists so this loop is seconds, not an hour. Use it.

---

## The checks that must not be weakened

`selfCheck()` and `assertPublicManifestClean()` are the package's real test suite for its
most important property. Both set a failing exit code. Neither may be turned into a warning.
See [Asset Secrecy](./asset-secrecy.md) for what each one catches and why.

If a change makes `selfCheck` fail, the answer is almost never to relax the threshold. The
opus byte spread of 4096 B and the aac "exactly one size" rule are both derived from what
CBR and padding actually deliver.

---

## Reviewing a change here

- Did an algorithm change without a bump in `STAGE_VERSIONS`? The build will silently reuse
  stale cache.
- Does a new constraint throw where it should have become a rung on the degrade ladder?
- Does every new ffmpeg invocation have a `timeoutMs`, go through `run()`, and pass its
  paths through `win32Long()`?
- Does a new loop over songs collect failures and set `process.exitCode`, rather than
  throwing on the first bad file?
- Did a new field reach `manifest.public.json`? Add it to `forbidden` or remove it.
- Is a new empty `catch {}` annotated with what covers the case?

---

## Platform notes

Development happens on Windows. Two consequences that have already caused bugs:

- **Long paths.** The library contains a 403-character path. Anything touching the
  filesystem goes through `win32Long()`, which must be given an already-resolved absolute
  path (`\\?\` disables normalisation).
- **Directory names are lossy.** The downloader sanitised `/` in titles into `_` for
  directories but not for files, so 26 songs have their audio nested up to 9 levels deep,
  and two titles are unrecoverable from the directory name. Metadata is therefore always
  taken from ID3 via `ffprobe`, never parsed out of a path. `scan.ts` recurses for this
  reason; do not "optimise" it back to a single-level read.
