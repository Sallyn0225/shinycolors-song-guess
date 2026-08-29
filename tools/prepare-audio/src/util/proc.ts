import { spawn } from 'node:child_process'
import readline from 'node:readline'

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly tail: string[],
  ) {
    super(message)
    this.name = 'FfmpegError'
  }
}

export interface RunOptions {
  /** 逐行回调 stderr。ffmpeg 的分析输出全在 stderr */
  onStderrLine?: (line: string) => void
  /** 逐行回调 stdout */
  onStdoutLine?: (line: string) => void
  timeoutMs?: number
}

const children = new Set<ReturnType<typeof spawn>>()

/** SIGINT 时杀掉所有在跑的子进程，避免留下孤儿 ffmpeg */
let signalHooked = false
function hookSignals() {
  if (signalHooked) return
  signalHooked = true
  const kill = () => {
    for (const c of children) c.kill('SIGKILL')
    process.exit(130)
  }
  process.on('SIGINT', kill)
  process.on('SIGTERM', kill)
}

/**
 * 跑一个子进程并逐行流式读取输出。
 *
 * 必须用 spawn + readline 而不是 exec：analyze 阶段单曲会吐上千行 stderr，
 * exec 的 maxBuffer 迟早会炸。
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<void> {
  hookSignals()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    children.add(child)

    // 保留最后若干行用于报错，不全量驻留内存
    const tail: string[] = []
    const pushTail = (line: string) => {
      tail.push(line)
      if (tail.length > 40) tail.shift()
    }

    if (child.stderr) {
      readline.createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
        pushTail(line)
        opts.onStderrLine?.(line)
      })
    }
    if (child.stdout && opts.onStdoutLine) {
      readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', opts.onStdoutLine)
    }

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          reject(new FfmpegError(`${cmd} timed out after ${opts.timeoutMs}ms`, null, tail))
        }, opts.timeoutMs)
      : undefined

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      children.delete(child)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      children.delete(child)
      if (code === 0) resolve()
      else reject(new FfmpegError(`${cmd} exited with code ${code}`, code, tail))
    })
  })
}

/** 收集 stdout 全文（只用于 ffprobe 这类输出量小且有界的场景） */
export async function runCapture(cmd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const out: string[] = []
  await run(cmd, args, { onStdoutLine: (l) => out.push(l), timeoutMs })
  return out.join('\n')
}

/**
 * 并发执行，限制同时在跑的任务数。
 * 自己实现而不是引 p-limit —— 只有 20 行，少一个依赖。
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return results
}
