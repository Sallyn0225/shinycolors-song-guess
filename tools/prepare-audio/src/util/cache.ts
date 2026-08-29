import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 每 stage 独立的磁盘缓存。
 *
 * key 由「源文件 size + mtime + 该 stage 的版本号」组成，所以：
 *  - 换了源素材会失效
 *  - 改了某个 stage 的算法只 bump 它自己的版本号，不会导致全量重跑
 */
export class StageCache<T> {
  constructor(
    private readonly dir: string,
    private readonly stageVersion: number,
  ) {}

  private file(id: string): string {
    // id 里可能有日文和空格，但不会有路径分隔符（slug() 已处理）
    return path.join(this.dir, `${id}.json`)
  }

  async get(id: string, srcSize: number, srcMtimeMs: number): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.file(id), 'utf8')
      const entry = JSON.parse(raw) as { v: number; size: number; mtime: number; data: T }
      if (entry.v !== this.stageVersion || entry.size !== srcSize || entry.mtime !== srcMtimeMs) {
        return null
      }
      return entry.data
    } catch {
      return null
    }
  }

  async set(id: string, srcSize: number, srcMtimeMs: number, data: T): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(
      this.file(id),
      JSON.stringify({ v: this.stageVersion, size: srcSize, mtime: srcMtimeMs, data }),
      'utf8',
    )
  }
}

/** 简单的单行进度条 */
export class Progress {
  private done = 0
  private failed = 0
  private readonly t0 = performance.now()

  constructor(
    private readonly label: string,
    private readonly total: number,
  ) {}

  tick(note = '', ok = true): void {
    this.done++
    if (!ok) this.failed++
    const frac = this.done / this.total
    const width = 24
    const filled = Math.round(frac * width)
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
    const elapsed = (performance.now() - this.t0) / 1000
    const eta = frac > 0 ? Math.max(0, elapsed / frac - elapsed) : 0
    const line = `[${this.label}] ${bar} ${this.done}/${this.total} eta ${eta.toFixed(0)}s 失败 ${this.failed} ${note}`
    process.stdout.write(`\r${line.slice(0, 150).padEnd(150)}`)
  }

  finish(): number {
    const elapsed = performance.now() - this.t0
    process.stdout.write(`\r${' '.repeat(150)}\r`)
    process.stdout.write(
      `[${this.label}] ${this.done}/${this.total} 完成，失败 ${this.failed}，耗时 ${(elapsed / 1000).toFixed(1)}s\n`,
    )
    return elapsed
  }
}
