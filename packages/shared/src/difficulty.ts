/**
 * 难度参数。全部集中在这里，调手感只改这一个文件。
 *
 * 两档的区分**不只靠片段长度**——音乐辨识游戏里片段短于 5 秒就会从「考记忆」
 * 滑向「拼运气」，所以困难的片段长度定在 6 秒（而不是更短），
 * 难度梯度主要来自：题目数量、答题时限、重听次数、干扰项策略、片段取自曲子的哪个部位。
 */
export const DIFFICULTIES = ['easy', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/** 干扰项策略。放服务端执行——放前端等于把正确答案送给客户端 */
export type DistractorStrategy =
  /** 刻意选 unit 不同的曲子，降低混淆 */
  | 'cross-unit'
  /** 同组合优先 */
  | 'same-unit'
  /** 同组合 + 曲名高度相似（如 散花-sanka- / 紅花-benibana-） */
  | 'same-unit-and-similar-title'

/**
 * 片段取自曲子的哪个部位。切片时已按 difficultyHint 打过分：
 * 高能量段多半是副歌（好认），低能量段多半是前奏/间奏（难认）。
 */
export type SlicePositionBias =
  /** 偏高能量段（副歌） */
  | 'chorus'
  /** 不挑，全池随机 */
  | 'mixed'
  /** 偏低能量段（前奏、间奏） */
  | 'sparse'

export interface DifficultyPreset {
  id: Difficulty
  label: string
  /** 每轮题目数 */
  questionCount: number
  /** 播放的片段长度（秒）。切片文件恒为 15 秒，这里只控制播放端截断 */
  clipSeconds: number
  /** 答题时限（秒） */
  answerSeconds: number
  /** 选项数 */
  optionCount: number
  /** 允许重听的次数（不含首次播放） */
  replays: number
  distractors: DistractorStrategy
  slicePosition: SlicePositionBias
}

export const DIFFICULTY_PRESETS: Record<Difficulty, DifficultyPreset> = {
  easy: {
    id: 'easy',
    label: '简单',
    questionCount: 10,
    clipSeconds: 8,
    answerSeconds: 15,
    optionCount: 4,
    replays: 2,
    distractors: 'cross-unit',
    slicePosition: 'chorus',
  },
  hard: {
    id: 'hard',
    label: '困难',
    questionCount: 20,
    // 最初 4 秒过短——音乐辨识低于 5 秒会从「考记忆」滑向「拼运气」。试过 5 秒仍偏紧，定 6 秒
    clipSeconds: 6,
    answerSeconds: 10,
    optionCount: 4,
    replays: 1,
    distractors: 'same-unit-and-similar-title',
    slicePosition: 'sparse',
  },
}

/**
 * 重听是否暂停答题倒计时。
 * false = 重听要付出时间代价，是一个真实的取舍。
 */
export const REPLAY_PAUSES_TIMER = false

/** 联机「空札领地战」的默认参数 */
export const KARUTA_DEFAULTS = {
  /**
   * 联机标称的难度档，只用于大厅展示与选曲口径；
   * 联机的节奏由下面的 roundWindowSeconds 决定，不读这一档的 clipSeconds
   */
  difficulty: 'hard' as Difficulty,
  /** 本局从曲库抽多少首（受易混淆组约束：同组最多取 1 首） */
  poolSize: 30,
  /** 其中做成场上「札」的数量 */
  fieldCards: 24,
  /** 每人自陣的牌数 = fieldCards / 2 */
  ownCards: 12,
  /** 空札数量 = poolSize - fieldCards。只播放、场上没有对应牌 */
  karafuda: 6,
  /** 记忆阶段时长（秒），可自由摆放自陣牌 */
  memorizeSeconds: 30,
  /**
   * 每回合音频窗口（秒）。同时是播放长度和抢牌时限——联机只有这一个旋钮，
   * 前端播多久、服务端判多久都读它。
   *
   * 独立于单机的 clipSeconds —— 抢牌的节奏和单人答题的节奏是两个不同的旋钮，
   * 绑在一起会导致调其中一个就意外改动另一个。
   *
   * 从 6 秒放宽到 8：6 秒里要同时完成「认出曲子」和「在自陣/敵陣里找到那张牌」
   * 两件事，比单机的四选一更吃时间，实测偏紧。
   */
  roundWindowSeconds: 8,
  /** 窗口结束后的宽限（秒），到点服务器用手上有的输入结算，永不等待客户端 */
  graceSeconds: 2,
  /**
   * 挑送り札的时限（秒）。超时回落到「送自陣待得最久的那张」——
   * 和 MVP 的自动规则完全一致，所以慢或掉线的人不会被卡住，只是失去挑选权。
   */
  okuriSeconds: 10,
  /** 掉线后保留座位的宽限（秒）。到点判负 */
  disconnectGraceSeconds: 60,
  /** 反应时间差小于此值视为同时，牌判给该牌所在领地的一方 */
  tieEpsilonMs: 25,
  /** 低于此反应时间视为抢跑——辨认一首还没听到的歌是不可能的 */
  minHumanReactionMs: 150,
} as const
