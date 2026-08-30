# Directory Structure

> Flat `src/`, plus `util/` for infrastructure and `pages/` for the two HTML strings the
> review server serves.

---

## Layout

```
tools/prepare-audio/
  data/               overrides.json and the seiyuu/unit tables (hand-maintained)
  src/
    index.ts          CLI entry — #!/usr/bin/env tsx, `bin: { scg-assets }`
    config.ts         every path constant + every tunable, one file
    types.ts          ScannedSong → SongMeta → AnalysisResult → SliceSpec
    <stage>.ts        scan, analyze, planSlices, slice, covers, manifest, review, preview
    resolveUnit.ts    performer resolution; buildMeta.ts wires scan + resolve
    similarity.ts     neighbour precomputation
    pipeline.ts       cache paths + the two "don't re-encode" re-entry points
    devserver.ts      local review UI
    pages/            auditPage.ts, reviewPage.ts — HTML as template strings
    util/             proc, cache, ffprobe, paths, text
```

Dependency direction is strictly downward: `index.ts` → stage modules → `util/`.
No stage module imports `index.ts`, and `util/` imports nothing from the stages. `config.ts`
imports nothing at all except Node built-ins.

`.js` extensions on relative imports are required — this package is `"type": "module"` and
runs through `tsx`.

---

## `config.ts` holds every constant

Paths (`SONGS_ROOT`, `ASSETS_ROOT`, `CACHE_DIR`, `SLICES_DIR`, …), `STAGE_VERSIONS`,
`SLICE`, `ANALYZE`, `COVERS`, `defaultConcurrency()`, `CANONICAL_MTIME`. Nothing else in
the package declares a path or a magic number that a human would want to tune.

`REPO_ROOT` is computed once here from `import.meta.url` and everything else derives from
it. It is depth-sensitive (`'..', '..', '..'` from `src/`), so moving this file breaks every
path silently until the next run.

---

## The CLI shape

`index.ts` is 617 lines and deliberately monolithic:

```ts
const STAGES = ['scan','analyze','slice','covers','manifest','audit','review','preview','stress','all'] as const
type Stage = (typeof STAGES)[number]

function parseArgs(argv: string[]): Args   // hand-rolled, no commander/yargs
async function stageScan(args: Args): Promise<void>
async function stageAnalyze(args: Args): Promise<AnalysisResult[]>
...
switch (args.stage) { case 'scan': ... }
```

Conventions to follow when adding a stage:

- Add the name to `STAGES` — the union type and the "unknown stage" error message both come
  from that array.
- Write one `stage<Name>(args)` function that returns whatever the next stage needs, so
  `case 'all'` can chain them in memory rather than round-tripping through disk.
- Flags are parsed by hand (`argv.includes('--force')`, `get('--only')`). Do not add an
  argument-parsing dependency for one flag.
- `--only <substring>` and `--force` are expected to work on any stage that processes songs;
  `applyOnly()` is the shared helper.

Stage functions live in `index.ts`; the *work* lives in the stage module. `stageSlice`
orchestrates, caches, reports and self-checks; `slice.ts` knows how to encode one file.

---

## External tools

`ffmpeg` and `ffprobe` must be on `PATH`. They are invoked only through `util/proc.ts`
(`run` / `runCapture`) and `util/ffprobe.ts#probe` — never with `child_process` directly,
because `proc.ts` owns the SIGINT cleanup that stops orphaned ffmpeg processes and the
streaming stderr reader that keeps a thousand-line analysis pass from blowing a buffer.

Every path handed to a subprocess goes through `win32Long()` first. The library has a
403-character path in it (`Summer Night Paradise`), well past Windows' `MAX_PATH`. Note the
comment in `util/paths.ts`: `\\?\` disables path normalisation, so `path.resolve()` must
come first.

---

## `data/` is hand-maintained input, not output

`data/overrides.json` records manual performer decisions. The review loop is: run `scan`,
read the "unresolved" list it prints, edit `overrides.json`, then use
`pipeline.ts#reresolve` / `rebuildManifests` — which re-derive metadata and rewrite the
manifests **without re-encoding audio**. Preserve that property in anything new: metadata
corrections must never cost an hour of ffmpeg.
