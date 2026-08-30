/** 一首歌在扫描阶段得到的原始事实 */
export interface ScannedSong {
  /** 稳定 id：slug(title) + 短哈希。改目录名不会变 */
  id: string
  /** 规范曲名：ID3 title 去掉尾部可选的 ' (Off Vocal)' */
  title: string
  /** ID3 title 原文 */
  rawTitle: string
  /** ID3 artist 原文。语义不可靠——96/233 填的是作曲/编曲者 */
  rawArtist: string
  album: string
  /** 源 mp3 绝对路径（可能超过 260 字符） */
  mp3Path: string
  /** 源封面 jpg 绝对路径 */
  jpgPath: string
  durationSec: number
  srcSize: number
  srcMtimeMs: number
  /** 所在的 Page 目录名，仅用于溯源 */
  page: string
  /** 顶层歌曲目录名，仅用作 join key 和交叉校验 */
  dirName: string
}

/** 演唱者决议结果 */
export interface UnitResolution {
  /** 单一组合 id；跨组合合同曲或未确证时为 null */
  unit: string | null
  /** 涉及的全部组合（跨组合合作会有多个） */
  units: string[]
  /** 已知的演唱角色名。跨组合选拔曲用它 */
  performers: string[]
  /** 决议走的是哪条规则，用于审计 */
  source:
    | 'override'
    | 'artist-exact'
    | 'artist-split'
    | 'artist-cv'
    | 'seiyuu-table'
    | 'album-series'
    | 'album-pattern'
    | 'album-exact'
    | 'title-paren'
    | 'unresolved'
}

/** 一首歌的完整元数据（scan + resolve 之后） */
export interface SongMeta extends ScannedSong, UnitResolution {
  /** 显示用艺术家。solo 曲会被规范成『角色名 (CV.声优名)』 */
  displayArtist: string
  /**
   * 易混淆组 key。同组内的曲子去人声后难以区分，
   * 抽题/发牌时同组最多取 1 首，且永不互为干扰项。
   * 无同伴时为 null。
   */
  confusableGroup: string | null
}

/** ebur128 + silencedetect 合并分析的结果 */
export interface AnalysisResult {
  songId: string
  /** mono 降混后的 integrated loudness（LUFS）。必须 mono——输出是 -ac 1 */
  integratedLufs: number
  /** mono 降混后的 true peak（dBFS） */
  truePeakDbfs: number
  lra: number
  /** 静音区间 [start, end]（秒） */
  silences: Array<[number, number]>
}

export interface SliceSpec {
  /** 20 字符 CSPRNG 随机 id。文件名即此，客户端无法反推曲名 */
  sliceId: string
  index: number
  startSec: number
  durationSec: number
  gainDb: number
  /** 降级等级 0~5，0 = 未降级。>=3 需人工复核 */
  degradeLevel: number
}

export interface SongAssets {
  meta: SongMeta
  analysis: AnalysisResult
  slices: SliceSpec[]
}
