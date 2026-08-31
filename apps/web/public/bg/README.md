# 首页循环背景

`loop.mp4` —— 首页 / 大厅 / 房间三屏的背景视频，由 `ui/Backdrop.tsx` 铺开。
换片只要用同名文件覆盖，**不用改任何代码**。对局中的 Play 与 Karuta 两屏不铺，
那两屏一切会动的东西都在跟听力和抢牌抢注意力。

## 当前文件

960×540 · 24fps · 无音轨 · 64s · 4.0MB（519kbps）。源片是 720p30 有声、65.6MB。

```bash
ffmpeg -y -i <源片>.mp4 -an \
  -vf "scale=960:540:flags=lanczos,fps=24,hqdn3d=3:2:6:6" \
  -c:v libx264 -preset veryslow -crf 38 \
  -pix_fmt yuv420p -profile:v main -level 4.0 -g 48 \
  -movflags +faststart apps/web/public/bg/loop.mp4
```

逐项理由：

- `-an` 背景视频不该有声，留着只是白占体积。
- `540p / crf 38` 画面要过一层 blur 再过一层遮罩才见人，720p 的细节全部浪费。
  同一段片子 720p/crf30 是 10.2MB，肉眼分不出差别。
- `hqdn3d` 去噪不是为了好看，是为了压缩率：这类 MV 剪辑的噪点吃掉的码率比画面本身还多。
- `-g 48` 两秒一个关键帧，循环接缝处不会卡一下。
- `+faststart` moov 前置，边下边播；漏了它首屏要等整个文件到齐。

## 换片之前先跑一遍对比度

遮罩参数是**按这段片子的实测数据定的**，不是拍脑袋定的（见 `ui/Backdrop.tsx` 的 `VEIL`
和 `index.css` 里 `:root[data-ambient]` 那段）。换一段明显更暗的片子，正文对比度会掉出 4.5:1。

判断依据是逐帧最暗值，不是平均值：

```bash
ffmpeg -i apps/web/public/bg/loop.mp4 \
  -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - 2>/dev/null \
  | paste - - | awk '{gsub(/lavfi.signalstats.YAVG=/,"",$4); y=$4+0; n++; s+=y;
      if(y<40) d++; if(y<mn||n==1) mn=y} END {printf "均值 %.0f  最暗 %.0f  暗帧(<40) %d/%d\n", s/n, mn, n, d}'
```

现在这段是「均值 122 / 最暗 16 / 暗帧 19 帧（1.2%）」。最暗那 16 是开头的黑场，
靠 `Backdrop` 里 `brightness(1.18) contrast(0.82)` 抬到 38 才被遮罩接住。
如果新片子的**均值**低于 100，或暗帧占比超过 5%，遮罩的 `.94/.91` 两档要往上调，
调完重新验一遍 —— 别只看首页截图，那只是 1537 帧里的一帧。
