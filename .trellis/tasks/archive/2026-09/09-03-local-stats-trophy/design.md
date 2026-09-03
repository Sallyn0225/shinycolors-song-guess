# 技术设计｜本地战绩统计与奖杯面板

> 对应 `prd.md`。改动面全在 `apps/web/src`。服务端、协议、`api.ts` 零改动。

## 1 · 模块划分

站内已有一条现成的分层，照抄即可（见 `.trellis/spec/web/frontend/directory-structure.md`）：

| 新文件 | 层 | 职责 | 有测试 |
|---|---|---|---|
| `features/units.ts` | 纯数据 | 9 个可统计分组的 id / 名字 / 代表色，附重新求值的命令 | 是（与 `assets` 对齐的一致性断言） |
| `features/records.ts` | 纯逻辑 | 类型、空值、归并（`record`）、选择器与排行（`modeView` / `unitRanking` / `songRanking`） | **是（主战场）** |
| `records.ts` | 存储门面 | `localStorage` 读写 + `try/catch` + 版本回落 + `recordSolo(sessionId, summary)` | 否（副作用层，靠手工验收） |
| `screens/Records.tsx` | 屏 | 奖杯屏：分段切换 + 四块可视化 + 空态 + 清除 | 否 |
| `ui/BarRow.tsx`（暂定） | UI | 横向条形图的一行。若只有一处用，直接内联在 `Records.tsx` 里也行 | 否 |

**为什么拆成 `features/records.ts` + `records.ts` 两个文件**：
和 `prefs.ts` 与 `audio.ts` 同一条理由——归并与排行是可以脱离浏览器直接测的纯函数，
`localStorage` 不是。混在一个文件里，测试就得先造一个 storage mock 才能验一句加法。

命名用 `records` 而不是 `stats`：屏上那个词是 RECORDS，
而 `Stat` 已经是 `ui/Stat.tsx`（数字块组件）的名字，再来一个 `stats` 会撞脸。

---

## 2 · 数据结构

```ts
// features/records.ts
export const RECORDS_VERSION = 1

export interface Tally { seen: number; correct: number }

export interface ModeRecord {
  games: number
  bestScore: number
  worstScore: number
  totalScore: number
  /** 累计答对 / 累计出题（口径见 §3） */
  totalCorrect: number
  totalQuestions: number
  /** 最近 N 局的得分率（0~1），新的在尾部 */
  recent: number[]
  lastPlayedAt: number
  /** unit id → 计数。只含 features/units.ts 里的 9 个 id */
  units: Record<string, Tally>
  /** song id → 计数 */
  songs: Record<string, Tally>
}

export interface Records {
  v: number
  /** 已计入的 sessionId，最近的在尾部，上限 SEEN_MAX */
  seen: string[]
  /** 曲名与所属组合的快照。两档共用，避免存两遍 */
  titles: Record<string, { title: string; unit: string | null }>
  modes: Record<Difficulty, ModeRecord>
}
```

常量（都要带注释说明取值理由）：

```ts
const RECENT_MAX = 20   // 走势带的条数。再多，窄屏一根条不足 3px 就读不出来了
const SEEN_MAX = 50     // 幂等窗口。一个人不会往回翻 50 局之前的结算页
const UNIT_MIN = 5      // 组合上榜的最小出现次数
const SONG_MIN = 3      // 单曲上榜的最小出现次数
```

**体积估算**（AC8 的隐含约束）：曲库 243 首，两档全填满时
`titles` ≈ 243 × ~60B ≈ 15KB，`songs` ≈ 2 × 243 × ~30B ≈ 15KB，其余可忽略——
合计 30KB 出头，对 5MB 的 `localStorage` 是安全的。**不需要做裁剪**，
但注释里要留下这笔账，免得下一个人担心。

`titles` 只在**首次见到某首歌**时写入，之后不覆盖（曲名不会变；即便变了，
统计里显示旧名也无伤大雅，而每局覆盖一遍是白写 10 次）。

---

## 3 · 两个口径（这里最容易埋 bug）

