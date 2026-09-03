import { describe, expect, it } from 'vitest'

import { ROOM_NAME_MAX, clientMsgSchema, sanitizeRoomName } from './protocol.js'

/**
 * 测试里的不可见字符一律用 `String.fromCodePoint` 构造，**不要写字面量**。
 * 字面控制字符和零宽字符写进源码之后就再也看不见了，
 * 下一个人读到这个文件时无法判断断言到底在测什么。
 */
const ch = (cp: number) => String.fromCodePoint(cp)

const ZWSP = ch(0x200b) // 零宽空格
const RLO = ch(0x202e) // 从右到左覆写
const BOM = ch(0xfeff)
const NUL = ch(0x00)
const BEL = ch(0x07)

describe('sanitizeRoomName', () => {
  it('保留正常的中日英文与 emoji', () => {
    expect(sanitizeRoomName('放课后climax女孩')).toBe('放课后climax女孩')
    expect(sanitizeRoomName('シャニマス 1v1')).toBe('シャニマス 1v1')
    expect(sanitizeRoomName('来玩呀🎵')).toBe('来玩呀🎵')
  })

  it('删掉控制字符', () => {
    expect(sanitizeRoomName(`房${NUL}间${BEL}`)).toBe('房间')
  })

  it('删掉零宽字符——否则可以伪造两个看起来一模一样的房间名', () => {
    const fake = `管${ZWSP}理${ZWSP}员`
    expect(fake).not.toBe('管理员')
    expect(sanitizeRoomName(fake)).toBe('管理员')
    expect(sanitizeRoomName(`房间${BOM}`)).toBe('房间')
  })

  it('删掉双向覆写字符——否则显示顺序可以和真实字符串相反', () => {
    expect(sanitizeRoomName(`${RLO}房间`)).toBe('房间')
  })

  it('折叠连续空白，防止用一长串空格顶掉别人的房间名', () => {
    expect(sanitizeRoomName('a    b')).toBe('a b')
    // 全角空格也要折叠
    expect(sanitizeRoomName(`a${ch(0x3000)}${ch(0x3000)}b`)).toBe('a b')
    expect(sanitizeRoomName('  两边留白  ')).toBe('两边留白')
  })

  it('纯空白与纯不可见字符归一化成空串，调用方据此回落到默认名', () => {
    expect(sanitizeRoomName('   ')).toBe('')
    expect(sanitizeRoomName(ZWSP + ZWSP)).toBe('')
    expect(sanitizeRoomName('')).toBe('')
  })

  it('按码点截断，不会把 emoji 劈成半个代理对', () => {
    const long = '🎵'.repeat(ROOM_NAME_MAX + 10)
    const out = sanitizeRoomName(long)
    expect(Array.from(out)).toHaveLength(ROOM_NAME_MAX)
    // 用 slice() 截断会在这里留下一个孤立的代理码元
    expect(out).toBe('🎵'.repeat(ROOM_NAME_MAX))
  })

  it('先删字符再算长度：24 个可见字符 + 一堆零宽不算超长', () => {
    const visible = 'あ'.repeat(ROOM_NAME_MAX)
    expect(sanitizeRoomName(visible + ZWSP.repeat(40))).toBe(visible)
  })
})

describe('createRoom 的可见性默认值', () => {
  it('不带 visibility 时落为 private —— 漏传字段绝不能意外公开房间', () => {
    const parsed = clientMsgSchema.parse({ t: 'createRoom', nickname: '玩家' })
    expect(parsed).toMatchObject({ t: 'createRoom', visibility: 'private' })
  })

  it('显式传 public 时保持 public', () => {
    const parsed = clientMsgSchema.parse({
      t: 'createRoom',
      nickname: '玩家',
      name: '来玩',
      visibility: 'public',
    })
    expect(parsed).toMatchObject({ visibility: 'public', name: '来玩' })
  })

  it('拒绝非法的 visibility，而不是悄悄回落', () => {
    expect(clientMsgSchema.safeParse({ t: 'createRoom', nickname: 'x', visibility: 'secret' }).success).toBe(
      false,
    )
  })

  it('房间名的长度兜底挡住分配攻击', () => {
    const ok = clientMsgSchema.safeParse({ t: 'createRoom', nickname: 'x', name: 'a'.repeat(64) })
    const tooLong = clientMsgSchema.safeParse({ t: 'createRoom', nickname: 'x', name: 'a'.repeat(65) })
    expect(ok.success).toBe(true)
    expect(tooLong.success).toBe(false)
  })
})

describe('rooms 订阅消息', () => {
  it('subscribe 必须是布尔，缺了不通过', () => {
    expect(clientMsgSchema.safeParse({ t: 'rooms', subscribe: true }).success).toBe(true)
    expect(clientMsgSchema.safeParse({ t: 'rooms' }).success).toBe(false)
  })
})

describe('hello 握手消息', () => {
  it('缺省 claim 时为 undefined，不自动赋 true（避免 z.input 与 z.infer 分叉）', () => {
    const parsed = clientMsgSchema.parse({ t: 'hello' })
    expect(parsed).toEqual({ t: 'hello' })
    expect('claim' in parsed).toBe(false)
  })

  it('显式传 claim: false 时正常解析（探测模式）', () => {
    const parsed = clientMsgSchema.parse({ t: 'hello', resumeToken: 'tok_abc', claim: false })
    expect(parsed).toEqual({ t: 'hello', resumeToken: 'tok_abc', claim: false })
  })

  it('显式传 claim: true 时正常解析（认领模式）', () => {
    const parsed = clientMsgSchema.parse({ t: 'hello', resumeToken: 'tok_abc', claim: true })
    expect(parsed).toEqual({ t: 'hello', resumeToken: 'tok_abc', claim: true })
  })

  it('拒绝非布尔类型的 claim', () => {
    expect(clientMsgSchema.safeParse({ t: 'hello', claim: 'yes' }).success).toBe(false)
  })
})
