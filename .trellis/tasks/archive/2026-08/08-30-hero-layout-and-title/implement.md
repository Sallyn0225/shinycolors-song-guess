# 执行计划

前置：dev server 已在 `http://localhost:5199/` 运行（background task `b5vuxh3b4`）。
改动期间保持运行，Vite HMR 直接反映改动。

## 步骤

### 1. PrismRail 高度随 spectrum 变化

`apps/web/src/ui/PrismRail.tsx` 第 267 行的 `span`：

```ts
const span =
  mode === 'mirror' ? 'calc(120 * var(--u))' : spectrum ? 'calc(112 * var(--u))' : '3px'
```

补上 design.md 里那段注释（说明 112u 的由来、为什么 mirror 不参与判断）。
**不改** rAF 循环、不改 canvas、不改折痕、不改 aria。

**验证**：Start 页光带容器高度从 112 变 3；Play 页仍 112；Karuta 仍 120。

---

### 2. HeroTitle

`apps/web/src/ui/SectionTitle.tsx`：新增 `HeroTitle` 导出，与 `SectionTitle` 共用 `CornerMark`。
`CornerMark`、`FLIP`、`POS`、`CORNER` 保持模块私有，两个导出都从里面取。
`SectionTitle` 本身**一行不改**。

结构：

```tsx
export function HeroTitle({ brand, title, className = '' }: HeroProps) {
  const c = CORNER.lg
  return (
    <div className={`flex justify-center ${className}`.trim()}>
      <div className="sc-titlebox relative inline-block text-center" style={{ ['--tc']: `calc(${c} * var(--u))` }}>
        <CornerMark at="tl" size={c} /> …tr …bl …br
        <p  className="font-latin text-2xs font-semibold uppercase text-primary"
            style={{ letterSpacing: 'var(--tracking-title)' }}>{brand}</p>
        <h1 className="sc-title-lg mt-2 font-bold text-ink"
            style={{ letterSpacing: 'var(--tracking-tight)' }}>{title}</h1>
      </div>
    </div>
  )
}
```

补文件头注释：说明这是 Hero 变体，为什么层级与 `SectionTitle` 相反
（上排是品牌标不是片假名、下排是中文主标题不是拉丁），以及它仍守着同一套角标构造。

**验证**：typecheck 通过；`SectionTitle` 的四个既有调用点无 diff。

---

### 3. Start Hero 重排

`apps/web/src/screens/Start.tsx`：

1. 顶部加 `LIBRARY` 常量与来源注释（design.md 设计四那段原文）。
2. import 换成 `HeroTitle`（`SectionTitle` 在本文件不再用，删掉该 import）。
3. `main` 的 `justify-center` → `justify-start`，并补一行注释说明为什么
   （内容高于视口，居中是空操作）。
4. `header` 改为居中：`HeroTitle` + 说明句（`mx-auto text-center`，46ch 保留）
   + 数据组 `<dl className="mt-7 flex justify-center gap-10 sm:gap-14">`，
   三个 `<Stat align="center" />`。
5. 间距按 design.md 的节奏改：组内 `mt-6`/`mt-7`，组间 `mt-14`/`mt-12`。
6. 说明句文案：`听一段没有人声的伴奏，认出它是哪首歌。` —— 末尾那句
   「曲库收录 234 首 off vocal 音源」删掉，因为它已经被数据组以更强的形式表达，
   且那正是过期数字所在。

`EntryBar`、`BLURB`、`KANA`、`SLANT/NOTCH/BAR_CLIP/CAP_CLIP`、错误条、`VolumeControl`
**全部不动**。

**验证**：A3（Hero 水平中心与 main 中心重合）、A4（唯一 h1 含「闪彩猜歌」）、A5、A8。

---

### 4. Lobby Hero 与节奏重排

`apps/web/src/screens/Lobby.tsx`：

1. import 换成 `HeroTitle`（`SectionTitle` 在本文件不再用）。
2. 把 `SectionTitle kana="タイセン" latin="Versus" size="lg"` 与其下的说明段
   包进一个居中的 `<header>`：`HeroTitle brand="VERSUS" title="1v1 空札領地戦"`
   + 说明句 `mx-auto text-center`。
3. 间距按 design.md 的四组节奏改。
4. `CreateDialog`、`VisibilityChoice`、所有 `socket` 逻辑、所有 `aria-*` /
   `role="status"` / `role="alert"` / `aria-live` **一律不动**。

**验证**：A7（首屏可见 ROOMS 表头）、A6。

---

### 5. 检查

按顺序跑，全绿才算完：

```bash
# 类型与测试
pnpm --filter @scg/web typecheck
pnpm -r test

# impeccable 机械检测器（一次，不循环）
node .claude/skills/impeccable/scripts/detect.mjs --json \
  apps/web/src/screens/Start.tsx apps/web/src/screens/Lobby.tsx \
  apps/web/src/ui/PrismRail.tsx apps/web/src/ui/SectionTitle.tsx
```

浏览器一轮批量核查（桌面 + 移动一次做完，最多再补一轮）：

| 视口 | 页面 | 查 |
|---|---|---|
| 1440×900 | Start | A1 A3 A4 A5 A9 |
| 1440×900 | Lobby | A1 A3 A7 A9 |
| 390×844 | Start | A1 A6 A9 |
| 390×844 | Lobby | A1 A6 A9 |
| 1440×900 | Play | A2（光带 112u） |
| 2560×1440 | Start | A9 |
| 768×1024 | Start | A9 |

回归专查（`PrismRail` 是唯一有跨屏影响的改动）：
Play 的频谱带高度 112u、Karuta 的光带仍在场区几何中线上。

无障碍：A10 逐项 Tab 看焦点环，A11 用 `prefers-reduced-motion: reduce` 模拟。

## 回滚点

- 步骤 1 之后：Start / Lobby 死带消失，其余未变——可在此停下。
- 步骤 3 之后：首页完成，Lobby 未动——可在此停下。
- 全量回退见 design.md「回滚」一节。

## 复查门

步骤 5 全绿之后，把改动前后的截图与量到的数字一并报给用户，不自行进入下一轮打磨。
