# 技术设计 · 开场动画、问候语音与环境 BGM

## 1 · 边界与模块归属

新增四个模块，一个禁区模块加一个只读 getter，三个既有文件接线。

```
apps/web/src/
  ambience.ts              新增  旁路音频层单例：问候语音 + BGM 混播。与 audio.ts 平级的非 UI 模块
  features/idols.ts        新增  28 人事实数据（罗马音 / 中文名 / 组合 / 组合色 / 头像编号），纯数据
  features/opening.ts      新增  开场纯逻辑：随机选人、BGM 曲目游标推进。可测
  screens/Splash.tsx       新增  开场覆盖层，自己管状态机
  audio.ts                 加一个只读 getter `bypass`（见 prd.md 签名阻塞记录）
  App.tsx                  接线  渲染 Splash、把 ambient 布尔量喂给 ambience
  main.tsx                 接线  把已读到的 muted 偏好同步给 ambience
  ui/VolumeControl.tsx     接线  commit() 里同步 muted 给 ambience

apps/server/src/
  ambience.ts              新增  氛围曲目 token 铸造与查表
  app.ts                   新增两个路由
```

`ambience.ts` 放在 `src/` 根而不是 `features/`：它是有副作用的单例，
与 `audio.ts` / `net/ws.ts` 同类，而 `features/` 按 spec 是纯逻辑。

## 2 · 旁路音频链路

### 2.1 为什么必须旁路

题目音频链路是 `source → gain(fade) → master → analyser → destination`。
`master` 承载音量滑块，`analyser` 驱动 `PrismRail` 频谱。开场问候与 BGM 两条都不能进：
进了 `master` 就受滑块管（违背 R2.2 / R3.4），进了 `analyser` 就会让单人猜歌页的频谱
跟着 BGM 抖（违背 R3.8）——那条频谱的全部意义是「现在播的题目长这样」。

```
                                      ┌→ master → analyser → destination   题目音频（既有，一行未动）
AudioContext ─ bypass.out(destination) ┤
                                      ├→ greetGain ──────→ destination      问候语音  gain 0.64 固定
                                      └→ bgmGain ─┬ clipA ─→ destination    BGM       gain 0.12 固定
                                                  └ clipB ─→                （交叉淡化时两路并存）
```

### 2.2 两档固定增益的取值

`prefs.ts` 的默认滑块位置是 `0.5`，过 `audio.ts` 的平方律后线性增益是 **0.25（−12dB）**。
这是本设计里所有「响度」判断的参照点。

- **问候语音 = 滑块语义的 80%**，即 `0.8² = 0.64`（−3.9dB）。
  取滑块语义而不是直接 `gain 0.8`，是因为界面上「音量」一词一直指滑块位置
  （`VolumeControl` 显示的就是 `${pct}%`），需求里的「80%」按用户看得见的那套语义解释。
  比默认响 8dB 是有意的：问候是开场焦点，且只响一次。
- **BGM = 线性 0.12（−18.4dB）**，比默认低 6dB。需求是「比默认还要再低一点，不想干扰用户」。

两个值都定义为模块顶部常量，一处可调。

### 2.3 静音语义

R3.5：滑块位置不影响 BGM 音量，但**静音必须切断 BGM**。否则点了静音世界还在响，是 bug。

`audio.setVolume(level, muted)` 是唯一的静音入口，但 `audio.ts` 是禁区，不加订阅机制。
改由 UI 层在两个已知调用点显式同步：

- `main.tsx`：读完偏好后 `ambience.setMuted(prefs.muted)`
- `VolumeControl.commit()`：`audio.setVolume(...)` 之后紧跟 `ambience.setMuted(next.muted)`

只有这两处会改静音（已通读确认），显式调用比隐式订阅更好审查。

BGM 另有独立开关（R3.7），与静音是**两个正交条件**：
`实际出声 = enabled(在氛围屏) && !muted && bgmOn`。

## 3 · BGM 混播引擎

### 3.1 曲目结构

服务端一次下发若干「曲目」，每个曲目是**同一首歌的 3–4 个连续 index 的切片**：

```ts
interface AmbienceTrack { clips: string[] }   // 3~4 个不透明 token，无曲名、无曲目 id
```

客户端顺序播完一个曲目的全部切片，再换下一个曲目。每曲约 45–60s。

**已知听感代价**：切片起点不连续（实测 30 / 60.5 / 92 / 135…），同曲相邻切片之间
存在乐句跳变，交叉淡化能盖住接缝的爆音但盖不住调性突变。已与用户确认接受——
相比每 15 秒换一首歌的「刷电台」感，这是更好的一侧。

### 3.2 调度

