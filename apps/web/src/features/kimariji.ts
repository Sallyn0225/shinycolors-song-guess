/**
 * 決まり字：在当前牌场上唯一确定一张牌所需的最短前缀。
 *
 * 这是真歌牌的核心技巧——玩家背的不是整首歌，是「听到这几个音就能锁定是哪张牌」。
 * 把它高亮出来能把扫读速度提高一个量级，而且计算成本几乎为零（对 24 个字符串建前缀表）。
 *
 * 注意作用域是**当前牌场**，不是整个曲库：场上只有 24 张牌，所需前缀通常只有 1~3 个字。
 */
export function computeKimariji(titles: readonly string[]): Map<string, number> {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase()
  const out = new Map<string, number>()

  for (const title of titles) {
    const a = norm(title)
    let need = 1
    for (const other of titles) {
      if (other === title) continue
      const b = norm(other)
      // 与这一张区分开所需的前缀长度
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      need = Math.max(need, i + 1)
    }
    out.set(title, Math.min(need, title.length))
  }
  return out
}
