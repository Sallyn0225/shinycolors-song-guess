# 品牌标源文件

```
logo.png           1810×708 RGBA   人工抠的透明底。**当前使用的源**
logo-black-bg.png  1839×855 RGB    最初拿到的黑底版，存档备查
```

产物是 `apps/web/public/brand.webp`（1200×470，93.8KB），由开场遮罩使用：

```bash
node tools/prepare-opening.mjs brand          # 幂等
node tools/prepare-opening.mjs brand --force  # 重做
```

只做缩放与转码，**不碰 alpha**：源图的 alpha 大块是纯 0 或纯 255，
libwebp 压得动，256 级原样保留仍只有 93.8KB。

## 为什么不从黑底版自动还原

黑底上的发光图**看起来**正好是 premultiplied alpha 的形式（纯黑 = 全透明，越亮越不透明），
照这个假设做 `alpha = max(R,G,B)` 再 unpremultiply，和逐像素精确计算比对是 **alpha 零误差**的。
一度就是这么做的。

**但那个假设对这张图不成立。** logo 的深紫描边是**实体暗色**，不是发光；
自动还原会把它一并判成半透明，在白底上描边被冲淡、字母边界发飘、整体没有实体感。
两版并排叠在 `--color-ground` 上，差别一眼可辨——半透明区的平均 RGB 亮度
人工版 0.408、自动版 0.820，后者高出来的部分正是被误当成发光而丢掉的暗部。

体积也是人工版赢。**libwebp 的 alpha 通道是无损编码的**（ffmpeg 没有暴露
`alpha_quality`，这台机器上也没有 `cwebp`），自动版那种满屏中间值的 alpha 要 250KB+，
压到 900 宽仍有 151KB，而调 `-quality` 几乎没用（q82 → q58 只降 8%，大头根本不在 RGB）。

结论：这类**带实体暗部**的标志靠数学还原不了，老老实实人工抠。
纯发光素材（没有暗色实体的那种）才适合自动还原，方法留在 git 历史里。

## 两条已经试过、不要再试的路

- **`mix-blend-mode: screen` + 黑底原图**：screen 会把 logo 连同底色一起提亮，
  整个标志褪成灰白，深紫描边消失、Shiny Song Guess 那行的蓝 / 粉 / 橙三色糊成一片。
- **预合成到深紫底板输出不透明图**：体积最小（62KB）且颜色准确，
  但等于给 logo 焊了一块底板，视觉上比透明底重得多。

## 换图时

保持透明底 PNG，覆盖 `logo.png` 重跑脚本即可，**不用改任何代码**。
若新图的宽高比变了，记得同步 `screens/Splash.tsx` 里 `<img>` 的 `width` / `height`
属性——那两个值只用来占位防抖，写错了首屏会跳一下。
