# Error Handling

> A build tool has a different contract from a server: it may stop the world, but it must
> never stop it *quietly*, and it must never lose 40 minutes of encoding to one bad file.

---

## `FfmpegError` carries the tail

```ts
// util/proc.ts
export class FfmpegError extends Error {
  constructor(message: string, readonly code: number | null, readonly tail: string[])
}
```

`run()` keeps the last 40 stderr lines in a ring buffer and attaches them. That is
deliberate: ffmpeg's actual diagnosis is usually in the last few lines, while the first
thousand are banner and progress. Never keep the whole stream — the analyze pass emits
thousands of lines per song.

A `null` `code` means the timeout fired and the child was `SIGKILL`ed. Every invocation sets
a timeout (`60_000` for encoding, `120_000` for analysis); an ffmpeg call without one can
hang the whole build on a single corrupt file.

---

## Per-item failure is collected, not thrown

Song-level stages catch per item, count, and keep going:

```ts
const failures: string[] = []
// ... inside mapConcurrent
catch (e) { failures.push(...); bar.tick(title, false) }
// ... after
if (failures.length > 0) { print them; process.exitCode = 1 }
```

`Progress.tick(note, ok)` tracks the failure count and shows it live. The run completes, the
report lists every failure, and the **exit code is 1** so a script or CI notices.

This is the required shape for anything iterating over the library. One unreadable mp3 must
not cost the other 233 songs their encode.

---

## `process.exitCode = 1` vs `process.exit(2)`

| Situation | Response |
|---|---|
| bad CLI usage (unknown stage) | `console.error` + `process.exit(2)` immediately |
| item-level failures during a stage | collect, report, `process.exitCode = 1`, finish the run |
| anti-cheat self-check failed | report, `process.exitCode = 1` |
| a precondition that makes the stage meaningless | `throw` |

Use `process.exitCode = 1` (not `process.exit(1)`) for the middle cases — it lets the
remaining output flush and the remaining stages report.

---

## Throw when continuing is meaningless

```ts
throw new Error(`songs/ 下没有找到任何 Page 目录：${SONGS_ROOT}`)          // scan.ts
throw new Error(`AAC 切片 … 超过 SLICE.aacPadToBytes=…；请调大该常量后重跑`) // slice.ts#padAac
```

Both name the offending path or constant **and the fix**. That is the house style for a
fatal message here: a build error that does not tell you what to run next costs a debugging
session.

`padAac` is worth singling out. It could truncate, skip, or warn; it throws, because an
unpadded file is exactly the leak the padding exists to prevent, and a warning in a
1404-file run scrolls past.

---

## Missing-cache messages point at the command

```ts
`${missing.length} 首缺少 analyze/slice 缓存，请先跑 pnpm assets all（例：${missing[0]}）`
`[slice] ⚠ ${missing.length} 首没有切片缓存，先跑一次 pnpm assets slice`
`[slice] ⚠ 记得跟一句 pnpm assets manifest，否则服务端还在用旧 id`
```

Every "you are missing an upstream artifact" path names the stage to run and gives one
example item. Keep doing this — stages are independently runnable precisely so that a user
can act on such a message.

The last one is a warning about a *consistency* hazard rather than a failure: rotating slice
ids without rebuilding the manifest leaves the server serving ids that no longer exist.

---

## Empty catches must say why

```ts
catch { /* 文件可能编码失败而不存在，selfCheck 会抓 */ }   // normalizeMtimes
catch { /* 已在缺失检查里覆盖 */ }                          // selfCheck's probe loop
catch { /* 落到下面重新扫描 */ }                            // loadMeta
```

Each names the other mechanism that covers the case. A bare `catch {}` with no comment is
not acceptable in this package — it is how a silently empty build happens.

---

## Subprocess cleanup

`util/proc.ts` registers SIGINT/SIGTERM handlers once (`hookSignals()`) that `SIGKILL` every
tracked child and exit 130. Without it, Ctrl-C during a 12-way parallel encode leaves a
dozen orphaned ffmpeg processes chewing the CPU. Any new subprocess must go through `run()`
/ `runCapture()` so it joins that set.
