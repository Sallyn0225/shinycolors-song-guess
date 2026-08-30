# Pipeline Guidelines

> Stages are cached by source content and stage version, degrade instead of failing, and
> report progress on one line. All three are what make a 233-song rebuild survivable.

---

## `StageCache` — the caching contract

```ts
// util/cache.ts
class StageCache<T> {
  get(id, srcSize, srcMtimeMs): Promise<T | null>
  set(id, srcSize, srcMtimeMs, data): Promise<void>
}
```

The key is `(stageVersion, srcSize, srcMtimeMs)`. A cached entry is discarded when any of
the three changes, so:

- swapping the source mp3 invalidates that song only;
- **bumping one stage's version in `STAGE_VERSIONS` invalidates that stage only.** That is
  why the versions are a per-stage record rather than a single global number — changing the
  slice planner must not force a re-analysis of 233 files.

When you change a stage's algorithm, bump its version in
`tools/prepare-audio/src/config.ts#STAGE_VERSIONS` in the same commit. Forgetting is the
characteristic bug here: the build "succeeds" and silently keeps the old output.

`--force` bypasses the cache for a single run. It is not a substitute for the version bump,
because it does not help anyone else.

---

## Stages, and what each one may assume

```
scan     songs/ → ScannedSong[]  (+ buildMeta → SongMeta[], written to .cache/scan.json)
analyze  one ffmpeg pass per song → loudness + silences        [StageCache]
slice    planSlices → encode opus (+ aac) → normalizeMtimes → selfCheck   [StageCache]
covers   source jpg → cover/thumb webp                          [StageCache]
manifest analyses + specs → manifest.public/private.json + boundary assertion
audit    serve the local audit page
review   risk report → REVIEW_MD / REVIEW_JSON
preview  generateSoloRound against the built catalog
stress   repeated preview, to catch rare distractor failures
all      the above, chained in memory
```

Each stage can be run alone and will load what it needs from cache
(`loadMeta()` re-runs `scan` if `.cache/scan.json` is missing). Keep that property: a stage
that only works inside `all` is a stage nobody can iterate on.

Two re-entry points exist specifically to avoid re-encoding
(`pipeline.ts`): `reresolve()` re-runs performer resolution from `scan.json`, and
`rebuildManifests()` rewrites both manifests from existing `analyze`/`slice` caches. Metadata
fixes must stay in that fast path.

`scan` validates shape — one mp3, one jpg, an ID3 title, a plausible duration — but it does
**not** and cannot verify that a track is actually off-vocal. That check is a human one, at
the point material enters `songs/`. The signal to look for is a missing ` (Off Vocal)`
suffix on the ID3 title: `stripOffVocal` treats the suffix as optional for robustness, so a
vocal track sails through every stage and lands in the catalog, where it sings the answer to
the player. One did (`リフレクトサイン (2022 Ver.)`, removed 2026-08-30). If you find
yourself relaxing a rule in `util/text.ts` to accommodate one odd file, check whether the
file is the bug.

---

## Degrade ladders, not hard failures

`planSlices.ts` is the model. Six 15-second slices must fit inside a song under constraints
(head/tail guards, silence tolerance, minimum gap). If the base constraints do not fit, it
walks a five-step `LADDER`, loosening in a deliberate order, and records how far it went as
`degradeLevel` (0 = never degraded, ≥3 = needs human review).

The order encodes what matters: silence tolerance is relaxed *first*, and slice overlap
*last*, because `minGapSec` defaults to the full slice duration for a gameplay reason —
if two slices overlap 80%, "play a different slice on a repeat" stops being different, and
players can once again recognise a 空札 by having heard the audio before. Even the last
rung caps overlap at 50%.

When you add a constraint, add a rung — do not add a precondition that throws. And keep
`degradeLevel` flowing into `SliceSpec` so `review.ts` can surface it.

---

## Concurrency

`mapConcurrent(items, limit, fn)` in `util/proc.ts` — 20 lines, no `p-limit` dependency.
The default limit is `defaultConcurrency()`: `min(availableParallelism(), 12)`, floor 2.

The 12 is measured, not guessed — the comment records that 8→16 workers gained only 8%
because the bottleneck is memory bandwidth and I/O rather than CPU. Do not raise it without
re-measuring, and do not use `Promise.all` over 233 ffmpeg invocations.

File-system fan-out (stat, utimes) uses a higher limit (32) since it is not CPU-bound.

---

## Console output

There is no logger. Output is `process.stdout.write` with a `[stage]` prefix and Chinese
text, and long jobs use the `Progress` class from `util/cache.ts`:

```
[scan] 233 首，耗时 12.3s
[analyze] 缓存命中 233/233
[slice] ████████████░░░░░░░░░░░░ 640/1398 eta 88s 失败 0
[slice] ⚠ 记得跟一句 pnpm assets manifest，否则服务端还在用旧 id
```

Conventions worth keeping:

- `Progress` rewrites one line with `\r` and clears it in `finish()`. Never interleave a
  plain `write` with a live progress bar.
- Warnings are prefixed `⚠` and **say what to run next**. The example above is the reason:
  rotating slice ids without rebuilding the manifest leaves the server serving dead ids.
- Summaries after `scan` print the resolution-source distribution and the unresolved list in
  a paste-ready format (`title ||artist=... ||album=...`), because the next step is a human
  editing `data/overrides.json`.
- `console.log` is not used anywhere in this package. `console.error` appears once, in
  `parseArgs` for an unknown stage, immediately before `process.exit(2)`.

---

## Adding a stage

1. Name it in `STAGES`.
2. Give it a `StageCache` and an entry in `STAGE_VERSIONS` if it produces derived data.
3. Make it runnable alone; load upstream data from cache.
4. Use `mapConcurrent` + `Progress` if it processes songs.
5. Chain it into `case 'all'`.
6. If it writes files that reach the client, extend `selfCheck()` — see
   [Asset Secrecy](./asset-secrecy.md).
