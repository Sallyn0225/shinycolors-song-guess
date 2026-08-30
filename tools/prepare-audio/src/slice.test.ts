import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { SLICE } from './config.js'
import { aacPath, newSliceId, padAac, slicePath } from './slice.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scg-slice-'))

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function write(name: string, size: number): Promise<string> {
  const f = path.join(tmp, name)
  await fs.writeFile(f, Buffer.alloc(size, 1))
  return f
}

describe('切片 id 与路径', () => {
  it('id 是 20 字符 Crockford base32（无 I/L/O/U）', () => {
    for (let i = 0; i < 200; i++) expect(newSliceId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
  })

  it('按前 2 字符分目录，opus 与 m4a 同名同目录', () => {
    const id = 'ABCDEFGHJKMNPQRSTVWX'
    expect(slicePath(id).endsWith(path.join('AB', `${id}.opus`))).toBe(true)
    expect(aacPath(id).endsWith(path.join('AB', `${id}.m4a`))).toBe(true)
  })
})

// AAC 编码器给不了硬 CBR，字节数会在 184~198KB 之间浮动 ——
// 1404 个切片的大小几乎就是唯一指纹，和 Opus 用 -vbr off 挡掉的是同一条旁路
describe('AAC 字节数补齐', () => {
  it('补到与目标完全一致，且 free box 头写的是自身长度', async () => {
    const f = await write('a.m4a', SLICE.aacPadToBytes - 5000)
    await padAac(f)

    const buf = await fs.readFile(f)
    expect(buf.length).toBe(SLICE.aacPadToBytes)
    const box = buf.subarray(SLICE.aacPadToBytes - 5000)
    expect(box.readUInt32BE(0)).toBe(5000)
    expect(box.subarray(4, 8).toString('ascii')).toBe('free')
  })

  it('大小不同的文件补完之后一样大', async () => {
    const files = await Promise.all(
      [1000, 20_000, 60_123].map((n, i) => write(`b${i}.m4a`, SLICE.aacPadToBytes - n)),
    )
    for (const f of files) await padAac(f)
    const sizes = await Promise.all(files.map((f) => fs.stat(f).then((s) => s.size)))
    expect(new Set(sizes).size).toBe(1)
  })

  it('已经是目标大小就不再追加', async () => {
    const f = await write('c.m4a', SLICE.aacPadToBytes)
    await padAac(f)
    expect((await fs.stat(f)).size).toBe(SLICE.aacPadToBytes)
  })

  // free box 头本身占 8 字节，凑不出一个合法 box 就没法补齐 ——
  // 这时必须报错而不是留一个大小不一致的文件悄悄上线
  it('文件超过目标（或差不到一个 box 头）时报错而不是静默放过', async () => {
    for (const size of [SLICE.aacPadToBytes + 1, SLICE.aacPadToBytes - 3]) {
      const f = await write(`d${size}.m4a`, size)
      await expect(padAac(f)).rejects.toThrow(/aacPadToBytes/)
    }
  })
})
