import { buildSoloTicket, buildVersusTicket, type SoloReportInput, type VersusReportInput } from '../features/shareCard'

import { ShareDialog } from './ShareDialog'

/**
 * 导出战报的**异步入口**。
 *
 * 它存在的唯一理由是把 `ShareDialog` + `features/shareCard`(783 行的显示列表构造)
 * + `ui/ticketPainter`(453 行的 canvas 画笔) 整条链关进一个按需加载的分块里。
 *
 * 为什么必须多这一层：Result / Karuta 原来直接 `import { buildSoloTicket }`，
 * 那是**静态**导入，只对 ShareDialog 用 lazy() 没有意义 —— 构造函数照样躺在首屏包里。
 * 所以由这个模块统一把两侧都静态引进来，再由调用方 lazy() 它。
 *
 * 相应地，接口从「传一个 build 闭包」改成「传这份战报的**输入数据**」：
 * 闭包在调用方创建就意味着 buildXxxTicket 必须在调用方可见，那正是要躲开的事。
 * playerId 仍由对话框在用户填 ID 时补上，所以这里收的是去掉 playerId 的那一半。
 */

interface Common {
  /** 对话框的无障碍名 */
  label: string
  /** 预填的 ID */
  defaultId: string
  onClose: () => void
}

type Props =
  | (Common & { kind: 'solo'; input: Omit<SoloReportInput, 'playerId'> })
  | (Common & { kind: 'versus'; input: Omit<VersusReportInput, 'playerId'> })

export default function ShareTicket(props: Props) {
  return (
    <ShareDialog
      label={props.label}
      // 文件名里那一段，与旧调用点保持一致
      kind={props.kind === 'solo' ? '单人' : '对战'}
      defaultId={props.defaultId}
      build={(playerId, m) =>
        props.kind === 'solo'
          ? buildSoloTicket({ ...props.input, playerId }, m)
          : buildVersusTicket({ ...props.input, playerId }, m)
      }
      onClose={props.onClose}
    />
  )
}
