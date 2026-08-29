import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SoloSong } from '@scg/game-core'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '..', '..', '..')
export const ASSETS_ROOT = path.join(REPO_ROOT, 'assets')

interface PrivateSong {
  id: string
  title: string
  album: string
  unit: string | null
  units: string[]
  performers: string[]
  confusableGroup: string | null
  durationSec: number
  slices: Array<{ sliceId: string; index: number; startSec: number; durationSec: number }>
  neighbours: Array<{ id: string; sim: number }>
}

interface PublicSong {
  id: string
  title: string
  artist: string
  unit: string | null
  unitColor: string | null
}

export interface CatalogSong {
  id: string
  title: string
  artist: string
  unit: string | null
  unitColor: string | null
  album: string
  confusableGroup: string | null
  slices: Array<{ sliceId: string; index: number }>
}

/**
 * 曲库。
 *
 * private manifest 只在服务器进程内存里，**永不经 HTTP 暴露**。
 * 客户端能拿到的只有曲名/演唱者/组合色（渲染选项和牌面必需），
 * 拿不到 sliceId、时长、切片数——时长几乎唯一标识曲目，是真实的旁路。
 */
export class Catalog {
  private constructor(
    readonly songs: CatalogSong[],
    readonly byId: Map<string, CatalogSong>,
    readonly units: Array<{ id: string; name: string; color: string | null }>,
    /** 出题输入，交给 game-core 的纯函数 */
    readonly soloSongs: SoloSong[],
  ) {}

  static async load(assetsRoot = ASSETS_ROOT): Promise<Catalog> {
    const [priv, pub] = await Promise.all([
      fs
        .readFile(path.join(assetsRoot, 'manifest.private.json'), 'utf8')
        .then((s) => JSON.parse(s) as { songs: PrivateSong[] }),
      fs
        .readFile(path.join(assetsRoot, 'manifest.public.json'), 'utf8')
        .then(
          (s) =>
            JSON.parse(s) as {
              songs: PublicSong[]
              units: Array<{ id: string; name: string; color: string | null }>
            },
        ),
    ])

    const pubById = new Map(pub.songs.map((s) => [s.id, s]))
    const songs: CatalogSong[] = priv.songs.map((p) => {
      const u = pubById.get(p.id)
      return {
        id: p.id,
        title: p.title,
        artist: u?.artist ?? '',
        unit: p.unit,
        unitColor: u?.unitColor ?? null,
        album: p.album,
        confusableGroup: p.confusableGroup,
        slices: p.slices.map((s) => ({ sliceId: s.sliceId, index: s.index })),
      }
    })

    const soloSongs: SoloSong[] = priv.songs.map((p) => ({
      id: p.id,
      unit: p.unit,
      album: p.album,
      confusableGroup: p.confusableGroup,
      neighbours: p.neighbours,
      sliceCount: p.slices.length,
    }))

    if (songs.length === 0) {
      throw new Error(`曲库为空——请先跑 pnpm assets all（找的是 ${assetsRoot}）`)
    }

    return new Catalog(songs, new Map(songs.map((s) => [s.id, s])), pub.units, soloSongs)
  }

  sliceIdFor(songId: string, sliceIndex: number): string | null {
    const song = this.byId.get(songId)
    if (!song) return null
    return song.slices.find((s) => s.index === sliceIndex)?.sliceId ?? song.slices[0]?.sliceId ?? null
  }

  /** 下发给客户端的选项，只含渲染所需字段 */
  optionView(id: string): { id: string; title: string; artist: string; unitColor: string | null } | null {
    const s = this.byId.get(id)
    if (!s) return null
    return { id: s.id, title: s.title, artist: s.artist, unitColor: s.unitColor }
  }
}
