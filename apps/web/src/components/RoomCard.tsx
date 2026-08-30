import type { RoomStatus, RoomSummary } from '@scg/shared'

import { Cut } from '../ui/Cut'

interface Props {
  room: RoomSummary
  /** 本地时钟下的建房时刻（已用 socket 的时钟偏移换算过） */
  createdAtLocal: number
  /**
   * 连接断了就不能点。
   *
   * 没有这个的话，断线时点一张牌会走进 `socket.send` 的「没连上就丢掉」分支 ——
   * 界面没反应、也没报错，用户只会以为自己没点中。
   */
  offline: boolean
  onJoin: (code: string) => void
}

/**
 * 状态的三档表达。
 *
 * 每档都有**文字**，不是只有颜色和灰度 —— 「已满」和「对局中」都不可点，
 * 但它们的含义不同：前者可能几秒后就开局，后者要等一整局。
 */
const STATUS: Record<RoomStatus, { label: string; joinable: boolean }> = {
  waiting: { label: '等人', joinable: true },
  full: { label: '已满', joinable: false },
  playing: { label: '对局中', joinable: false },
}

/** 相对时间。房间的生命周期以分钟计，秒级精度没有意义，也会让列表一直在跳 */
function ago(ms: number): string {
  if (ms < 60_000) return '刚刚'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} 分钟前`
  return `${Math.floor(min / 60)} 小时前`
}

/**
 * 列表里的一间房。
 *
 * 双行：房间名占主位（它是唯一能让人决定要不要进的信息），房主与时间降为弱小字。
 * 不可加入的房间**保留显示**——看得到「有人在玩」比一个干净的空列表更有用。
 */
export function RoomCard({ room, createdAtLocal, offline, onJoin }: Props) {
  const { label, joinable: statusAllows } = STATUS[room.status]
  const joinable = statusAllows && !offline

  return (
    <Cut
      shape="bar"
      elevation="sm"
      outerClassName="block"
      // 不可加入的条目降的是**面的亮度**，不是文字的不透明度。
      // 早先在按钮上写 opacity-55，把 ink-sub 拉到约 2.4:1 —— 这套系统对对比度是硬要求
      className={joinable ? 'glass-lit' : 'glass'}
    >
      <button
        type="button"
        disabled={!joinable}
        onClick={() => onJoin(room.code)}
        // 无障碍名要把整条信息说全 —— 屏幕阅读器用户听到的是这一句，不是视觉排版
        aria-label={`${room.name}，房主 ${room.host}，${room.players} / 2 人，${label}${
          joinable ? '，点击加入' : offline ? '，连接已断开' : ''
        }`}
        className={[
          'flex w-full items-center gap-4 px-8 py-3.5 text-left',
          'transition-transform duration-300 ease-[var(--ease-prism)]',
          joinable ? 'enabled:hover:-translate-y-px enabled:active:translate-y-0' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ minHeight: '56px' }}
      >
        {/* 可加入 = 深青实心菱形，不可加入 = 浅紫实心。
            不用「实心 vs 描边」：inset 阴影会被菱形的 clip-path 削成四个碎点，
            看起来像一枚加载中的转圈图标 */}
        <span
          aria-hidden
          className="block shrink-0"
          style={{
            width: 'calc(9 * var(--u))',
            height: 'calc(9 * var(--u))',
            background: joinable ? 'var(--color-accent-ink)' : 'var(--color-primary-lt)',
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink">{room.name}</span>
          <span className="mt-0.5 block truncate text-2xs text-ink-faint">
            {room.host} · {ago(Math.max(0, Date.now() - createdAtLocal))}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span
            className="block text-2xs font-semibold text-ink-sub"
            style={{ letterSpacing: 'var(--tracking-base)' }}
          >
            {label}
          </span>
          <span className="latin mt-0.5 block text-2xs text-ink-faint">{room.players}/2</span>
        </span>
      </button>
    </Cut>
  )
}
