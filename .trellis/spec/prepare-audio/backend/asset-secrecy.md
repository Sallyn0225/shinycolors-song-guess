# Asset Secrecy

> Half the encoder flags in this package exist to close a side channel, not to improve
> quality. Every one of them looks removable. Read this before touching `slice.ts`,
> `manifest.ts`, or `selfCheck()` in `index.ts`.

---

## The threat

A player who can map a clip file back to a song wins every round. The clip is served under
a random one-shot token, so the attack is not "read the filename" — it is to fingerprint
the *file*. Four fingerprints have been closed:

| Channel | Closed by |
|---|---|
| embedded ID3 title/artist copied into the output | `-map_metadata -1 -fflags +bitexact` |
| file byte size | `-vbr off` (opus) / `padAac()` to a fixed size (aac) |
| file mtime = build order = title alphabetical order | `normalizeMtimes()` to `CANONICAL_MTIME` |
| answer fields in the public manifest | `assertPublicManifestClean()` |

Each has a matching HTTP-side rule in `apps/server` (`lastModified: false`,
`cache-control: no-store` on clips). Both halves are required.

---

## The ffmpeg flags that must not be dropped

From `slice.ts#encodeSlice`, with the reason for each:

- **`-map_metadata -1 -fflags +bitexact`** — without these, ffmpeg copies the source ID3
  `title`/`artist` straight into the Opus Vorbis comment. That writes the answer into the
  clip file. This is the single most dangerous flag in the package.
- **`-vbr off`** (hard CBR) — makes every slice essentially the same byte count. The cost is
  slightly worse quality on complex passages, which is why the bitrate is 80k rather than
  64k. Without it, size alone identifies the track.
- **`-map 0:a:0`** — all 233 mp3s embed an mjpeg cover stream; without an explicit audio map
  the encode errors out. Not secrecy, but equally non-optional.
- **`-ss` before `-i`** with `-t` (not `-to`) — input seek, >2× faster, and still sample
  accurate because `-accurate_seek` is on by default.
- **`-ac 1 -ar 48000`** — must match the measurement chain in `analyze.ts`, which measures
  after a mono downmix. Stereo-measured loudness differs from mono by 1–1.5 dB, and a
  mismatch reintroduces a per-song loudness error, which is itself a hint.

The AAC fallback (`encodeSliceAac`) mirrors all of it, and adds `-movflags +faststart`. It
needs `padAac()` afterwards because ffmpeg's native aac encoder has no true CBR: measured
sizes drift between 184–198 KB, which across 1398 slices is very nearly a unique
fingerprint. `padAac` appends an MP4 `free` box — explicitly skippable per spec, harmless to
every decoder — up to `SLICE.aacPadToBytes`. If a file exceeds that constant, `padAac`
**throws** rather than shipping an uneven file; raise the constant and rerun.

---

## Slice ids are random, not derived

`newSliceId()` produces 20 Crockford-base32 characters (~100 bits) from `randomBytes`.

The rejected alternative was `HMAC(secret, songId:index)`. Random wins on two counts: there
is no key to leak (a leaked key would let an attacker recompute all 1398 ids offline), and
**rotation is a rename**. `--rotate-ids` regenerates ids, renames the files and rewrites the
manifest in seconds without re-encoding, which is what makes "rotate periodically to break
any table an attacker has accumulated" actually practical.

The `% 32` is unbiased because 256 divides evenly by 32 — keep that property if you change
the alphabet length.

Files are stored under a two-character prefix directory (`slices/AB/ABCD….opus`) to avoid
1400+ entries in one directory. Because ids are random, the directory grouping reveals
nothing.

---

## The manifest boundary

`manifest.ts` writes two files and then asserts on one of them:

```ts
const forbidden = ['sliceId','slices','duration','durationSec','mp3Path','jpgPath',
                   'srcSize','srcMtimeMs','sliceCount','integratedLufs','neighbours','album']
```

`assertPublicManifestClean()` does both a substring scan of the raw JSON and a whitelist
check on each song object (`id, title, artist, unit, unitColor` and nothing else). It
returns problems; callers turn that into a failed build.

Add to `forbidden` whenever you add a private field. The whitelist check catches new keys
automatically, but the substring scan is what catches a field nested somewhere unexpected.

`detectAacFallback()` probes the disk rather than trusting a flag, because a flag drifts
from reality when someone changes `--with-aac-fallback` without re-running `slice`. The
server uses the result to decide whether to advertise `fallbackUrl`; advertising one that
does not exist gives old Safari a 404 instead of audio, which is worse than no fallback.

---

## Removing a song: the pipeline never deletes, so orphans are on you

`scan.ts`, `slice.ts`, `covers.ts` and `manifest.ts` only ever **write**. There is no orphan
reaping anywhere. Delete a directory from `songs/`, re-run `pnpm assets all`, and the old
song's 6 slices, 1 webp and 2 cache entries stay on disk — invisible to the manifest but
still served by `fastifyStatic`, which is exactly the leftover-file oracle this document
exists to prevent.

The trap is the ordering. Slice filenames are random ids; **the only record of which slice
belongs to which song is `manifest.private.json#sliceIndex`.** Re-run the manifest stage
first and that mapping is overwritten — the orphans become unattributable, findable only by
diffing the whole `slices/` tree against the new manifest.

So the order is fixed:

1. read the doomed sliceIds out of the **current** `manifest.private.json` before touching
   anything;
2. delete the `songs/` directory;
3. delete those slices, `thumb/<songId>.webp`, and
   `.cache/{analysis,slices}/<songId>.json`;
4. only then `pnpm assets all`.

Verify with a set difference — every `.opus` on disk must appear in `sliceIndex` and vice
versa. Expect the analyze/slice stages to report 100% cache hits: a rebuild that re-encodes
means a cache key was disturbed, and re-encoding also churns every sliceId, breaking URLs
that clients have cached.

**Never write that mapping into a tracked file.** `.gitignore` excludes `assets/` but
*includes* `.trellis/tasks/`, so a scratch JSON dropped in a task directory to hold "the
sliceIds I'm about to delete" will happily carry the full 1398-entry answer table into the
repository. Keep such scratch files outside version control and delete them when done.

---

## `selfCheck()` fails the build

After every slice run, `index.ts#selfCheck` verifies:

1. no missing files;
2. **mtimes are all identical** — more than one value means build order is leaking;
3. **byte sizes** — for aac, *exactly* one distinct value (padding either worked or did
   not); for opus, a spread of at most 4096 B;
4. **no residual tags** on a 12-file sample, excluding structural mp4 keys
   (`major_brand`, `handler_name`, …) which are container boilerplate and carry no song
   identity.

Any failure sets `process.exitCode = 1`. These are all "ships silently and leaks the
answers" failures — that is the bar for adding a new check here.

---

## One more, from `analyze.ts`

`loudnorm`'s dynamic mode was rejected not only for speed (7376 ms/song vs ~400 ms for
`ebur128`) but because dynamic compression pushes a quiet intro up to chorus volume. That
creates a **loudness cue**: a normalised-flat clip tells you what part of the song it came
from. Static gain from a measured integrated loudness does not.