`Summary` 里三个数是不一样的：`total`（出了几题）、`answered`（答了几题）、`correct`（答对几题）。
逐题的 `item.correct` 是 `true | false | null`，`null` = 超时没选。

- **模式总正确率**：`totalCorrect / totalQuestions`，其中 `totalQuestions += summary.total`。
  与结算页显示的 `data.correct / data.total` 同一口径——两处不一致的话，
  用户会拿结算页的数字来对，然后认定统计是错的。
- **组合榜 / 单曲榜**：分母只算 `item.correct !== null` 的题。
  没答的题说明不了「我认不认得这首歌」，把它算成错会污染排行。

这两条口径不同**是有意的**，必须在代码里各写一句注释说明为什么，
否则下一个人一定会「顺手统一」掉其中一个。

得分率（走势带用）：`summary.score / summary.maxScore`，`maxScore` 为 0 时记 0。

---

## 4 · 归并：`record(prev, sessionId, summary)`

纯函数，返回新的 `Records`（不可变更新）：

1. `prev.seen.includes(sessionId)` → **原样返回 `prev`**（幂等，AC1）。
2. 取 `mode = prev.modes[summary.difficulty]`，逐项累加：
   - `games + 1`；`bestScore = max(...)`；`worstScore = min(...)`（首局时两者都等于本局）；
   - `totalScore += score`；`totalQuestions += total`；`totalCorrect += correct`；
   - `recent = [...recent, rate].slice(-RECENT_MAX)`；`lastPlayedAt = Date.now()`。
3. 逐题（只取 `item.correct !== null`）：
   - `songs[item.song.id]`：`seen + 1`，答对再 `correct + 1`；
   - `titles[id] ??= { title, unit }`；
   - `unit = item.song.unit`，**只有 `isCountedUnit(unit)` 为真**才动 `units[unit]`（§5）。
4. `seen = [...seen, sessionId].slice(-SEEN_MAX)`。

**首局的 `worstScore`**：不能把初值设成 0——那样第一局无论打多少分，最低分都会显示 0。
用 `games === 0` 判首局，或把两个字段设成 `number | null`。二选一，在实现里定死并测到（AC3）。

---

## 5 · `features/units.ts`：可统计的 9 个分组

数据源**仓库根**的 `assets/manifest.public.json`（不在 `apps/web/` 下）的 `units[]`，字段里已经有 `kind`：

- `permanent` × 8：イルミネーションスターズ / アンティーカ / 放課後クライマックスガールズ /
  アルストロメリア / ストレイライト / ノクチル / シーズ / コメティック
- `whole` × 1：シャイニーカラーズ（= 用户说的「全体曲」）
- `shuffle` × 10：Team.Luna / Team.Stella / Team.Sol / 彼岸流 / No 1 feel alone / Σ Desire /
  I'm a Cutie Finder / Sonic Heart (and Signal) / ザ・ふたりトラベラー / Fumage —— **不统计**
- `unit === null` × 19 首 —— **不统计**

```ts
/**
 * 可进组合榜的 9 个分组。
 *
 * 抄自 assets/manifest.public.json 的 units[]，与 features/idols.ts、features/library.ts
 * 同一个取舍：为一份不会变的静态数据加一次网络往返不划算，代价是需要人工同步。
 * 曲库的组合若有变动，在**仓库根**重新求值：
 *
 *   node -e "require('./assets/manifest.public.json').units.filter(u=>u.kind!=='shuffle').forEach(u=>console.log(u.id,u.kind,u.name,u.color))"
 *
 * 为什么 shuffle unit 与无归属曲目不在这里：它们不是「我熟不熟这个组合」这个问题的
 * 有效分组——一个 2 首歌的临时组合排进榜单，只会用一个 0% 或 100% 顶掉真正的信息。
 * 它们仍然计入单曲榜与分数/正确率总量。
 */
export const COUNTED_UNITS = [
  { id: 'illumination-stars',   name: 'イルミネーションスターズ',   color: '#fff68d' },
  { id: 'lantica',              name: 'アンティーカ',               color: '#853998' },
  { id: 'houkago-climax-girls', name: '放課後クライマックスガールズ', color: '#fa8333' },
  { id: 'alstroemeria',         name: 'アルストロメリア',           color: '#ff699e' },
  { id: 'straylight',           name: 'ストレイライト',             color: '#af011c' },
  { id: 'noctchill',            name: 'ノクチル',                   color: '#384d98' },
  { id: 'shhis',                name: 'シーズ',                     color: '#008e74' },
  { id: 'cometik',              name: 'コメティック',               color: '#333333' },
  { id: 'shinycolors',          name: 'シャイニーカラーズ',         color: '#8adfff' }, // 全体曲
] as const

export function isCountedUnit(id: string | null): id is string
export function unitName(id: string): string
```