不能用 `setTimeout` 驱动换片：主线程抖动会在接缝处留下可听见的空隙。
沿用 `audio.ts` 已验证的做法——**用 AudioContext 时钟提前调度**。

```
播第 N 片时，就已经把第 N+1 片解码好，并按 ctx 时间轴排好它的起播时刻：
  nextStart = currentStart + CLIP_SEC - CROSSFADE_SEC        // 15 - 2.5 = 12.5s
两片各自带一个 gain：
  出场片  linearRamp 1 → 0.0001，跨 CROSSFADE_SEC
  入场片  linearRamp 0.0001 → 1，跨 CROSSFADE_SEC
```

等功率交叉本应用 `sin/cos` 曲线，但两片是**不同的歌**，不存在相位相关性，
线性 ramp 的中点凹陷（−6dB）在这里听不出来，不值得为它引入曲线表。

一个 `setTimeout` 只负责在 `nextStart` 前 ~3s 触发「解码再下一片 + 排下一次调度」，
即使它晚到几百毫秒，已经排进 ctx 时钟的那次交叉淡化也不受影响。

### 3.3 内存

15s mono 48kHz 解码后约 2.88MB。任意时刻只持有 current + next 两个 buffer（≈5.8MB），
播完即释放。**不复用 `audio.ts` 的 LRU**——那里只有 3 格，BGM 会把题目预取的 buffer 挤掉。

### 3.4 淡出

`setEnabled(false)`（进入 `play` / `karuta`）时，两路 gain 一起 `linearRamp → 0`，
跨 `FADE_OUT_SEC = 0.9s`，然后 `stop()`。必须在题目音频起播**之前**完成——
`App.tsx` 里 `ambient` 转 false 与 `Play` 挂载是同一次渲染，而 `Play` 还要走
`createSession` → `question` → `prefetch` 才起播，0.9s 有充足余量。

## 4 · 服务端氛围端点

### 4.1 为什么必须新增

`api.ts` 的 `clipUrl(sid, token)` 依赖一个**每局一次性**的 session token。
splash 与首页根本没有 session，拿不到任何切片。BGM 需要一条不依赖对局的取音频通道。

### 4.2 契约

```
GET /api/ambience/tracks?n=<1..4>
→ 200 { tracks: [{ clips: string[] }], aacFallback: boolean }

GET /api/ambience/clip/:token          → audio/ogg
GET /api/ambience/clip/:token.m4a      → audio/mp4    （老 Safari 兜底，沿用 formatOf/sendClip）
```

响应里**没有任何** `songId`、曲名、切片 index 或时长。客户端只知道「这是一段能放的音频」。

### 4.3 保住 `catalog.ts` 的红线

那条红线是「private manifest 永不经 HTTP 暴露」，具体指 `sliceId`、时长、切片数——
时长几乎唯一标识曲目，是真实的旁路。本设计不破它：

- token 是 `randomBytes(12).toString('base64url')`，与 `sliceId` 无任何可推导关系。
- 服务端内存 `Map<token, sliceId>`，TTL 30 分钟，容量上限 20000 条（超出按插入顺序淘汰），
  避免长跑进程无限增长。
- 时长不下发。全部切片本来就恒为 15s，这个事实首页早已公开（`LIBRARY.clips`），
  不构成新的旁路。

**残余风险与判断**：攻击者可反复请求 `tracks` 拉取大量切片音频，但拿不到任何标签，
构不成 `sliceId ↔ songId` 对照表；而音频内容本身是公开发行的商业音乐，
下载原曲比对更省事。结论是不引入超出曲库既有公开性的新风险。仍加一道按 IP 的
简单频率限制（`tracks` 每分钟 30 次），防的是流量滥用而不是作弊。

**不做**的替代方案：HMAC 自包含 token 虽可免去服务端状态，但把 `sliceId`
编进了客户端可见的字符串里，一旦密钥泄漏红线直接破——用内存表换掉这个风险。

## 5 · Splash 状态机

```
intro ──点击/Enter──→ greeting ──语音结束/失败──→ handoff ──退场动画结束──→ (卸载)
  │
  └─ resume 分支：检测到 socket.hasResumeToken 时直接进此态，
                  文案换「点击继续对局」，点击后 unlock() 并直接卸载，不放语音、不起 BGM
```

| 态 | 时长 | 音频 | 视觉 |
|---|---|---|---|
| `intro` | 等待点击 | 静默 | 各层错开入场，提示行呼吸 |
| `greeting` | 语音时长（3.72–6.56s） | 问候语音 | 角色署名淡入，提示行淡出 |
| `handoff` | 0.9s | BGM 渐入 | splash 清晰转模糊 + 淡出 |

失败降级：语音 fetch/decode 失败直接跳到 `handoff`（R2.5）；
`AudioContext` 解锁失败（极端情况）同样跳 `handoff`，只是没声音——
**开场绝不因为音频问题拦住人进首页**。

