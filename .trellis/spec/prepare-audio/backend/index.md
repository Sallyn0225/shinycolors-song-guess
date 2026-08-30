# @scg/prepare-audio Guidelines

> `tools/prepare-audio` — a Node CLI that turns `songs/` (233 off-vocal mp3s) into
> `assets/` (slices, covers, two manifests). It runs offline; it is not part of the server.

---

## What this package is

```
src/index.ts        the CLI: parseArgs, one stage* function per stage, dispatch, selfCheck
src/scan.ts         walk songs/, ffprobe ID3, produce ScannedSong
src/resolveUnit.ts  decide who performs each song (9-rule fallback chain)
src/buildMeta.ts    scan + resolve → SongMeta, confusable groups
src/analyze.ts      one ffmpeg pass → loudness + silence intervals
src/planSlices.ts   choose 6 slice start points under a degrade ladder
src/slice.ts        encode opus (+ optional AAC fallback), pad, id generation
src/covers.ts       cover/thumb webp
src/manifest.ts     write manifest.public.json / manifest.private.json + boundary assertion
src/similarity.ts   title-similarity neighbours, precomputed for distractor selection
src/review.ts       risk report; src/devserver.ts + src/pages/* serve a local review UI
src/preview.ts      previewSoloRound / stressSolo — sanity-check generated questions
src/util/           proc (spawn/concurrency), cache (StageCache/Progress), ffprobe, paths, text
src/pipeline.ts     re-run resolve / rebuild manifests without re-encoding
```

14 tests, in `planSlices.test.ts` and `slice.test.ts`.

Run it with `pnpm assets <stage>` from the repo root (`pnpm assets all` for a full build).
Stages: `scan analyze slice covers manifest audit review preview stress all`.

---

## The two things that make this package unusual

1. **Its output is an attack surface.** Byte sizes, mtimes and leftover ID3 tags are all
   oracles that map a clip back to a song. See [Asset Secrecy](./asset-secrecy.md); it is
   the reason `selfCheck()` can fail the build.
2. **Every stage is cached by content, not by wall clock.** Re-running is cheap and
   idempotent; that is what makes the degrade ladder and the manual review loop workable.
   See [Pipeline Guidelines](./pipeline-guidelines.md).

The layer directory is named `backend/` by the Trellis scaffold. This is a build tool, not a
server.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Module layout, the CLI shape, external tool dependencies |
| [Pipeline Guidelines](./pipeline-guidelines.md) | Stages, `StageCache`, degrade ladders, concurrency, console output |
| [Asset Secrecy](./asset-secrecy.md) | Why the encoder flags and the self-check exist |
| [Error Handling](./error-handling.md) | `FfmpegError`, exit codes, degrade vs fail |
| [Quality Guidelines](./quality-guidelines.md) | Test conventions, verification |

---

**Language**: spec files are written in English; source comments and all console output are
Chinese. Match the file you are editing.