`features/units.ts` 的测试断言「这 9 个 id 在 `manifest.public.json` 里存在且 `kind !== 'shuffle'`」——
`opening.test.ts` 已经有读 manifest 做一致性断言的先例，照它写。
这样曲库改了而这张表没同步时，测试会红，而不是悄悄少一个组合。

---

## 6 · 选择器与排行

```ts
export interface UnitRow { id: string; name: string; color: string; rate: number; seen: number; enough: boolean }

/** 按正确率降序。样本不足的沉到最后，且 enough=false 由 UI 显示成「样本不足」 */
export function unitRanking(r: Records, d: Difficulty): UnitRow[]

/** 正确率最低的前 n 首（易错榜）。只含 seen >= SONG_MIN 的 */
export function weakestSongs(r: Records, d: Difficulty, n = 5): SongRow[]

/** 数字块要的那四个数 + 是否为空态 */
export function modeView(r: Records, d: Difficulty): ModeView
```

排序要**全序稳定**：正确率相同时按 `seen` 降序、再按 id 升序。
不定死的话，同分组合在两次渲染里换位置，看起来像数据在跳。

---

## 7 · 屏与接线

### 7.1 `App.tsx`

```ts
type Screen = … | { name: 'records' }
```

- `Start` 多一个 `onRecords` prop；`case 'records'` 渲染 `<Records onBack={() => setScreen({name:'start'})} />`。
- **BGM**：`09-03-result-bgm-continuity` 已完成，拆分好的判断就在 `App.tsx:223`：

  ```ts
  const video = …                                   // 背景视频那一侧，不动
  const bgm = video || screen.name === 'result'     // ← 只在这一行补 'records'
  ```

  改成 `video || screen.name === 'result' || screen.name === 'records'`。
  **`video` 那一侧一行不改**（父任务 D2 / AC-P2：奖杯屏不要背景视频）。

### 7.2 记录点

`screens/Result.tsx` 拿到 `Summary` 之后调一次 `recordSolo(sessionId, data)`。
放在既有的那个 `useEffect(..., [sessionId])` 的 `.then` 里，与 `setData` 同一处：

```ts
api.result(sessionId).then((d) => { setData(d); recordSolo(sessionId, d) })
```

幂等由 §4 的 `seen` 保证，**不依赖** React 的挂载次数——
`fanfared` 那个 ref 只在同一个组件实例内有效，返回再进结算就失效了。

### 7.3 `ui/Icon.tsx` 新增 `trophy`

24 网格、1.8 描边、方头方角、`fill="none"`。奖杯的形状（杯身 + 两侧把手 + 底座）
可以全用直线与短弧画出来，与 `music` 的符头同理——「零圆角」管的是版面上的**面**，不是图标内部的形。

---

## 8 · 可视化规格

**不引入任何图表库。** 站内没有图表依赖，为四块图加一个是纯负债；
这四块用 SVG / CSS + 既有 `.cut-*` 形状原语都画得出来。

调色**一律用站内 token**（`--color-primary` / `--color-correct` / `--color-wrong` /
`--color-ink-faint` / `--grad-unit-prism`）与组合代表色，**不引入外部调色板**。