### 5.1 与 App.tsx 的关系

Splash 是覆盖层不是 screen，不进 `Screen` 联合类型。`App` 里加一个独立布尔：

```tsx
const [opened, setOpened] = useState(false)
...
<Backdrop video={ambient} />
{body()}
{!opened && <Splash resume={socket.hasResumeToken} onOpened={() => setOpened(true)} />}
```

`resuming` 那条既有分支（`App.tsx:120`）不动：splash 在它之上，
点击进入后底下该显示什么由既有逻辑决定。

### 5.2 首页入场动画不打架

splash 在场时首页的 `anim-appear` 其实已经跑完了（DOM 一直挂着）。
如果让它在 splash 退场后重跑，需要给 `body()` 加 key 强制重挂——
**不这么做**：重挂会让 `Lobby` 的 socket 订阅、`Room` 的座位状态一起重建，
为一次入场动画付这个代价不值。splash 退场用的是自己的化开动画，
底下首页直接就位即可，观感上是「幕布散开露出已经布好的景」，同样成立。

## 6 · 视觉实现要点

（完整设计意图见 shape brief；这里只记会踩坑的实现约束。）

- **logo 底板**：`--grad-brand-ink` 深紫渐变 + `.cut-card` 双切角。
  `brand.png` 用 `mix-blend-mode: screen` 叠上去，黑底在深紫上归零，发光笔画全留，
  **零抠图**。注意 blend 要在同一个 stacking context 内，父层不能有 `isolation: isolate`。
- **头像**：`.cut-hex` 六边形（与封面缩略图同形）+ 组合代表色描边。
  组合色作缩略图描边是 DESIGN.md 明确允许的三种用法之一。
  **呈现尺寸不得超过 40 CSS px**——源图只有 54×54，没有更大版本。
  按 The Unit-Colour-Is-Data Rule，描边补 `inset 0 0 0 1px rgb(0 0 0 / .1)`，
  浅色组合（`#fff68d` 等）才读得出来。
- **对比度**：深紫底板上的任何文字按 The Tinted-Surface Rule 对着**合成色**测，
  不是对着白底。`--grad-brand-ink` 整条都够深，承白字没问题。
- **焦点环**：提示按钮是斜切元素，`outline` 会被 `clip-path` 吃掉，
  必须套 `.cut-shadow*` 由包装层用 `:has(:focus-visible)` 代画（The Lifted-Outline Rule）。
- **z-index**：splash 是 `position: fixed` 的**正** z-index（在 `Backdrop` 的前景碎片层
  `z-index: 2` 之上，取 60，高于 `Overlay` 默认的 50）。
  注意 `Backdrop` 那条「底衬层必须用负 z-index」的规则针对的是底衬，与此处无关。
- **呼吸动效**：只动 `opacity`，不动 `transform` 或 `clip-path`。
  DESIGN.md 明写「不给动画中的 clip-path 加 transition」。
- **reduced-motion**：入场与呼吸全关，splash 本身仍在（它承担手势）。

## 7 · 资源流水线

一次性脚本 `tools/prepare-opening.mjs`，产物提交进仓库（与 `assets/` 既有做法一致）：

| 输入 | 处理 | 输出 | 实测 |
|---|---|---|---|
| `brand.png` 1.3MB | 还原 alpha → 合成到深紫底板 → WebP q88 | `apps/web/public/brand.webp` 1200×598 | **62.2KB** |
| `opening-greeting/*.wav` ×28 | `ffmpeg` → Opus 48k mono + AAC 64k 兜底 | `apps/web/public/greet/<romaji>.{opus,m4a}` | 22–37KB/段 |
| `icon_circle/001–028.png` 54×54 | 下载 → WebP q90（**不缩放**） | `apps/web/public/idol/<romaji>.webp` | 共 57KB，约 2KB/张 |

### 7.1 品牌板为什么是「预合成」而不是透明 PNG

`brand.png` 是 RGB 无 alpha 的黑底图。黑底上的发光图**本质就是 premultiplied alpha**
（纯黑 = 全透明，越亮越不透明），所以能精确还原，不需要 colorkey 那种一定会在发光软边上
留脏边的抠图：

1. `geq` 把 alpha 设成 `max(R,G,B)` —— 取最大通道而不是亮度，否则纯红的 @ 标志会被算成
   30% 不透明，在底板上发暗
2. `scale` —— **在反预乘之前**缩放，premultiplied 数据做线性插值才是对的
3. `unpremultiply` —— 除回 straight alpha

与逐像素精确计算比对：**alpha 零误差，RGB 只差 1/255 的舍入**。

