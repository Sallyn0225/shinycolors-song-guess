# 执行计划 · 开场动画、问候语音与环境 BGM

六个阶段，每个阶段末尾都能独立验证并回滚。**顺序不可换**：阶段 3 依赖 1 的产物，
阶段 4 依赖 2 的端点，阶段 5 依赖 3。

---

## 阶段 0 · 资源流水线

产出全部静态素材，与代码解耦，先做完可以让后面每一步都有真东西可试。

- [ ] 写 `tools/prepare-opening.mjs`，三件事各一个子命令，全部幂等（已存在则跳过）
- [ ] `brand.png` → `apps/web/public/brand.webp`（ffmpeg，q82，目标 < 150KB）
- [ ] `opening-greeting/*.wav` ×28 → `apps/web/public/greet/<romaji>.opus`（libopus 48k mono）
- [ ] 同源再产一份 `apps/web/public/greet/<romaji>.m4a`（AAC 64k，老 Safari 兜底）
- [ ] 下载 `characters/icon_circle/001–028.png` → `apps/web/public/idol/<romaji>.webp`
- [ ] 写 `apps/web/public/greet/README.md` 与 `idol/README.md`，记清来源与再生成方法
      （沿用 `public/bg/README.md` 的既有做法）

**验证**

```bash
node tools/prepare-opening.mjs all
ls apps/web/public/greet | wc -l      # 56（opus + m4a）
ls apps/web/public/idol  | wc -l      # 28
du -h apps/web/public/brand.webp      # < 150KB
```

- [ ] 随机抽 3 段 opus 用 ffplay 听，确认没有削顶或截断
- [ ] 抽 3 张 idol webp 目视确认与 `design.md` 第 7 节的映射表一致

**回滚**：删掉产物目录即可，无代码依赖。

---

## 阶段 1 · 服务端氛围端点

- [ ] 新建 `apps/server/src/ambience.ts`
      - `mintTrack(catalog)`：随机选一首歌，取其连续 3–4 个切片，各铸一个 token
      - `Map<token, { sliceId, expiresAt }>`，TTL 30min，容量上限 20000（超出按插入顺序淘汰）
      - `sliceIdForToken(token)`：过期或不存在一律返回 null
- [ ] `app.ts` 加 `GET /api/ambience/tracks?n=<1..4>`，复用既有 `aacFallback` 标志
- [ ] `app.ts` 加 `GET /api/ambience/clip/:token`，**复用既有 `formatOf` / `sendClip`**，
      不要另写一份发送逻辑
- [ ] 加按 IP 的频率限制（`tracks` 每分钟 30 次），防流量滥用

**Review gate**：响应体里不得出现 `songId`、曲名、切片 index、时长中的任何一项。
逐字段过一遍 `design.md` 第 4.3 节的红线。

**验证**

```bash
pnpm --filter @scg/server test
curl -s localhost:3000/api/ambience/tracks?n=2 | jq          # 只有 clips 与 aacFallback
curl -s localhost:3000/api/ambience/tracks?n=2 | jq -r '.tracks[0].clips[0]' \
  | xargs -I{} curl -s -o /tmp/a.opus -w "%{http_code} %{size_download}\n" \
    localhost:3000/api/ambience/clip/{}
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/ambience/clip/deadbeef   # 404
```

- [ ] 给 `ambience.ts` 补单测：token 过期后取不到、容量上限生效、同曲切片 index 连续

**回滚**：两个路由是纯新增，删掉不触碰任何既有路径。

---

## 阶段 2 · 旁路音频层

- [ ] `audio.ts` 加只读 getter `bypass`（**只加这一个**，照抄 `prd.md` 签名阻塞记录里的签名与注释）
- [ ] 新建 `apps/web/src/ambience.ts` 单例：
      - `playGreeting(url, fallbackUrl)` → `Promise<void>`，**语音自然播完才 resolve**，
        失败 resolve 而不是 reject（R2.5：开场不因为一段问候卡住）
      - `setEnabled(on)`：进出氛围屏，带 0.9s 淡出
      - `setMuted(on)` / `setBgmOn(on)`：三个正交条件，
        `实际出声 = enabled && !muted && bgmOn`
      - 交叉淡化调度按 `design.md` 第 3.2 节：ctx 时钟排程，setTimeout 只管补给
      - `visibilitychange` 挂起与恢复对齐
- [ ] 新建 `features/idols.ts`：28 人数据表（罗马音 / 中文名 / 组合 / 组合色 / 头像文件名）
- [ ] 新建 `features/opening.ts`：`pickIdol()`、BGM 曲目游标推进，**纯函数**
- [ ] 给 `features/opening.ts` 补单测

**Review gate**：确认 BGM 与语音两条链路都**没有**连到 `master` 或 `analyser`。

**验证**

