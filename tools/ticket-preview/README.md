# 战报预览

导出的战报是一整张画在 canvas 上的图。改完 `features/shareCard.ts` 的排版，
除了真去打一局并点开导出，没有别的办法看见效果 —— 这个工具就是为了省掉那一局。

## 看图

```bash
pnpm --filter @scg/web dev
# 打开 http://localhost:5173/ticket-preview.html
# 只看一张：  http://localhost:5173/ticket-preview.html?case=solo-hard
```

页面本身是 `apps/web/ticket-preview.html` + `apps/web/src/dev/ticketPreview.ts`。
放在 `apps/web` 下是因为它 import `src/` 里的 TS，必须由 Vite dev server 来路由。
**不会进构建产物**：Vite 的 build input 只有 `index.html`，而这个模块没有任何
生产代码引用。

## 取证

```bash
node tools/ticket-preview/shoot.mjs                    # 只跑断言
node tools/ticket-preview/shoot.mjs --shot ./out       # 顺便把每张截成图
node tools/ticket-preview/shoot.mjs --case versus-draw # 只跑一个用例
```

有异常时以退出码 1 结束，可以直接挂进 CI。

光截图不够。战报出问题的方式恰恰是「看着像那么回事」：文字压在印章底下、
某一行掉出纸外、数值算成 `NaN` 之后以字符串形式老老实实画了出来 ——
这些在缩略图里都不显眼。所以断言跑在显示列表上，量的是坐标和字符串：

- 文本里出现 `NaN` / `undefined` / `null` / `Infinity`，或画了空字符串
- 文本盒子（按真实 `measureText` 折算 align 与字距）掉出纸面
- 逐题格越过版心 —— 题目数从 10 变 20 时这里最容易溢出
- 文字落在印章圆内 —— 印章是 `multiply` 盖上去的，盖住就读不出来
- `/emote/` 的图没带 fallback —— 正式素材还没做，缺 fallback 就会在段位块左边留一个洞

## 用例

每个用例都对应一类会出问题的排版，不是为了好看才摆在那里。加新用例时
在 `CASES` 里一并写清楚它在盯什么。

| id | 盯什么 |
|---|---|
| `solo-easy` | 10 题的常规版面 |
| `solo-hard` | 20 题：格子缩到 ~19px、题号不再画、曲目折成「他 15 曲」 |
| `solo-perfect` | 满分：最高段位与印章，四位数分数的最宽情形 |
| `solo-zero` | `maxScore = 0` 的除零边界，不能画出 NaN |
| `solo-overflow` | 16 字满长 ID + 超长曲名，全部该收在省略号里 |
| `versus-win` | 联机胜，且带校正提示区块 |
| `versus-loss` | 平均反应缺值（破折号而非 null），且不画校正框 |
| `versus-draw` | 胜负字是两个字，字号要换小一档；也是印章跟随内容底部的验证 |

## 依赖

复用 `tools/ui-audit/deps.mjs` 解析 puppeteer，装法见那边的 README。
自带浏览器没下载时会自动找系统装的 Chrome / Edge，也可以用
`PUPPETEER_EXECUTABLE_PATH` 指定。

固定用 2026-08-31 与固定的假数据：预览要能逐像素比对，读一次 `new Date()`
就会让每天的截图都不一样，diff 全是噪声。