但透明 PNG **没有作为最终产物**，原因是体积：libwebp 的 alpha 通道是无损编码的
（ffmpeg 未暴露 `alpha_quality`，机器上也没有 `cwebp`），这张图的柔光渐变让 alpha
独占约 208KB。实测带 alpha 的成品 277KB，压到 900 宽仍有 151KB，而质量参数几乎不起作用
（q82 → q58 只降 8%，因为大头在 alpha）。

所以把还原出的透明 logo **合成到深紫底板上输出不透明图**，连同四周留白一起烘焙进去：
**62.2KB**，且底板本来就是必需的（logo 主体是白色描边，白底上根本读不出）。
Splash 因此既不需要 `mix-blend-mode`，也不需要给图补内边距。

`mix-blend-mode: screen` 是另一条不用 alpha 的路，**已实测否决**：它会被底色一起提亮，
整个 logo 褪成灰白，深紫描边消失、Shiny Song Guess 那行的蓝/粉/橙三色糊成一片。

代价：底板颜色固化进图片，改 `--grad-brand-ink` 要重跑脚本。真需要透明底产物时，
去掉 gradients 输入与 overlay 即可，命令记在 `public/README` 与脚本注释里。

**头像必须本地化**，运行时不得请求 `cf-static.shinycolors.moe`（R5.3）：
第三方 CDN 会泄漏访问者信息、可用性不受控、且占用他人带宽。
这与 `assets/cover`、`assets/thumb` 的既有做法一致。

编号映射（已逐张视觉核对，写进 `features/idols.ts`）：

```
001 mano 櫻木真乃      illumination STARS      015 tenka   大崎甜花    アルストロメリア
002 hiori 風野灯織     illumination STARS      016 chiyuki 桑山千雪    アルストロメリア
003 meguru 八宮めぐる  illumination STARS      017 asahi   芹沢あさひ  ストレイライト
004 kagane 月岡恋鐘    アンティーカ            018 fuyuko  黛冬優子    ストレイライト
005 mamimi 田中摩美々  アンティーカ            019 mei     和泉愛依    ストレイライト
006 sakuya 白瀬咲耶    アンティーカ            020 toru    浅倉透      ノクチル
007 yuika 三峰結華     アンティーカ            021 madoka  樋口円香    ノクチル
008 kiriko 幽谷霧子    アンティーカ            022 koito   福丸小糸    ノクチル
009 kaho 小宮果穂      放課後クライマックス    023 hinana  市川雛菜    ノクチル
010 chiyoko 園田智代子 放課後クライマックス    024 nichika 七草にちか  シーズ
011 juri 西城樹里      放課後クライマックス    025 mikoto  緋田美琴    シーズ
012 rinze 杜野凛世     放課後クライマックス    026 haruki  郁田はるき  コメティック
013 natsuha 有栖川夏葉 放課後クライマックス    027 luca    斑鳩ルカ    コメティック
014 amana 大崎甘奈     アルストロメリア        028 hana    鈴木羽那    コメティック
```

`029` 返回 404，确认无第 29 人；28 个编号与 `opening-greeting/` 的 28 个文件名一一对应。
署名文案用**中文名**（「今天是 樱木真乃 来迎接你」），与站内说明性文字用中文的既有约束一致。

## 8 · 兼容性与回滚

- **老 Safari**：Opus 解不了。语音与 BGM 都走与题目音频同一套 AAC 兜底策略
  （先试 Opus，失败切 `.m4a` 并记住）。资源流水线需同时产出 `.m4a` 版本的语音。
  兜底也失败时按 R2.5 静默跳过——**开场不因为浏览器老而卡死**。
- **移动端省电模式 / 后台标签**：`AudioContext` 可能被挂起。BGM 在
  `visibilitychange` 转不可见时暂停调度，转回可见时重新对齐 ctx 时钟继续——
  不这么做的话，回到标签页会听到一段被压缩的、抢拍的音频。
- **回滚**：三处独立可回滚。撤掉 `App.tsx` 里 `<Splash>` 一行即回到无开场；
  `ambience.setEnabled` 恒传 false 即关掉 BGM 而保留 splash；
  服务端两个路由是纯新增，删掉不影响任何既有路径。
  `audio.ts` 的 getter 是纯加性，留着也无副作用。

## 9 · 验证

```bash
pnpm -r typecheck
pnpm -r test
cd apps/web && git diff --stat -- src/api.ts src/net src/features   # 必须为空
cd apps/web && git diff -- src/audio.ts                             # 只应有 bypass getter
node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/screens/Splash.tsx
```

`features/opening.ts` 的纯逻辑补单测（与既有 21 个测试同处 `features/`）：
随机选人覆盖全部 28 人且不越界、曲目游标推进在 3–4 片后换曲、曲目耗尽时能续取。
