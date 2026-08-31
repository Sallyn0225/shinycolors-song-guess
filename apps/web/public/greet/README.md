# 开场问候语音

28 段角色问候，开场 splash 点击进入时随机播一段。文件名是罗马音，
与 `src/features/idols.ts` 的 `id` 字段一一对应——**改名要同时改那张表**。

每人两份，只差扩展名：

```
<romaji>.opus    主格式
<romaji>.m4a     AAC 兜底。Safari 18.4（2025-03）以前放不了 Ogg Opus
```

兜底的取舍与曲库切片同一套逻辑（见 `src/audio.ts` 的 `prefetch`）：
**不能靠 `canPlayType` 提前判断**，iOS 上它会说谎，只能真解一次看它成不成。

## 再生成

源文件在仓库根的 `opening-greeting/*.wav`（48kHz mono s16，3.72~6.56s，共 12MB）。

> **那个目录不入库**（见 `.gitignore`，与 `emoji/`、`bg-video.mp4` 同一条规矩）。
> clone 下来是没有它的，要重跑这一步得先把 WAV 放回去。
> 这里的 `.opus` / `.m4a` 才是随代码走的那份。

```bash
node tools/prepare-opening.mjs greet          # 幂等，只补缺的
node tools/prepare-opening.mjs greet --force  # 全部重编
```

产物：opus 22~37KB / 段，28 段合计约 800KB。**但运行时只下载随机选中的那一段**，
所以首屏代价是单段的 20~40KB，不是 800KB。

## 与曲库切片有意不同的两处

`tools/prepare-audio` 编曲库切片时用了两条防旁路的参数，这里都**不用**：

- **不做硬 CBR**（`-vbr off`）。那边是为了让所有切片字节数相同，消灭「按文件大小认曲」；
  这里角色名本来就要显示在屏幕上，没有要保护的秘密，VBR 省下的体积更值钱。
- **不补齐字节数**（AAC 的 `free` box padding）同理不需要。

清元数据（`-map_metadata -1`）仍然保留，但只是为了省几百字节，不是安全措施。
