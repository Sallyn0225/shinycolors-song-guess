import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadTables } from './resolveUnit.js'
import {
  loadIngestBatches,
  planIngest,
  type IngestBatchSpec,
  type IngestTrackSpec,
} from './ingest.js'

const REPO_ROOT = path.join(path.sep, 'repo')
const SONGS_ROOT = path.join(REPO_ROOT, 'songs')

function track(over: Partial<IngestTrackSpec> = {}): IngestTrackSpec {
  return {
    file: 'src/a.wav',
    title: '曲A',
    album: 'a',
    character: '櫻木真乃',
    cover: 'src/cover.jpg',
    ...over,
  }
}

function batch(tracks: IngestTrackSpec[], over: Partial<IngestBatchSpec> = {}): IngestBatchSpec {
  return {
    id: 'test-batch',
    sourceDir: '闪猜歌即将上线曲目',
    page: '闪彩off vocal无重复_Page26',
    albums: { a: 'THE IDOLM@STER SHINY COLORS 测试盘' },
    tracks,
    ...over,
  }
}

async function plan(tracks: IngestTrackSpec[], files?: string[], over: Partial<IngestBatchSpec> = {}) {
  const tables = await loadTables()
  const b = batch(tracks, over)
  const inventory = files ?? b.tracks.flatMap((t) => [t.file, t.cover])
  return planIngest({ batch: b, tables, files: inventory, repoRoot: REPO_ROOT, songsRoot: SONGS_ROOT })
}

describe('planIngest · 署名与产物路径', () => {
  it('单人曲：署名补 CV，目录名与文件名同 stem', async () => {
    const { jobs, problems } = await plan([track({ title: 'MAGICAL FOREST', file: 'src/mf.wav' })])
    expect(problems).toEqual([])
    expect(jobs).toHaveLength(1)
    const job = jobs[0]!
    expect(job.artist).toBe('櫻木真乃 (CV.関根瞳)')
    expect(job.album).toBe('THE IDOLM@STER SHINY COLORS 测试盘')
    expect(job.outDir).toBe(path.join(SONGS_ROOT, '闪彩off vocal无重复_Page26', 'MAGICAL FOREST (Off Vocal) - 櫻木真乃 (CV.関根瞳)'))
    expect(job.outMp3).toBe(path.join(job.outDir, 'MAGICAL FOREST (Off Vocal) - 櫻木真乃 (CV.関根瞳).mp3'))
    expect(job.outJpg).toBe(path.join(job.outDir, 'MAGICAL FOREST (Off Vocal) - 櫻木真乃 (CV.関根瞳).jpg'))
    expect(job.srcWav).toBe(path.join(REPO_ROOT, '闪猜歌即将上线曲目', 'src/mf.wav'))
  })

  it('合同曲：多署名用 / 连接，目录名里换成 _', async () => {
    const { jobs, problems } = await plan([
      track({
        title: '泡沫に染まる',
        character: undefined,
        performers: ['風野灯織', '斑鳩ルカ'],
        file: 'src/u.wav',
      }),
    ])
    expect(problems).toEqual([])
    const job = jobs[0]!
    expect(job.artist).toBe('風野灯織 (CV.近藤玲奈)/斑鳩ルカ (CV.川口莉奈)')
    expect(path.basename(job.outDir)).toBe(
      '泡沫に染まる (Off Vocal) - 風野灯織 (CV.近藤玲奈)_斑鳩ルカ (CV.川口莉奈)',
    )
  })

  it('角色名的空格/括号差异由 normalizeName 吃掉', async () => {
    const { jobs, problems } = await plan([track({ character: '浅倉透', file: 'src/p.wav' })])
    expect(problems).toEqual([])
    expect(jobs[0]!.artist).toBe('浅倉透 (CV.和久井優)')
  })
})

describe('planIngest · 规划期校验', () => {
  it('源目录里有未列入的 wav 时拒绝执行', async () => {
    const { jobs, problems } = await plan([track()], ['src/a.wav', 'src/cover.jpg', 'src/漏掉的.wav'])
    expect(jobs).toHaveLength(1)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/漏掉的.wav')
    expect(problems[0]).toContain('未列入')
  })

  it('源文件 / 封面缺失各自报错', async () => {
    const { problems } = await plan([track({ file: 'src/nope.wav', cover: 'src/nope.jpg' })], [])
    expect(problems.join('\n')).toContain('找不到源文件『src/nope.wav』')
    expect(problems.join('\n')).toContain('找不到封面『src/nope.jpg』')
  })

  it('角色名不在 units.json 里就报错并指名', async () => {
    const { jobs, problems } = await plan([track({ character: '櫻木真乃乃' })])
    expect(jobs).toEqual([])
    expect(problems.join('\n')).toContain('櫻木真乃乃')
    expect(problems.join('\n')).toContain('units.json')
  })

  it('character 与 performers 必须二选一', async () => {
    const both = await plan([track({ performers: ['櫻木真乃'] })])
    expect(both.problems.join('\n')).toContain('二选一')
    const neither = await plan([track({ character: undefined })])
    expect(neither.problems.join('\n')).toContain('二选一')
  })

  it('曲名重复、曲名带 (Off Vocal) 后缀、album key 不存在都报错', async () => {
    const dup = await plan([track({ file: 'src/a.wav' }), track({ file: 'src/b.wav' })], ['src/a.wav', 'src/b.wav', 'src/cover.jpg'])
    expect(dup.problems.join('\n')).toContain('重复')

    const suffix = await plan([track({ title: '曲A (Off Vocal)' })])
    expect(suffix.problems.join('\n')).toContain('(Off Vocal)')

    const album = await plan([track({ album: 'nope' })])
    expect(album.problems.join('\n')).toContain('nope')
  })

  it('一条坏数据只挡它自己，同批次其它曲目照常产出', async () => {
    const { jobs, problems } = await plan([
      track({ file: 'src/a.wav' }),
      track({ file: 'src/b.wav', title: '曲B', character: '田中摩美美' }),
    ])
    expect(jobs).toHaveLength(1)
    expect(path.basename(jobs[0]!.outMp3)).toBe('曲A (Off Vocal) - 櫻木真乃 (CV.関根瞳).mp3')
    expect(problems).toHaveLength(1)
  })
})

describe('data/ingest.json', () => {
  it('登记的每个批次都能通过规划期校验，且产物目录名与署名自洽', async () => {
    const tables = await loadTables()
    const batches = await loadIngestBatches()
    expect(batches.length).toBeGreaterThan(0)

    for (const b of batches) {
      // 源素材不在 git 里（fresh clone 也有 data/ 却没有那 2GB），所以用登记表自己造文件清单
      const files = [...new Set(b.tracks.flatMap((t) => [t.file, t.cover]))]
      const { jobs, problems } = planIngest({
        batch: b,
        tables,
        files,
        repoRoot: REPO_ROOT,
        songsRoot: SONGS_ROOT,
      })
      expect(`${b.id}: ${problems.join('; ')}`).toBe(`${b.id}: `)
      expect(jobs).toHaveLength(b.tracks.length)

      for (const job of jobs) {
        const stem = `${job.title} (Off Vocal) - ${job.artist.replace(/\//g, '_')}`
        expect(path.basename(job.outDir)).toBe(stem)
        expect(path.basename(job.outMp3)).toBe(`${stem}.mp3`)
        // 署名里不该出现空 CV 或 undefined
        expect(job.artist).not.toMatch(/\(\)|undefined/)
        for (const credit of job.artist.split('/')) expect(credit).toMatch(/^.+ \(CV\..+\)$/)
      }
    }
  })
})
