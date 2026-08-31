# 执行计划：公开仓库准备

顺序有意义：**公开动作在最后，且需用户确认。** 前面每一步都是可撤销的，
只有最后一步不可逆。

---

## 步骤 0 — 用户决策：提交邮箱（阻塞项）

- [ ] 向用户确认 R4：76 个提交的 `z1921531571@outlook.com` 是保留还是换 noreply

**必须先问。** 若选择更换，rewrite 要在任何公开动作之前完成；
公开后再改，已 fork 的副本里仍是旧邮箱，改了等于没改。

若选择更换：
```bash
git filter-repo --mail-map <(echo "旧名 <旧邮箱> 新名 <新邮箱>")
```
注意 `filter-repo` 会重写全部 76 个提交的 hash，本地其他分支需一并处理。

---

## 步骤 1 — LICENSE

- [ ] 新建 `LICENSE`：标准 MIT 文本，**前置 Scope 段落**限定仅适用于
      `apps/` `packages/` `tools/` 的源代码，并显式排除 `apps/web/public/` 下的素材
- [ ] 年份与著作权人按用户实际信息填写

> Scope 段落不是形式主义。没有它，这份 LICENSE 就是一份不实的权利声明。

---

## 步骤 2 — NOTICE

- [ ] 新建 `NOTICE`，含四部分（清单见 design.md）：
      非官方声明 / 素材逐目录归属表 / 不随仓库分发的内容 / 移除请求联系方式
- [ ] `sfx/` 一行只写「CC0，署名见 `apps/web/public/sfx/CREDITS.md`」，
      **不要复制 CREDITS 内容**——两份署名一定会漂移

---

## 步骤 3 — README.md

- [ ] 按 design.md 的七段结构写
- [ ] 第 3 段「需自备音源」必须引用错误信息原文
      `曲库为空——请先跑 pnpm assets all`，让搜报错的人能命中
- [ ] 架构一览覆盖四个包：`apps/server` `apps/web` `packages/shared`
      `packages/game-core`，各一句话
- [ ] 文档索引指向 `PRODUCT.md` `DESIGN.md` `DEPLOY.md`
- [ ] 截图放在非官方声明之后

---

## 步骤 4 — 改写 DEPLOY.md 的私有性警告

- [ ] `DEPLOY.md:3-4`：替换「仓库保持私有」这条前提
- [ ] **保留**切片是派生物、开放部署暴露面、basic auth 建议这三项技术内容
- [ ] 复核 `DEPLOY.md:62` 的「版权：这一步是有代价的」整节是否仍自洽
      （它建立在开头那条警告之上）

---

## 步骤 5 — 收尾复核

- [ ] `.gitignore` 逐条复核（**只核不改**）：`songs/` `assets/` `emoji/`
      `opening-greeting/` `/bg-video.mp4` `design-extract-output/*` 及各 AI 工具目录
- [ ] `git status` 干净
- [ ] 重跑一遍凭据扫描，确认新增的三个文件没引入个人信息
- [ ] 通读 `README` / `NOTICE` / `LICENSE`，确认三者对权属的陈述**互不矛盾**

---

## 步骤 6 — 公开（不可逆，需用户明确授权）

- [ ] 向用户确认「现在可以公开了」
- [ ] `gh repo create` 或把已有仓库切公开
- [ ] 公开后立刻验证：匿名浏览器打开仓库页，确认 README 渲染正常、
      LICENSE 被 GitHub 正确识别

**此步之前的所有步骤都可撤销，此步之后不能。**

---

## 验证

无代码改动，`pnpm -r test` 与 `typecheck` 不受影响，但收尾时仍跑一遍确认
没有误动源码。

## 评审门

步骤 1~4 的产物（LICENSE / NOTICE / README / DEPLOY 改动）**整体交用户过目**
之后再进入步骤 6。权属陈述是法律性文本，不适合我单方面判定完成。
