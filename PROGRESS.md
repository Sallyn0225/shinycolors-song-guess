# 进度与交接说明

《偶像大师 闪耀色彩》无人声伴奏猜歌游戏。本文档记录**当前实现状态**和**实现过程中发现的、代码里看不出来的事实**。

> 设计方案与决策依据在计划文件里，不在此复述：
> `C:\Users\z1921\.claude\plans\10-20-1v1-linked-hummingbird.md`
>
> 但计划里有几处已被实现推翻，见下方「计划的已知偏差」——**那几条以本文档为准**。

---

## 当前状态

| 模块 | 状态 | 测试 |
|---|---|---|
| `tools/prepare-audio` 素材流水线 | ✅ 完成 | 8 |
| `packages/shared` 协议与可调参数 | ✅ 完成 | — |
| `packages/game-core` 纯规则引擎 | ✅ 完成 | 53 |
| `apps/server` 单机 API + 联机 WS | ✅ 完成 | 41 |
| `apps/web` 单机 + 联机 1v1 UI | ✅ 可玩 | 21 |

**123 个测试全过，全仓 `tsc --noEmit` 干净。**

### 未做（按计划的 MVP 边界，属于有意留下的）

- **玩家自选送り札**——目前自动送自陣待得最久的那张（确定性，玩家可预判）
- **断线重连 UI**——协议和 `resumeToken` 已就位，服务端保留座位 60 秒，但前端没有恢复界面
- **公网部署加固**——wss、反向代理的 `Upgrade` 头转发、`proxy_read_timeout` 要大于 WS 心跳间隔、切片走 CDN
- **AAC 兜底**——切片是 Ogg Opus。Safari 18.4 以下两种容器都有问题，真机测过再决定要不要开 `--with-aac-fallback`

---

## 怎么跑

```bash
pnpm install

# 一次性：从 songs/ 生成切片与 manifest（约 1~2 分钟，需要 ffmpeg 在 PATH）
pnpm assets all

pnpm --filter @scg/server start   # :5179
pnpm --filter @scg/web dev        # :5173  ← 打开这个
```

Vite 和服务端都监听所有网卡，同一局域网的手机可直接访问。

### 素材流水线的其他命令

```bash
pnpm assets scan       # 只扫描元数据（2.8s），改了 data/*.json 后跑这个
pnpm assets manifest   # 用现有缓存重出 manifest，不重新编码音频
pnpm assets review     # 生成演唱者复核表 assets/artist-review.md
pnpm assets audit      # 起本地控制台 :5178（切片试听 + 归属编辑器）
pnpm assets preview --only hard   # 打印一轮真实出题，看干扰项质量
pnpm assets stress     # 用真实曲库跑 300 轮，检查出题不退化
```

---

## 代码地图

```
tools/prepare-audio/     songs/ → 切片 + 封面 + manifest
  data/units.json          9 个组合 + 全 28 名偶像（角色/CV/代表色）
  data/albums.json         album → 组合的规则表
  data/overrides.json      人工核验的逐曲归属（18 条）
  src/planSlices.ts        切片位置选择（纯函数，最该单测的地方）
  src/resolveUnit.ts       演唱者决议链
  src/devserver.ts         :5178 的双页控制台
  src/pages/reviewPage.ts  归属编辑器 UI

packages/shared/         前后端共享
  difficulty.ts            难度预设 + 联机规则参数 ← 调手感只改这里
  scoring.ts               计分参数
  protocol.ts              WS 消息类型 + Zod schema

packages/game-core/      纯规则引擎（无 I/O、无 timer、无 Date.now）
  karuta.ts                空札领地战的判定与状态转移
  select.ts                出题：空札交错、切片轮换
  deal.ts                  发牌与互斥组约束
  solo.ts                  单机出题与干扰项
  scoring.ts               单题计分

apps/server/
  catalog.ts               载入 manifest；private 永不经 HTTP 暴露
  soloSessions.ts          单机会话；答案只存服务端
  ws/room.ts               房间 + 回合状态机
  ws/timing.ts             反应时间判定与防作弊交叉校验

apps/web/
  audio.ts                 Web Audio 单例（预取、精确调度、频谱）
  net/ws.ts                WS 客户端 + 时钟同步
  components/Stage.tsx     倒计时环 + 频谱可视化（rAF 直写 DOM）
  features/narrate.ts      回合结果的文案生成（纯函数，14 个测试）
  features/karutaBoard.ts  稳定槽位
```

---

## 计划的已知偏差

实现过程中推翻了计划里的几处判断。**这几条以本文档为准。**

### 1. 取敵陣牌不是「净赚 2 张」

计划里写「取敵陣 = 净赚 2 张」。查证真歌牌规则后发现账面是：

```
取自陣牌：自陣 -1，敵陣  0
取敵陣牌：敵陣 -1（移除）+1（送り札）= 0，自陣 -1（送出去的）
```