```bash
pnpm --filter @scg/web test
cd apps/web && git diff -- src/audio.ts       # 只应有 bypass getter，别的一行都不许有
cd apps/web && git diff --exit-code -- src/api.ts src/net src/features/kimariji.ts \
  src/features/karutaBoard.ts src/features/narrate.ts
```

**回滚**：`ambience.ts` 无人调用时是死代码，删掉即可。

---

## 阶段 3 · Splash 界面

- [ ] 新建 `screens/Splash.tsx`，状态机按 `design.md` 第 5 节：`intro → greeting → handoff`
- [ ] logo 底板：`--grad-brand-ink` + `.cut-card` + `brand.webp` `mix-blend-mode: screen`
- [ ] 三段文案**逐字照用**（R1.2），不得改写
- [ ] 棱镜光带、错开入场时序（logo 0 / 光带 260 / 标题 420 / 描述 540 / 提示 900ms）
- [ ] 提示行是真 `<button>`，套 `.cut-shadow*` 以保住焦点环（The Lifted-Outline Rule）
- [ ] 角色署名：`.cut-hex` 头像 + 组合色描边 + `inset 0 0 0 1px rgb(0 0 0 / .1)`，
      **呈现尺寸 ≤ 40 CSS px**
- [ ] `resume` 分支：文案换「点击继续对局」，不放语音不起 BGM
- [ ] `prefers-reduced-motion`：入场与呼吸全关，splash 本身保留

**Review gate**：对着 DESIGN.md 的 Don't 清单逐条过——
无 `border-radius`；亮色不作文字；`clip-path` 不加 transition；
不在同一元素上同时写 `clip-path` 与 `filter: drop-shadow()`；双切角多边形数够顶点。

**验证**

- [ ] 桌面与窄屏各一轮截图，一并检查后再统一修（不要逐个改逐个截）
- [ ] 键盘：Tab 到提示按钮，焦点环可见，Enter 走通完整流程
- [ ] `node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/screens/Splash.tsx`
      （**只跑一次**，在界面完成之后）

**回滚**：组件此时还没被 `App.tsx` 引用，删文件即可。

---

## 阶段 4 · 接线与时序编排

- [ ] `main.tsx`：读完偏好后 `ambience.setMuted(prefs.muted)`、`ambience.setBgmOn(prefs.bgmOn)`
- [ ] `prefs.ts`：`AudioPrefs` 加 `bgmOn: boolean`（默认 true），
      读取时按既有风格对非法值回落
- [ ] `VolumeControl.commit()`：`audio.setVolume(...)` 之后同步 `ambience.setMuted(next.muted)`
- [ ] 首页加 BGM 开关（R3.7），极小，与音量控件同组，选择记在本机
- [ ] `App.tsx`：渲染 `<Splash>`；`useEffect` 把既有的 `ambient` 布尔量喂给 `ambience.setEnabled`
- [ ] 编排：点击 → `audio.unlock()` → 180ms → `playGreeting()` → await → BGM 渐入 + splash 退场

**Review gate**：`App.tsx` 里既有的 `resuming` 分支、socket 消息处理、`start()` 一行未动。

**验证**

```bash
pnpm -r typecheck && pnpm -r test
```

**回滚**：撤掉 `App.tsx` 里 `<Splash>` 那一行即回到无开场，其余改动无害。

---

## 阶段 5 · 全量验收

对着 `prd.md` 的 Acceptance Criteria 逐条走一遍，重点是这几条最容易漏的：

- [ ] 拖动音量滑块，BGM 与语音响度**不变**
- [ ] 静音后 BGM 立即停；BGM 开关与静音互不干扰
- [ ] 首页静置 3 分钟，换曲处无爆音、无响度跳变、无静止
- [ ] 进答题屏前 BGM 已完全淡出；`PrismRail` 频谱只随题目音频起伏
- [ ] 1v1 对局中刷新，出现降级 splash，不放语音不起 BGM
- [ ] 网络面板：只请求 1 段语音、1 张头像；**无任何 `cf-static.shinycolors.moe` 请求**
- [ ] 断网时 splash 仍能点击进入首页
- [ ] `prefers-reduced-motion` 下无入场无呼吸，仍可进入

最后一轮全量检查（`trellis-check`）覆盖全部改动范围，而不只是最后一次编辑碰过的文件。

---

## 贯穿始终的三条

1. **禁区**：`api.ts` / `net/ws.ts` / `features/*` 既有文件一行不改；
   `audio.ts` 只加那一个 getter。每阶段末尾跑一次 `git diff --exit-code` 确认。
2. **失败一律降级不阻断**：语音、BGM、头像任何一环出问题，都必须还能进首页玩游戏。
3. **不提交**：`trellis-implement` 不做 git commit，留到 Trellis 3.4。
