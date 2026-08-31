/**
 * 本地偏好。
 *
 * 音量是**设备**属性而不是会话属性：同一个人在电脑上和手机上该各记各的，
 * 而在同一台设备上换了标签页、隔了一周回来，音量都该还是上次那个。
 * 所以这里用 localStorage —— 与 `net/ws.ts` 的座位凭证正好相反，
 * 那个必须走 sessionStorage，否则同机开两个窗口会互相抢座位。
 *
 * 读写一律包 try/catch。Safari 无痕模式下 `localStorage` 这个对象存在、
 * `setItem` 却直接抛 QuotaExceededError —— 不接住的话第一次拖音量就白屏。
 */

const KEY = 'scg.audio'

export interface AudioPrefs {
  /** 滑杆位置 0~1。**不是增益本身**，两者之间隔着一条平方律，见 audio.ts */
  level: number
  muted: boolean
  /**
   * 首页 / 大厅 / 房间那三屏的环境 BGM 开关。
   *
   * 它与 `muted` 是**两件事**，不能合并：BGM 的音量固定、不受滑杆管（见 ambience.ts），
   * 所以「只想关掉背景音乐、题目照常出声」这个诉求，滑杆和静音都表达不了。
   * 反过来静音必须连 BGM 一起切断——点了静音世界还在响就是 bug。
   */
  bgmOn: boolean
  /**
   * UI 音效开关（click / 揭晓正误 / 结算那一层）。
   * 与 `bgmOn` 各管各的：关 BGM 不等于想要一个哑巴界面，反过来也一样。
   * 与 `muted` 的关系同上——静音必须连它一起切断。
   */
  sfxOn: boolean
}

/**
 * 首次进来的默认位置。
 *
 * 0.5 而不是满格：实测（没有音量控件、等同满格的那个版本）戴耳机偏响。
 * 过平方律之后是 −12dB，安全且离「小得听不清」还很远；
 * 行程两侧都留了余量，第一次听完往上往下都调得动。
 */
export const DEFAULT_AUDIO_PREFS: AudioPrefs = { level: 0.5, muted: false, bgmOn: true, sfxOn: true }

export function loadAudioPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_AUDIO_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AUDIO_PREFS
    const { level, muted, bgmOn, sfxOn } = parsed as Partial<AudioPrefs>
    return {
      // NaN / Infinity / 越界值都当没存过。存进 gain.value 的 NaN 会让
      // 整个 AudioContext 静默失声，且不报错——比回落到默认难查一万倍
      level:
        typeof level === 'number' && Number.isFinite(level)
          ? Math.min(1, Math.max(0, level))
          : DEFAULT_AUDIO_PREFS.level,
      muted: muted === true,
      // 这一条比 muted 晚加，老用户存的 JSON 里根本没有它。
      // 因此判的是「显式存过 false 才关」，缺字段一律回落到默认的开
      bgmOn: bgmOn !== false,
      // 同上，比 bgmOn 更晚加
      sfxOn: sfxOn !== false,
    }
  } catch {
    // 存储被策略禁用、内容是上个版本写的读不了、JSON 坏了——一律回落到默认。
    // 首页起不来的代价远大于丢一次音量设定
    return DEFAULT_AUDIO_PREFS
  }
}

/**
 * 只写自己改动的那几个字段。
 *
 * 收 `Partial` 而不是整份，是因为现在有**三个**互不相识的控件在存这份偏好：
 * 音量滑杆管 `level` / `muted`，光带上方那两个开关各管 `bgmOn` / `sfxOn`。
 * 谁整份覆盖谁就会把对方刚存的值抹掉——表现是「关了 BGM，一拖音量它自己又开了」。
 */
export function saveAudioPrefs(patch: Partial<AudioPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadAudioPrefs(), ...patch }))
  } catch {
    /* 无痕模式写不进去。设定在本次会话里照常生效，只是留不到下次 */
  }
}