| 块 | 做法 | a11y |
|---|---|---|
| 数字块 | `ui/Stat` × 4（最高分 / 最低分 / 场次 / 平均正确率） | 原生 `<dl>`，已有 |
| 走势 | 复用结算页那条折痕带的语汇：`flex-nowrap` 的等宽竖条，高度 = 得分率，`cut-slant`，颜色 `--color-primary`。**必须 nowrap**（结算页那条规矩：任何宽度只缩放不换行） | `role="img"` + `aria-label="最近 N 局得分率：…"` |
| 组合榜 | 一行一个组合：左侧组合名（**用墨色文字**）+ 右侧轨道内一条 `cut-slant` 的填充条，条色 = 组合代表色。最高/最低各挂一枚极小的标记（文字或形状，不靠颜色区分） | 整块 `<dl>` 或表格语义；每行的数值是可读文本，不只画在条上 |
| 易错榜 | 复用结算页列表行：`/thumb/<id>.webp` + 曲名（`lang="ja"` + `jp-wrap`）+ 正确率与出现次数 | 原生列表 |

**组合色的硬约束**：`DESIGN.md` 的 The Unit-Colour-Is-Data Rule——组合色只能作图形，
绝不作文字。`#fff68d`（イルミネ）作文字在白底上直接消失，作条也要给一道 `--ring-hairline`
之类的描边，否则浅色条在浅底上没有边界。

视觉打磨阶段可以调用 `/impeccable`（布局、层级、空态、动效）与 dataviz 的图表规范，
但**结论必须落回站内设计系统**：不许引入新的调色板、新的圆角、新的字体尺度。
这一屏必须看起来是这个 app 的一部分，而不是一块贴上去的仪表盘。

### 空态（R6）

三级：

1. 两档都没有数据 → 整屏空态：一句「这里会记下你的每一局」+ 回首页开局的入口。
2. 当前档没有数据、另一档有 → 只换当前档的内容，分段切换保持可见（要能切过去看）。
3. 有局数但排行未达阈值 → 数字块正常显示，排行位置显示「再打几局就能看到」而不是空图。

---

## 9 · 存储层的失败模式

`records.ts` 的每个出入口都包 `try/catch`（`prefs.ts` 的注释解释了为什么：
Safari 无痕下 `localStorage` 存在但 `setItem` 直接抛）。

读取时的回落链：`raw == null` → 空；`JSON.parse` 抛 → 空；不是对象 → 空；
`v !== RECORDS_VERSION` → **空**（PRD R2：不做半吊子迁移）；
字段缺失或类型不对 → 该字段回落到空值，而不是整份丢弃。

写入配额满（`QuotaExceededError`）：吞掉，本次不记。不做「清掉一半再写」——
那会在用户毫不知情的情况下删掉他的历史。

---

## 10 · 测试策略

`features/records.test.ts`（纯函数，vitest，与既有 5 个 `*.test.ts` 同目录同风格）：

| 用例 | 要点 |
|---|---|
| 幂等 | 同一个 `sessionId` 记两次，`games` 只 +1 |
| 分档 | easy / hard 互不串 |
| 首局的最低分 | 只打一局时 `worst === best === 本局分` |
| 未作答题 | `correct === null` 的题不进单曲/组合分母，但计入 `totalQuestions` |
| 组合过滤 | shuffle unit 与 `unit === null` 不进 `units` |
| 阈值 | `seen < UNIT_MIN` 的组合 `enough === false` 并沉底 |
| 排序稳定 | 同正确率的两个组合顺序确定 |
| `recent` 上限 | 打 25 局后只剩 20 条，且顺序是「新的在尾部」 |
| 版本回落 | 传入 `v: 999` 的对象 → 得到空 `Records` |

`features/units.test.ts`：9 个 id 与 `assets/manifest.public.json` 对得上（§5）。

存储层与屏走**手工验收**（AC6–AC11），其中 AC10 的六档视口实测**必须真的量**——
`screens/Start.tsx` 那段注释把桌面最紧的一档（1366×678）的余量算到了个位数像素。

---

## 11 · 回滚

新增文件为主，既有文件的改动只有四处小接线（`App.tsx` 的 Screen 联合与一处 BGM 名字、
`Start.tsx` 的一枚按钮、`Result.tsx` 的一行调用、`ui/Icon.tsx` 的一条 path）。
`git revert` 之后 `localStorage` 里会留下一份 `scg.stats`，无人读取、无副作用，
下次装回来数据还在。
