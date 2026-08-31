import { useCallback, useEffect, useRef, useState } from 'react'

import { ambience } from '../ambience'
import { audio } from '../audio'
import { saveAudioPrefs } from '../prefs'
import { Icon } from './Icon'

/**
 * 音量。
 *
 * 三条不那么显然的决定：
 *
 * ① **松手要出声。** 首页上没有任何音乐在播，一条纯视觉的滑杆等于让人盲调 ——
 *    定完了也不知道定成了多大，非要进第一题才知道要重来。所以拖完 / 按完键
 *    试听一声，走的是 master，听到的响度就是正式播放的响度。
 *    顺带一提，这一下手势同时把 AudioContext 解锁了，第一题起播反而更快。
 *
 * ② **形状由画出来的那层给，交互由透明的原生 input 给。** 和输入框同一个做法：
 *    clip-path 会把原生控件自己的绘制吃掉，但原生 input 白送的拖动、方向键、
 *    Home/End 和读屏软件认得的 slider 语义，自己实现一遍只会做得更差。
 *
 * ③ **引擎是运行时的唯一真相，localStorage 只是它的副本。** 初值从 `audio` 读
 *    （main.tsx 已经在挂载前把偏好灌进去了），这里只负责往回写。
 */

/** 写盘防抖。localStorage 是同步 IO，拖动时每帧写会让滑块掉帧 */
const SAVE_DEBOUNCE_MS = 300
/** 试听节流。按住方向键会连发 change，没有它就是一串机关枪 */
const PREVIEW_THROTTLE_MS = 180
/** 从静音恢复时，若记下来的位置正好是 0 就抬到这里 —— 取消静音必须真的出声 */
const UNMUTE_FLOOR = 0.35

const TRACK_H = 'max(7px, calc(9 * var(--u)))'
const THUMB_W = 'max(16px, calc(19 * var(--u)))'
const THUMB_H = 'max(20px, calc(24 * var(--u)))'
const CUT = 'max(6px, calc(8 * var(--u)))'
/** 两端斜切的长条。和 .cut-slant 同一个语汇，只是切角跟着自己的高度走 */
const SLANT = `polygon(${CUT} 0, 100% 0, calc(100% - ${CUT}) 100%, 0 100%)`
/** 触摸热区。真 px —— --u 低钳位下 44u 会掉到 36px */
const HIT_H = 44