**两者牌数收益完全相同。** 常说的「取敵陣值 2 枚」指的是**节奏**不是牌数——你拿走那张牌，剥夺了对手用它给自己 −1 的机会，外加送札由你挑。代码按真规则实现，用户已确认这是他要的。

### 2. `Migratory Echoes` 是 9 个版本不是 10

无后缀版 + 8 个组合 Ver.，正好覆盖全部 8 个组合。计划里的「10 个」来自调查 agent 的表头笔误。

### 3. `(XXX盤)` 规则不可靠，已删除

计划里有条「album 名含 `(XXX盤)` → 该组合」的规则。**「XXX盤」是发行版本（哪个组合的封面/特典），不是演唱者**——一张 Song for Prism 单曲收录两个组合各一首、出两个盤，所以这规则对其中一首必然判错，实测 8 首里错了 4 首。

已删除该规则，改为在 `overrides.json` 里逐曲显式指定。`albums.json` 里留了注释说明，**不要加回来**。

### 4. 联机窗口与单机片段长度已解耦

计划里联机窗口派生自困难难度的 `clipSeconds`。现在是独立常量 `KARUTA_DEFAULTS.roundWindowSeconds`——两者是不同的旋钮，绑在一起会导致调其中一个就意外改动另一个。

### 5. 难度参数几经调整，最终值

| | 简单 | 困难 |
|---|---|---|
| 题目数 | 10 | 20 |
| 片段长度 | 8s | **6s**（4→6→5→6 调过三轮） |
| 答题时限 | 15s | 10s |
| 选项数 | 4 | 4 |
| 重听 | 2 次 | 1 次 |

联机固定用**困难**难度的曲库策略，回合窗口 **6s**。

---

## 会咬人的地方

按「静默出错的严重程度」排序。

### 素材

- **26 首歌的音频在嵌套子目录里**（下载器把曲名里的 `/` 当成了路径分隔符），最深 9 层、全路径 403 字符。**必须递归找 mp3**，且**绝不能从 mp3 的父目录名推曲名**——会得到艺术家碎片。
- **元数据以 ID3 tag 为准**，不要解析目录名。有两个曲名被文件系统净化过（`1/3` → `1_3`、`Tokyo自由系*ガール` → `_`），ID3 能无损还原。
- **全部 234 个 mp3 内嵌 mjpeg 封面流**，ffmpeg 必须 `-map 0:a:0`。
- **`-map_metadata -1 -fflags +bitexact` 不能省**——否则 ffmpeg 会把源 ID3 的曲名复制进 Opus 头，等于把答案写在切片文件里。
- **切片 mtime 必须统一**——构建顺序就是曲名字典序，按 mtime 排一遍就能还原整张对照表。HTTP 层也要禁 `Last-Modified`、用内容哈希 ETag。
- **响度必须在 mono 降混后测**。输出是 `-ac 1`，立体声测出的响度差 1~1.5 dB（实测 stereo `-8.7` vs mono `-10.1`）。
- **`-vbr off`（硬 CBR）不能改成 VBR**——现在 1404 个切片字节数完全相同（151504B），VBR 下会有 ±3.5KB 差异，足以标识曲目。

### 规则

- **同一首歌重播必须换切片**。6 首空札要覆盖 15~25 回合，必然重复；若放同一段音频，玩家会学会「这段听过 → 是空札 → 别点」，整个空札机制当场塌掉。`select.ts` 的 `pickSlice` 做了 LRU 轮换，有测试守着。
- **易混淆组内的曲目永不互为干扰项**，一局内同组最多取 1 首。否则会产生「无法靠实力避免的失误」。

### 前端

- **必须有用户手势门**才能起 `AudioContext`。忘了只在生产环境炸，本地热重载页面永远不复现。
- **反应时间要用 `getOutputTimestamp()` 而不是 `currentTime`**。后者是调度时钟，蓝牙耳机有 150~300ms 输出延迟——用错了会让戴蓝牙的人输掉所有接近的回合，而这在有线开发机上完全测不出来。
- **不要用每帧 `setState` 驱动倒计时**。React 18 并发调度会批处理，表现就是「有时候没反应」。`Stage.tsx` 用 rAF 直接写 DOM。
- **领地可能超过 12 张**（お手つき / 送り札 会送牌过来），牌场不能固定渲染 12 格。
- **牌被取走后位置要留空**，不能让后面的牌顶上来——玩家背的就是位置。`SlotMap` 负责这件事。
- **Vite 代理 WebSocket 要显式 `ws: true`**，只写 target 不会转发 upgrade 请求。

### 服务端

- **取题与开始计时必须分开**（`GET question` 和 `POST begin`）。客户端会预取下一题，若取题即起表，下一题一进去就超时了。
- **回合按服务器定时器结算，永不等待客户端**。不发 `clipReady` 的客户端照样过回合，否则「卡住不响应」就是免输策略。
- **无 body 的 POST**：浏览器 fetch 常给它们带上 `content-type: application/json`，Fastify 默认解析空 body 会返回 400。已加容错解析器。

