/**
 * 归一化人名 / 组合名，用于跨来源比对。
 *
 * 曲库里的真实陷阱：
 *  - 半角/全角括号并存：`涼木シンジ (KEYTONE)` vs `涼木シンジ（KEYTONE）`
 *  - 名字中间有无空格并存：`山根 綺` vs `山根綺`、`関根 瞳` vs `関根瞳`
 *  - `Giz'Mo` 用的是 U+2019 右单引号，不是 ASCII 撇号
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 归一化曲名，用于相似度比较。
 * 片假名→平假名、去长音符/中黑/标点，让 `散花-sanka-` 和 `紅花-benibana-` 这类
 * 同构曲名能被识别为高相似。
 */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ー・\s\-_.,!?！？。、~〜"'()（）[\]]/g, '')
    .toLowerCase()
}

/** ID3 title 尾部的 ' (Off Vocal)'。233/234 有，`リフレクトサイン (2022 Ver.)` 没有 → 必须可选 */
const OFF_VOCAL_SUFFIX = /\s*\(Off Vocal\)\s*$/i

export function stripOffVocal(rawTitle: string): string {
  return rawTitle.replace(OFF_VOCAL_SUFFIX, '').trim()
}

/**
 * 派生易混淆组 key：剥掉 `(xxx Ver.)` / `(2022 Ver.)` 这类版本后缀。
 * `Migratory Echoes` 的 10 个版本和 `リフレクトサイン` 的 2 个版本会各自归为一组。
 */
export function variantGroupKey(title: string): string {
  return title
    .replace(/\s*\((?:[^)]*\s)?Ver\.\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 生成可读且稳定的 slug（保留日文，只替换路径不安全字符） */
export function slug(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

/** 按 `/` 拆分多演唱者字段。ID3 用 `/` 分隔，目录名里被净化成了 `_` */
export function splitArtists(rawArtist: string): string[] {
  return rawArtist
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 解析 `角色名 (CV.声优名)` 形式，返回 { character, cv }；不匹配返回 null */
export function parseCvCredit(s: string): { character: string; cv: string } | null {
  const m = s.match(/^(.+?)\s*[（(]\s*CV[.．]\s*(.+?)\s*[）)]\s*$/)
  if (!m || !m[1] || !m[2]) return null
  return { character: m[1].trim(), cv: m[2].trim() }
}
