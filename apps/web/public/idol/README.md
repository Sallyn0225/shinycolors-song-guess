# 角色头像

28 张 Q 版圆形头像，开场 splash 在问候语音播放时用它署名「今天是 XXX 来迎接你」。
文件名是罗马音，与 `src/features/idols.ts` 的 `id` 一一对应，也与 `public/greet/` 同名。

## 尺寸是硬约束

源图**只有 54×54 一个尺寸**，官方没有更大的版本（试过 `icon/`、`icon_circle_large/`、
`image/`、`@2x` 四条路径，全部 404）。所以：

> **呈现尺寸不得超过 40 CSS px。** 再大就是一张糊图。

不要在转码时放大——放大只会得到一张更大的糊图，还白占体积。

## 来源与再生成

`https://cf-static.shinycolors.moe/images/content/characters/icon_circle/NNN.png`

编号 001–028 是游戏内的组合出场顺序，已逐张视觉核对；029 返回 404，确认无第 29 人。
罗马音 ↔ 编号的映射写在 `tools/prepare-opening.mjs` 的 `IDOL_ICON_NO`。

```bash
node tools/prepare-opening.mjs idol          # 幂等，只补缺的
node tools/prepare-opening.mjs idol --force  # 全部重下重转
```

产物每张约 2KB，28 张合计 57KB。**运行时只下载随机选中的那一张。**

## 必须本地化，不许运行时去拉 CDN

站点运行时**不得**出现任何指向 `cf-static.shinycolors.moe` 的请求：
第三方 CDN 会把访问者信息泄漏出去、可用性不受我们控制、还白占别人带宽。
这与 `assets/cover`、`assets/thumb` 的既有做法一致。
