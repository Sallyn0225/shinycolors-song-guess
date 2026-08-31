# UI 音效来源与许可

`apps/web/public/sfx/` 下的全部文件均为 **CC0 1.0（公有领域贡献）**，可商用、可修改、无需署名。
本文件逐条记录每个 WAV 的原始出处与转换处理，保证可追溯。

下载 / 转换日期：2026-08-31。

## 统一转换说明

所有文件都经同一套处理：

- 裁掉源文件尾部的静音垫（源 ogg 普遍带数百毫秒到数秒的尾部静音）
- 结尾 60ms 线性淡出（fade-out），避免截尾爆音
- 峰值归一到 **-3dB**（响度配平在母带时一次完成，运行时不逐音效调）
- 重采样 / 转码为 **48kHz 单声道 PCM16 WAV**（浏览器原生解码，零兼容问题）

## 逐文件映射

| 逻辑名 | 用途 | 来源包 | 原始路径 |
|--------|------|--------|----------|
| click.m4a | 按钮 / 入口点击 | Kenney UI Audio | Audio/click2.ogg |
| tick.m4a | 倒计时 3-2-1（供 play-countdown 任务调用） | Kenney UI Audio | Audio/rollover2.ogg |
| go.m4a | 倒计时结束 / 起跑（供 play-countdown 任务调用） | Kenney UI Audio | Audio/rollover1.ogg |
| correct.m4a | 揭晓正解 | Interface SFX Pack 1 | Ogg/Confirm_tones/style3/confirm_style_3_001.ogg |
| wrong.m4a | 揭晓不正解 | Interface SFX Pack 1 | Ogg/Error_tones/style3/error_style_3_001.ogg |
| fanfare.m4a | 结算页进场 | Interface SFX Pack 1 | Ogg/Confirm_tones/style1/confirm_style_1_001.ogg |

裁剪时长：correct.m4a 由原约 6s（含尾部静音垫）裁到实声 0.72s；
wrong.m4a 裁到 0.77s；fanfare.m4a 裁到 1.31s（结算音要克制，不做长奏）。

## 来源包

1. **Kenney UI Audio**
   - URL: https://kenney.nl/assets/ui-audio
   - 作者: Kenney (kenney.nl)
   - 许可: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/

2. **Interface SFX Pack 1**
   - URL: https://obsydianx.itch.io/interface-sfx-pack-1
   - 作者: ObsydianX
   - 许可: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
