# 段位表情

段位表在 `src/features/grade.ts`。每个段位的 `emote` 字段就是这里的文件名。

六个文件，换图只要用同名文件覆盖，**不用改任何代码**：

```
starry.webp    最高段（高山祐介 / 秒杀）
grin.webp      次高段（七草はづき / 完璧无瑕 · 手拿把掐）
smile.webp     中上段（合格闪友 / 拿下）
neutral.webp   中段（一般通过闪友 / 难舍难分）
sweat.webp     中下段（小资历 / 可惜兄弟可惜）
blank.webp     最低段（闪奸？/ 流脓了）
```

现有素材是 296×256 的透明贴纸，由 `emoji/` 下的 PNG 源图转成：

```bash
ffmpeg -y -i emoji/<name>.png -c:v libwebp -q:v 88 -compression_level 6 \
  -preset picture apps/web/public/emote/<name>.webp
```

不必是正方形：网页与战报两处都按 `contain` 绘制，只要短边 ≥ 128px、背景透明即可。
战报图里按 58×58 逻辑像素、2 倍导出绘制，网页上按 `--u` 缩放，最小 34px。

文件不存在时网页与战报都会回退到 `emotePlaceholderSvg()` 生成的简笔表情，
不会出现破图，也不会有 404 之外的任何后果。
