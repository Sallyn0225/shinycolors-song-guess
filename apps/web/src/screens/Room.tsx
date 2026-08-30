import { useEffect, useState } from 'react'
import type { RoomView } from '@scg/shared'

import { socket } from '../net/ws'
import { Button } from '../ui/Button'
import { Presence } from '../ui/Presence'
import { SectionTitle } from '../ui/SectionTitle'

interface Props {
  initialRoom: RoomView
  /** 回大厅。**不断开 socket** —— 断了就要重连，列表也要重订阅 */
  onLeave: () => void
}

/**
 * 房间内：等对手、准备、开局。
 *
 * 和大厅拆开不只是因为行数 —— 两者的生命周期不同。大厅要订阅房间列表，
 * 房间内不需要（服务端在入座时已经把订阅关了）。合在一个组件里意味着
 * 列表订阅的 effect 在房间里也照跑。
 */
export function Room({ initialRoom, onLeave }: Props) {
  const [room, setRoom] = useState<RoomView>(initialRoom)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const off = socket.on((msg) => {
      if (msg.t === 'room') {
        setRoom(msg.room)
        setError(null)
      } else if (msg.t === 'roomClosed') {
        // 房间已经在服务端消失了，留在这个界面上只会对着一个点什么都没反应的按钮
        setClosed(true)
      } else if (msg.t === 'error') {
        setError(msg.message)
      }
    })
    return off
  }, [])

  const copyCode = () => {
    void navigator.clipboard
      ?.writeText(room.code)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })
      // 不支持剪贴板或用户拒了权限都不该报错——房间码本来就明晃晃写在屏幕上
      .catch(() => undefined)
  }

  const me = room.players[room.you]
  const other = room.players[room.you === 'A' ? 'B' : 'A']
  const isPublic = room.visibility === 'public'

  return (
    <main
      className="mx-auto flex min-h-dvh w-full flex-col justify-center px-6 py-14 sm:px-10"
      style={{ maxWidth: 'var(--page-narrow)' }}
    >
      <SectionTitle kana="ルーム" latin="Room" size="md" className="anim-appear" />

      <div className="anim-appear mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="sc-title-sm min-w-0 font-bold break-words text-ink">{room.name}</h2>
        <span
          className="text-2xs font-semibold text-ink-sub"
          style={{ letterSpacing: 'var(--tracking-base)' }}
        >
          {isPublic ? '公开房间' : '私人房间'}
        </span>
      </div>

      <p
        className="latin sc-roomcode anim-appear mt-4 font-bold text-primary"
        style={{ letterSpacing: 'var(--tracking-title)', lineHeight: 1 }}
      >
        {room.code}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="jp-wrap min-w-0 flex-1 text-sm text-ink-sub">
          {isPublic
            ? '这个房间已经在大厅列表里，任何人都能看到并加入；也可以直接把房间码发给朋友。'
            : '私人房间不会出现在大厅列表里 —— 把房间码发给朋友，他才进得来。'}
        </p>
        <Button variant="ghost" size="sm" onClick={copyCode} className="shrink-0">
          {copied ? '已复制' : '复制房间码'}
        </Button>
      </div>

      <div className="mt-8 flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
        {[me, other].map((p, i) => (
          <span key={i} className="cut-shadow-sm">
            <span className="glass-lit cut-bar flex items-center gap-3 px-8 py-4">
              <Presence online={!!p?.online} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {p ? p.nickname : '等待对手加入…'}
                {i === 0 && <span className="ml-2 text-xs font-normal text-ink-faint">（你）</span>}
              </span>
              {p?.rttMs != null && <span className="latin text-xs text-ink-faint">{p.rttMs}ms</span>}
              {p?.ready && (
                <span
                  className="text-xs font-bold text-correct"
                  style={{ letterSpacing: 'var(--tracking-base)' }}
                >
                  已准备
                </span>
              )}
            </span>
          </span>
        ))}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        双方 RTT 都公开显示 —— 透明比假装公平更重要。判定按「相对片段起播的反应时间」，
        不是服务器收包时间，所以网络延迟不影响胜负。
      </p>

      {closed ? (
        <div className="mt-8">
          <p
            role="alert"
            className="cut-slant relative px-5 py-3 text-sm text-ink"
            style={{ background: 'rgb(255 255 255 / .7)' }}
          >
            <span
              aria-hidden
              className="cut-ring cut-ring-slant"
              style={
                { '--ring': '1px', '--ring-color': 'var(--color-primary)' } as React.CSSProperties
              }
            />
            房间等待太久，已经被自动关闭了。
          </p>
          <div className="mt-4">
            <Button variant="primary" size="lg" full onClick={onLeave}>
              回到大厅
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <Button
              variant="primary"
              size="lg"
              full
              disabled={!other}
              onClick={() => socket.send({ t: 'ready', ready: !me?.ready })}
            >
              {!other ? '等待对手…' : me?.ready ? '取消准备' : '准备'}
            </Button>
          </div>

          {error && (
            <p
              role="alert"
              className="cut-slant relative mt-5 px-5 py-3 text-sm text-wrong"
              style={{ background: 'rgb(179 18 58 / .1)' }}
            >
              <span
                aria-hidden
                className="cut-ring cut-ring-slant"
                style={
                  { '--ring': '1px', '--ring-color': 'var(--color-wrong)' } as React.CSSProperties
                }
              />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onLeave}
            className="tap-line mt-4 self-start text-xs text-ink-faint transition-colors hover:text-primary"
            style={{ letterSpacing: 'var(--tracking-base)' }}
          >
            离开房间
          </button>
        </>
      )}
    </main>
  )
}
