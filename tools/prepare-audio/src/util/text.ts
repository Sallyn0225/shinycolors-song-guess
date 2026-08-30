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

/**
 * ID3 title 尾部的 ' (Off Vocal)'。现役 233 首全都有后缀。
 *
 * 曾经混进来一首没有后缀的 `リフレクトサイン (2022 Ver.)`——缺后缀正是它有人声的信号，
 * 已从 songs/ 剔除。后缀在这里保持**可选**，只做容错：素材命名不规范时不至于让整条
 * pipeline 崩掉。真要拦截人声版，靠的是入库前人工确认，不是这个正则。
 */
const OFF_VOCAL_SUFFIX = /\s*\(Off Vocal\)\s*$/i

export function stripOffVocal(rawTitle: string): string {
  return rawTitle.replace(OFF_VOCAL_SUFFIX, '').trim()
}

/**
 * 派生易混淆组 key：剥掉 `(xxx Ver.)` / `(2022 Ver.)` 这类版本后缀。
 * 现役曲库里 `Migratory Echoes` 的 9 个版本会因此归为一组。
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
