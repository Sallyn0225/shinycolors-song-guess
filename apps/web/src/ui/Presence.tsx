interface Props {
  online: boolean
}

/**
 * 在线状态点。实心 = 在线，空心 = 不在线。
 *
 * 空心是**两枚叠起来的实心菱形**，不是一圈 inset 阴影：
 * inset 阴影描的是矩形的边，被菱形的 clip-path 一裁只剩四个角上的碎点，
 * 看起来像一枚转圈的加载图标。同一个坑见 index.css「坑三」。
 *
 * 颜色之外还带形状（实心/空心）与相邻的文字，不只靠颜色编码。
 */
export function Presence({ online }: Props) {
  const DIAMOND = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'
  return (
    <span
      aria-hidden
      className="relative block shrink-0"
      style={{
        width: 'calc(9 * var(--u))',
        height: 'calc(9 * var(--u))',
        background: online ? 'var(--color-correct)' : 'var(--color-primary-lt)',
        clipPath: DIAMOND,
      }}
    >
      {!online && (
        <span
          className="absolute"
          style={{
            inset: '1.5px',
            background: 'var(--color-ground)',
            clipPath: DIAMOND,
          }}
        />
      )}
    </span>
  )
}
