import { describe, expect, it } from 'vitest'

import { PEAK_BUDGET, VOICES, type SfxName } from './sfxVoices'

/**
 * 音色表的约束测试。
 *
 * 合成本身没法在这里验证 —— jsdom 没有 Web Audio，渲染器一行都跑不起来。
 * 但**每一次实际听到的坏声音都能追回到这张表上的一个数**，所以约束定在表上：
 * 少一个名字（调用点静默无声）、gain 收到 0（指数斜坡整条曲线失效）、
 * 一声里叠太多（峰值削顶）、非正弦忘了低通（高频毛刺）——
 * 这四类都是能用一条断言挡住的。
 */

/** 表里应当有的全部音效名。写死一份，漏掉一个会被下面的双向比对抓到 */
const NAMES: SfxName[] = [
  'click',
  'correct',
  'wrong',
  'tick',
  'go',
  'fanfare',
  'take',
  'otetsuki',
  'foeTake',
  'okuri',
  'matchStart',
  'win',
  'lose',
  'draw',
  'peerOn',
  'peerOff',
]

describe('VOICES', () => {
  it('每个音效名都有非空定义，且表里没有多余的名字', () => {
    for (const name of NAMES) {
      const voice = VOICES[name]
      expect(voice, `缺少音色 ${name}`).toBeDefined()
      expect(voice.parts.length, `${name} 没有任何 part`).toBeGreaterThan(0)
    }
    expect(Object.keys(VOICES).sort()).toEqual([...NAMES].sort())
  })

  it.each(NAMES)('%s 的每个 part 的 gain 都大于 0', (name) => {
    // 包络收尾走 exponentialRampToValueAtTime，目标值为 0 会让整条曲线失效
    // （部分实现直接抛 RangeError）。峰值本身也就不能是 0
    for (const part of VOICES[name].parts) expect(part.gain).toBeGreaterThan(0)
  })

  it.each(NAMES)('%s 的峰值总和不超过配平上限', (name) => {
    const sum = VOICES[name].parts.reduce((acc, p) => acc + p.gain, 0)
    expect(sum).toBeLessThanOrEqual(PEAK_BUDGET)
  })

  it.each(NAMES)('%s 的时间参数合法且总时长在一秒以内', (name) => {
    // 音效不是音乐：超过一秒的「提示音」会盖住它本该注解的那件事
    let end = 0
    for (const part of VOICES[name].parts) {
      expect(part.at).toBeGreaterThanOrEqual(0)
      expect(part.dur).toBeGreaterThan(0)
      end = Math.max(end, part.at + part.dur)
    }
    expect(end).toBeLessThanOrEqual(1)
  })

  it.each(NAMES)('%s 里非正弦的 tone 都配了低通', (name) => {
    for (const part of VOICES[name].parts) {
      if (part.kind !== 'tone' || part.wave === 'sine') continue
      expect(part.lowpass, `${name} 的 ${part.wave} 缺少 lowpass`).toBeGreaterThan(0)
    }
  })

  it.each(NAMES)('%s 的 jitter 若存在则是一个小比例', (name) => {
    const jitter = VOICES[name].jitter
    if (jitter === undefined) return
    // 音高随机化只为了消掉机械重复感；大到能听出走调就变成另一件事了
    expect(jitter).toBeGreaterThan(0)
    expect(jitter).toBeLessThanOrEqual(0.05)
  })

  it('抢牌类音效带 jitter，其余不带', () => {
    // 连着十几个回合都会响的只有这两个，也只有它们需要随机化
    const jittered = NAMES.filter((n) => VOICES[n].jitter !== undefined)
    expect(jittered.sort()).toEqual(['otetsuki', 'take'])
  })
})