---

## 防作弊边界

目标明确设为「**挡住打开 DevTools 的休闲作弊**」，不是密码学安全。音频必须送到客户端，所以足够坚决的攻击者一定赢——这是原理上限。

已做（全部零成本）：切片文件名用 20 字符 CSPRNG 随机 id 并分 256 个子目录、清除内嵌 tag、硬 CBR 统一字节数、固定 15 秒时长（难度靠播放端截断）、统一 mtime、public manifest 不含 `duration`/`sliceId`/切片数、干扰项服务端生成并 CSPRNG 打乱、clip 走每局随机的一次性 token。

构建后有 4 条自检断言（无残留 tag / mtime 已统一 / CBR 生效 / manifest 边界），不过就 `exit 1`。

### 联机判定的一个已知上限

服务端**无法在不主动探测的情况下独立测出单向延迟**，所以 RTT 由客户端上报。少报 RTT 能偷到约 `容差 + 真实单向延迟` 的优势。压制手段：

1. 上报值钳制到 `[0, 800ms]`
2. **自校准下界**——对诚实玩家 `到达时刻 − 起播 − 反应时间` 约等于单向延迟，取历史最小值；少报 RTT 的人会压低这个值，**反而让自己后续更容易被判 clamped**

判定锚点：作弊者只能把包发晚，不可能让包在发出之前到达。容差 `max(60ms, 3×抖动)`，线路差的玩家不会被冤枉。被校正次数记进赛后统计**公示**，靠社交压力而非封禁。

---

## 曲库元数据的可靠性

`ID3 artist` 语义不可靠——234 首里 **96 首**填的是作曲/编曲者或声优本名，不是演唱组合。判据很硬：`artist` 与 `.lrc` 的 `作曲 :` 行重合。

修复靠 album：`CANVAS` 和 `ECHOES` 都是角色歌 CD 系列，两个系列的卷号→组合编号完全一致（01 イルミネ … 08 コメティック）。加上 `COLORFUL FE@THERS -XXX-`、`円環` 的 artist 按 `/` 拆分、声优→角色表，**覆盖率 234/234 = 100%**。

决议优先级（`resolveUnit.ts`）：
```
overrides.json > artist 精确匹配 > artist 按 / 拆分 > artist 含 (CV. > 声优名表
> album 规则 > 曲名括号 (XXX Ver.) > null
```

改完 `data/*.json` 后跑 `pnpm assets scan && pnpm assets manifest` 即可生效，**不需要重新编码音频**。

也可以用 `pnpm assets audit` 起 :5178 的**归属编辑器**：按风险等级/组合筛选、直接改、可试听、改完点「写出 manifest」生效。

组合代表色来自 [アイマスDB](https://imas-db.jp/misc/color.html)（页面标注取自公式サイト与 ASOBISTAGE アソビライト），已核验：

| 组合 | hex | | 组合 | hex |
|---|---|---|---|---|
| イルミネーションスターズ | `#fff68d` | | ノクチル | `#384d98` |
| アンティーカ | `#853998` | | シーズ | `#008e74` |
| 放課後クライマックスガールズ | `#fa8333` | | コメティック | `#333333` |
| アルストロメリア | `#ff699e` | | ストレイライト | `#af011c` |

---

## 素材实况（全库 234 首实测）

| 项 | 值 |
|---|---|
| 曲目数 | 234，曲名无重复，MD5 无字节级重复 |
| 时长 | 159.2 ~ 617.8 秒（**跨度 3.9 倍，所以切片偏移必须按比例而非固定秒数**） |
| 响度 | mono integrated −14.2 ~ −7.5 LUFS；true peak **全部 > 0 dBFS**（削顶母带） |
| 归一化 | 目标 −16 LUFS，**全部是衰减，不需要 limiter** |
| 切片 | 1404 个（234 × 6），15s / 64kbps 单声道 Opus，**每个都是 151504 字节** |
| 产物体积 | 切片 202.9 MB + 封面 11.8 MB |
| 构建耗时 | 分析 27.7s + 切片 31.9s + 封面 7.4s ≈ 1~2 分钟（12 路并发） |

抽检结果（171 个切片，覆盖 129 首）：**一听就认出 80%、想一下能认 19%、完全认不出 2%**。6 秒档下 0% 认不出——计划里排第一的风险「无人声伴奏可能根本认不出」已排除。

---

## 可调参数速查

调手感基本只需要动这两个文件：

- `packages/shared/src/difficulty.ts` —— 难度预设、`KARUTA_DEFAULTS`（牌数、空札数、记忆时间、回合窗口、平局阈值、人类反应下限）
- `packages/shared/src/scoring.ts` —— 基础分 100、速度奖励上限 100、速度曲线指数 1.6、重听扣分 10

切片策略在 `tools/prepare-audio/src/config.ts`（段数、时长、分数偏移、目标响度、码率）。改完要 `pnpm assets slice --force`。
