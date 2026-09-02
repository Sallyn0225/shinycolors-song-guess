# Secrecy and Anti-Cheat

> This is a guessing game played in a browser. The client is the adversary, and most of the
> leaks are side channels rather than obvious fields. Read this before touching
> `catalog.ts`, any route in `app.ts`, or `ws/timing.ts`.

---

## The public / private catalog split

`Catalog.load()` reads two manifests and keeps them apart for the rest of the process:

| Manifest | Contains | Reachable over HTTP |
|---|---|---|
| `assets/manifest.public.json` | `id, title, artist, unit, unitColor` | conceptually yes — the client is told this |
| `assets/manifest.private.json` | `slices[]`, `durationSec`, `neighbours`, `confusableGroup`, `album`, loudness, `sliceIndex` map | **never** |

Neither file is served as a static asset — only `assets/thumb` is
mounted. The private manifest exists only in server memory, and `sliceId → songId` is the
only mapping that can turn a clip back into an answer.

`Catalog.optionView()` exists so route handlers cannot accidentally spread a whole
`CatalogSong` into a response. Use it. The same discipline applies to `soloSessions.ts`:
`serveQuestion()` returns options and a token and explicitly **not** `answerIndex`.

Duration is the subtle one. With 233 songs, a duration is very nearly a unique identifier,
so it is a real oracle and stays private.

---

## Clip tokens

Every clip URL uses a per-session (solo) or per-round (1v1) random token, never a `sliceId`:

```ts
// soloSessions.ts / room.ts — both do this
const token = randomBytes(16).toString('hex')
session.clipTokens.set(token, sliceId)   // room.ts: this.clipTokens
```

The client therefore cannot accumulate a slice ↔ song table across matches. The lookup is
one map access in the route (`session.clipTokens.get(token)`, `room.sliceIdForToken(token)`)
and a `404` on a miss.

`sendClip()` validates the resolved slice id against `/^[0-9A-Z]{20}$/` before touching the
filesystem — that regex is the path-traversal guard, since the id becomes a path segment.

**Clips must never be served from a CDN.** Thumbnails are immutable files with no answer
information, so edge caching them is fine — but a clip is different: a one-shot token has
to be validated by this process, and a CDN both removes that check and caches the same
clip for repeated fetches.

### Serving audio to a screen that has no session

The ambient BGM on the home / lobby / room / result screens needed clips, but those screens have no
solo session and no room, so neither existing token map applies. `ambience.ts` adds a third
one, and the shape of that decision is the reusable part:

```ts
GET /api/ambience/tracks?n=<1..4>
  -> { tracks: [{ clips: string[] }], aacFallback: boolean }
GET /api/ambience/clip/:token[.m4a]
```

- **The response carries no identity at all** — no `songId`, title, slice index or duration.
  A track is an opaque list of tokens. The client knows only "this is audio that plays".
- **Same token discipline as the other two maps**: `randomBytes(16).toString('hex')` into an
  in-process `Map`, 30-minute TTL, 20k cap evicting in insertion order, swept on mint rather
  than on a timer (the `ws/quota.ts` approach — memory tracks recent activity, not uptime).
- **Reuse `formatOf` / `sendClip`.** They carry the path-traversal regex and the `no-store`
  header; a second send path would have to re-earn both.
- **Rejected: HMAC-signed self-contained tokens.** They would avoid server state, but they
  encode the `sliceId` into a string the client holds, so leaking the key breaks the red line
  retroactively. An in-memory map trades a little RAM for that not being possible.

The residual risk is worth stating because it is *accepted*, not overlooked: anyone can pull
clip audio in bulk from this endpoint. They get no labels with it, so it builds no
slice ↔ song table, and the audio is commercially released music that is easier to obtain
from the source. The per-IP limit on `tracks` (`SERVER_CONFIG.ambienceTracksPerMin`) is there
for bandwidth abuse, not for cheating.

---

## Cache headers are a side channel

Three rules in `app.ts` that look like performance tuning and are not:

- **Clips: `cache-control: no-store`.** Whether a request hits cache is itself observable
  timing information.
- **Everything static: `lastModified: false`.** The build order is song-title
  lexicographic order, so `Last-Modified` on the cover thumbs reconstructs the sort. Every
  `fastifyStatic` mount disables it, and `tools/prepare-audio` writes a `CANONICAL_MTIME`
  of `2020-01-01` to the files themselves for the same reason.
- **`index.html`: `cache-control: no-cache`, everything else `immutable, maxAge 365d`.**
  Not secrecy — Vite output is content-hashed, but a cached `index.html` pins a user to a
  build whose hashed assets are gone, which shows up as a white screen.

---

## Grading and question generation are server-side, always

`generateSoloRound` runs in `SoloSessionStore.create()` and the distractors are chosen
there. Generating distractors on the client would hand it the answer, since the answer is
the song the distractors were chosen to resemble.

`answer()` computes `elapsedMs` from the server's own `servedAt` stamp and grades with
`gradeAnswer`. The client's reported timing is display only.

Two timing details worth preserving:

- `serveQuestion()` deliberately does **not** start the clock. The client prefetches the
  next question's audio, and starting the timer on fetch would mean the next question is
  already expired on arrival. `begin()` starts it, and is idempotent
  (`if (!servedAt.has(index))`) so repeated calls cannot buy time.
- The timeout check is `elapsedMs > limitMs + 1500` — a deliberate grace for network and
  render latency, not a rounding artifact.

---

## Reaction-time adjudication (`ws/timing.ts`)

In 1v1 the *client* reports `reactionMs`, because only the client knows when the audio was
actually heard (see the output-latency note in the web spec). That number is precise and
forgeable, so the server derives an independent, honest-but-noisy estimate and uses it as a
floor:

```
serverReaction = arrivedAtServer - roundStartServerTime - owdMs
if (serverReaction < claimedReactionMs - toleranceMs) → clamp
```

The insight the whole design rests on: **a cheater can only make a packet arrive later, never
earlier.** So arrival time minus one-way delay is a lower bound on honest behaviour and can
be used as an anchor.

Three properties that must survive any edit:

- `owdMs` takes `min(reported RTT / 2, self-calibrated floor)`. Under-reporting your RTT
  lowers your own floor and makes you *more* likely to be clamped — lying does not pay.
- `toleranceMs = max(TOL_FLOOR_MS, 3 * jitter)`. It adapts so a player on a bad line is not
  falsely accused, and `TOL_FLOOR_MS = 60` caps a cheater's maximum gain.
- Clamping is **not** a ban. The corrected value is used, the count is kept, and
  `MatchStats.clamped` is published to both players after the match. Social pressure, not
  enforcement — matching the fact that `PlayerView.rttMs` is public for both sides too.

---

## Checklist before adding a response field

1. Does it exist in `manifest.private.json`? Then it is private by default; justify it.
2. Could it distinguish songs? Duration, byte size, slice count, album, neighbour lists —
   all yes.
3. Does it change with build order or file mtime?
4. Does it appear before the answer is revealed? `roundArm` carries a token and a URL and
   nothing else, on purpose.

`tools/prepare-audio` has an automated version of this check
(`assertPublicManifestClean()`), which fails the build if a forbidden key appears in the
public manifest. There is no equivalent assertion on HTTP responses — that is what this
checklist is for.