export function VolumeControl({ className = '' }: { className?: string }) {
  const [level, setLevel] = useState(() => audio.volume)
  const [muted, setMuted] = useState(() => audio.isMuted)

  const saveTimer = useRef(0)
  const lastPreview = useRef(0)
  /** 有一次改动还压在防抖窗口里没落盘。没有它就分不清「刚打开」和「刚调过」 */
  const unsaved = useRef<{ level: number; muted: boolean } | null>(null)

  useEffect(
    () => () => {
      // 点了难度、首页被卸载时，最后一次调整可能还没到防抖时限。
      // 只 clearTimeout 会把它丢掉，所以补写一次 —— 但**只在真的改过时**写，
      // 否则光是路过首页就会往 localStorage 里落一份从没被选择过的默认值
      window.clearTimeout(saveTimer.current)
      if (unsaved.current) saveAudioPrefs(unsaved.current)
    },
    [],
  )

  const commit = useCallback((next: { level: number; muted: boolean }) => {
    setLevel(next.level)
    setMuted(next.muted)
    audio.setVolume(next.level, next.muted)
    // 旁路那条链（开场问候与环境 BGM）不经过 master，滑杆位置对它没有意义，
    // 但**静音必须连它一起切断** —— 点了静音世界还在响就是 bug。
    // `audio.ts` 是禁区不加订阅，所以在这里显式同步一次
    ambience.setMuted(next.muted)
    unsaved.current = next
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveAudioPrefs(next)
      unsaved.current = null
    }, SAVE_DEBOUNCE_MS)
  }, [])

  /** 必须在手势的调用栈里调用：它会顺手 unlock() */
  const preview = useCallback(() => {
    const now = performance.now()
    if (now - lastPreview.current < PREVIEW_THROTTLE_MS) return
    lastPreview.current = now
    void audio.previewTone()
  }, [])

  const pct = Math.round(level * 100)

  return (
    <div className={className} style={{ maxWidth: 'calc(430 * var(--u))' }}>
      <div className="flex items-baseline justify-between gap-4">
        <span
          id="vol-label"
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          ボリューム
        </span>
        {/* 静音时报状态而不是数字：此刻「80%」是错的，它并没有在按 80% 出声 */}
        <span
          aria-hidden
          className={`text-2xs ${muted ? 'text-ink-faint' : 'latin tnum text-ink-sub'}`}
          style={{ letterSpacing: 'var(--tracking-base)' }}
        >
          {muted ? 'ミュート' : `${pct}%`}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const next = muted
              ? { level: level > 0 ? level : UNMUTE_FLOOR, muted: false }
              : { level, muted: true }
            commit(next)
            // 恢复出声时给一声确认；静音时当然不出声
            if (!next.muted) preview()
          }}
          aria-pressed={muted}
          aria-label={muted ? '取消静音' : '静音'}
          className="tap-line shrink-0 text-primary transition-colors duration-300 ease-[var(--ease-prism)] hover:text-accent-ink"
        >
          <Icon name={muted ? 'mute' : 'volume'} size="calc(21 * var(--u))" />
        </button>

        {/* 斜切元素上画的 outline 会被裁掉，焦点环由这层的 :has(:focus-visible) 代画 */}
        <span className="cut-shadow-sm min-w-0 flex-1">
          <span className="relative flex items-center" style={{ height: HIT_H }}>
            {/* 未点亮的轨道。与 PrismRail 的底轨同色 —— 同一件事：还没走到的那一段 */}
            <span
              aria-hidden
              className="block w-full"
              style={{ height: TRACK_H, clipPath: SLANT, background: 'rgb(162 162 192 / .34)' }}
            >
              {/*
                已选中的一段。整条渐变常在，靠 inset 决定露出多少 —— 与 PrismRail 同一个做法。
                不用「改宽度」是因为宽度趋近 0 时斜切多边形会自交，滑到最左边会翻出一个三角。

                颜色是紫→深青，不是 --grad-cta。--grad-cta 亮端 #00b4f0 压在这条浅轨道上
                只有 1.9:1，而「填到哪」正是这个控件要读出来的信息，非文字对比度得有 3:1。
                换成压深过的 accent-ink 是 3.95:1，紫端 4.75:1，两头都过。
              */}
              <span
                className="block h-full w-full transition-[background] duration-300"
                style={{
                  background: muted
                    ? 'var(--color-primary-lt)'
                    : 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-accent-ink) 100%)',
                  clipPath: `inset(0 ${100 - pct}% 0 0)`,
                }}
              />
            </span>

            {/*
              滑块。静音时**不跟着变淡** —— 位置得一直读得出来，
              而且它是这里唯一稳过 3:1 的部件（对轨道 4.75:1、对场地白 4.9:1）。
              它比轨道高出一截，大半身子落在页面底色上，所以与填充同色也分得开。
            */}
            <span
              aria-hidden
              className="absolute block"
              style={{
                width: THUMB_W,
                height: THUMB_H,
                left: `calc(${pct}% + ${THUMB_W} / 2 - ${pct / 100} * ${THUMB_W})`,
                transform: 'translateX(-50%)',
                clipPath: SLANT,
                background: 'var(--color-primary)',
                boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .1)',
              }}
            />

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => {
                // 拖动本身就是「我要听见」的意思，顺手解除静音，不用再点一次喇叭
                commit({ level: Number(e.target.value) / 100, muted: false })
              }}
              // 只在松手 / 松键时试听：拖动过程中每帧来一声是机关枪，
              // 而拖动时填充条已经把位置讲清楚了
              onPointerUp={preview}
              onKeyUp={preview}
              aria-labelledby="vol-label"
              aria-valuetext={muted ? '已静音' : `${pct}%`}
              className="sc-range absolute inset-0 block w-full cursor-pointer opacity-0"
              style={{ ['--thumb-w' as string]: THUMB_W }}
            />
          </span>
        </span>
      </div>
    </div>
  )
}
