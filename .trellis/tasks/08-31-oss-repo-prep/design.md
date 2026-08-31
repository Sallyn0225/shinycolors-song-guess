# 设计：公开仓库准备

## 一、授权的拆分方式

### 结构

```
LICENSE          MIT，开头加一段 Scope 限定：仅适用于本仓库的源代码
NOTICE           第三方素材清单与归属、非官方声明
README.md        指向上面两个，并把「自备音源」放在显眼位置
```

### 为什么是 MIT 而不是 AGPL

一度考虑 AGPL 防止他人直接拿去搭商业服务。但：

- 真正拦住商业化的是**素材没有授权**，不是代码许可证。AGPL 对此毫无作用。
- AGPL 会给想读代码学习的人制造摩擦，而这是公开这个仓库的主要价值。

所以代码用 MIT，商业化风险交给 NOTICE 里的素材声明处理。

### LICENSE 的 Scope 段落是关键

标准 MIT 文本前面必须加一段限定，否则「the Software」会被读成整个仓库：

> The MIT license below applies to the **source code** in this repository
> (`apps/`, `packages/`, `tools/`). It does **not** apply to the audio, image,
> and video assets under `apps/web/public/`, which are the property of their
> respective rights holders — see NOTICE.

这一段不是形式主义。没有它，LICENSE 就是一份**不实的权利声明**。

### NOTICE 的内容

1. **非官方声明**：本项目是非官方粉丝作品，与万代南梦宫娱乐及
   「アイドルマスター シャイニーカラーズ」运营方无关联、未获认可。
2. **素材清单与归属**（逐目录，让人一眼看清哪些不属于 MIT）：

   | 路径 | 内容 | 归属 |
   |---|---|---|
   | `apps/web/public/greet/` | 28 段角色问候语音 | © BANDAI NAMCO Entertainment Inc. |
   | `apps/web/public/idol/` `emote/` `brand.webp` `mark/` | 角色图 / 表情 / 标识 | 同上 |
   | `apps/web/public/bg/loop.mp4` | 背景视频 | 同上 |
   | `design-extract-output/SHINYCOLORS-DESIGN-LANGUAGE.md` | 设计语言文档，源自官网 | 同上 |
   | `apps/web/public/sfx/` | 6 个界面音效 | **CC0**，署名见该目录 `CREDITS.md` |

3. **不随仓库分发的内容**：`songs/`（源音源）与 `assets/`（切片等派生物）
   均不入库。指向 README 的自备音源说明。
4. 移除请求的联系方式。

> `sfx/CREDITS.md` 已存在且格式正确，NOTICE 引用它即可，不要复制内容——
> 复制就会产生两份会漂移的署名。

## 二、README 的信息架构

按「读者最先需要什么」排序，而不是按项目结构：

```
1. 一句话是什么 + 一张截图
2. ⚠️ 非官方声明（放在顶部，不是页脚）
3. ⚠️ 需自备音源 —— 为什么 clone 下来跑不起来
4. 快速开始（自备音源之后的三条命令）
5. 架构一览（monorepo 四个包各自负责什么）
6. 文档索引：PRODUCT / DESIGN / DEPLOY
7. 授权：指向 LICENSE 与 NOTICE
```

第 3 项的措辞要具体到**错误信息原文**，这样搜索报错的人能直接命中：

> 直接 `pnpm --filter @scg/server start` 会得到
> `曲库为空——请先跑 pnpm assets all`。这是预期行为：曲库需要你自备音源后本地构建。

### 截图的取舍

README 放游戏截图会再次涉及素材分发。但截图本来就是这个仓库已有内容的呈现，
不构成**新增**的暴露面。放，且放在 NOTICE 声明之后。

## 三、`DEPLOY.md` 的改写

第 3~4 行现在是：

> ⚠️ **版权**：切片是 1.7GB 商用音源的派生物。仓库保持私有，**不要公开部署到不受控的公网**。

「仓库保持私有」与事实矛盾，必须改。但**不能整段删掉**——后半句的技术判断
（切片是派生物、公开部署的暴露面）依然成立，而且 `DEPLOY.md:62` 的
「版权：这一步是有代价的」整节都建立在它之上。

改写方向：把「仓库私有」这条前提替换为「代码公开、素材需自备、部署实例的暴露面
由部署者自行判断」，保留 basic auth 那条建议。

## 四、R4 邮箱：需要用户决策

两个选项，代价差异极大：

| 选项 | 代价 |
|---|---|
| 保留现状 | 零。76 个提交的邮箱随仓库公开 |
| 换成 GitHub noreply 邮箱 | **必须在公开前 rewrite 全部 76 个提交**（`git filter-repo`）。公开前做只是重推一次；公开后做，别人已 fork 的副本里仍是旧邮箱，等于没改 |

这是个人隐私偏好，不是技术问题，交用户定。**不要替他默认。**

## 风险

| 风险 | 处置 |
|---|---|
| LICENSE 写成覆盖全仓库 | Scope 段落是硬要求，check 阶段逐字复核 |
| NOTICE 与 `sfx/CREDITS.md` 内容漂移 | NOTICE 只引用不复制 |
| 公开后发现遗漏 | 扫描已在本任务前置完成；公开动作放在最后一步且由用户确认 |
| README 的自备音源说明被忽略 | 放在顶部三项之内，且引用错误信息原文 |
