# 首页循环背景

`loop.mp4` —— 首页 / 大厅 / 房间三屏的背景视频，由 `ui/Backdrop.tsx` 铺开。
换片只要用同名文件覆盖，**不用改任何代码**。对局中的 Play 与 Karuta 两屏不铺，
那两屏一切会动的东西都在跟听力和抢牌抢注意力。

## 当前文件

640×360 · 24fps · 无音轨 · **32s** · 650KB（约 166kbps）。源片是 720p30 有声、65.6MB。

```bash
ffmpeg -y -i <源片>.mp4 -an -t 32 \
  -vf "scale=640:360:flags=lanczos,fps=24,hqdn3d=3:2:6:6" \
  -c:v libx264 -preset veryslow -crf 42 \
  -pix_fmt yuv420p -profile:v main -level 4.0 -g 48 \
  -movflags +faststart apps/web/public/bg/loop.mp4
```

> 曾经是 960×540 / crf 38 / 64s / 4.0MB。部署到 5Mbps 的 VPS 之后重压到 650KB
> （**−84%**），因为它一个人就占了冷启动的绝大部分字节。
>
> 三个杠杆里**减半片长是最划算的那个**：同样的每帧画质，字节直接减半。
> 实测 640×360 下 crf42/32s 是 650KB，而 crf46/64s 要 1.0MB —— 后者更大、
> 每帧还更糊。代价只是循环周期 64s→32s，而这段片子的既定要求就是
> 「读不出是哪一支 MV」（见 `ui/Backdrop.tsx`），重复得更频繁无从察觉。
>
> 四档实测：854×480/crf42 = 2.35MB，640×360/crf42 = 1.48MB，
> 640×360/crf46 = 1.00MB，640×360/crf42/32s = 0.65MB。

逐项理由：

- `-an` 背景视频不该有声，留着只是白占体积。
- `360p / crf 42` 画面要过一层 blur 再过一层遮罩才见人，更高的分辨率与码率全部浪费。
  同一段片子 720p/crf30 是 10.2MB，肉眼分不出差别；540p/crf38 的 4.0MB 同样分不出。
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
