# Technical Design

## 变更边界

```
闪猜歌即将上线曲目/ ──[新增: ingest 环节]──▶ songs/闪彩off vocal无重复_Page26/ ──[既有 pipeline]──▶ assets/
                                             (gitignore)                                (gitignore)
```

改到的包与文件：

| 位置 | 改动 | 为什么必须动 |
|---|---|---|
| `tools/prepare-audio/src/ingest.ts`（新增） | 批次表的规划与执行 | 转码 / 命名 / 打标签 / 完整性校验要可复用、可单测 |
| `tools/prepare-audio/src/ingest.test.ts`（新增） | 规划期校验的单元测试 | 这个包的质量门是单测（无 lint 脚本） |
| `tools/prepare-audio/data/ingest.json`（新增） | 29 首的人工判定表 | 曲名 / 演唱者 / 专辑是人工判断，属 `data/` 手维护输入 |
| `tools/prepare-audio/src/index.ts` | 加 `ingest` stage 与 `--batch` | 沿用 `pnpm assets <stage>` 的唯一入口 |
| `.gitignore` | 忽略 `闪猜歌即将上线曲目/` | 2.1GB 商业音源不能进 git（`songs/` 早已按同一理由忽略） |
| `apps/web/src/features/library.ts` 等 | 规模数字 243/1458 → 272/1632 | 首页 / 大厅 / 健康检查对外陈述 |
| `.trellis/spec/**`、`PRODUCT.md`、`NOTICE`、`DEPLOY.md`、`PROGRESS.md`、源码注释 | 同上 | R5 的数字清扫 |

**明确不做**：不改 `scan` 的输入契约、不改 server / web / game-core 的任何逻辑、
不碰 `overrides.json`（见 R2）、不轮换 sliceId、不动线上。

---

## 决策 1 · 转成 mp3，而不是让 `scan` 吃 WAV

`scan()` 的输入契约是「每个曲目目录恰好 1 个 mp3 + 1 个 jpg + 有 ID3 title」，
现役 25 个 Page 全是这个形状。新素材是无标签 WAV，两条路：

| | A. 转成 mp3 + 写 ID3（选定） | B. 放宽 `scan` 接受 .wav |
|---|---|---|
| 对既有契约 | 零改动 | 改 `findOneByExt` 与「恰好 1 个」的断言语义 |
| 元数据 | 转码时一次写死，与现役 243 首同形 | 仍要生造标签（WAV 里没有），或改 `ScannedSong` 的元数据来源 |
| 缓存 | `srcSize`/`srcMtimeMs` 语义不变 | 新增格式分支，`srcSize` 的含义随格式漂移 |
| 体积 / 保真 | +约 230MB，320kbps 有损 | 省一次转码，但源目录再涨 2GB |
| 收益 | 与现有材料完全同形，pipeline 侧零风险 | 少一次转码 |

选 A。理由：切片最终是 **80kbps mono Opus**，320kbps CBR mp3 的插入损失远低于该阈值，
而现役 243 首本来就是 320kbps mp3——统一码率比「少一次转码」重要得多。
（反对意见留档：A 是有损转码，若将来素材改为 FLAC/更高保真源，应重新评估。）

---

## 决策 2 · `ingest` 是一个 stage，但**不进 `all`**

- `all` 的语义是「`songs/` → `assets/`」，`ingest` 的输入是 `songs/` **之外**的暂存区，
  产物是 `songs/`。塞进 `all` 会让「构建曲库」隐含地改曲库源，且不可幂等推理。
- 单独跑：`pnpm assets ingest`（全部批次）/ `pnpm assets ingest --batch <id>` /
  `--only <substring>` / `--force`。默认幂等：输出已存在就跳过并计数。
- 复用同一套约定：`Progress` 逐行进度、`⚠` 警告、中文输出、`mapConcurrent` 并发，
  以及 `win32Long()` —— 本批的目录名会长到 300+ 字符，必须走长路径。

### `data/ingest.json` 结构

```jsonc
{
  "batches": [
    {
      "id": "hopeful-feathers-2026-09",
      "sourceDir": "闪猜歌即将上线曲目",       // 仓库根相对
      "page": "闪彩off vocal无重复_Page26",    // 产物落在 songs/ 哪个 Page 下
      "albums": { "stella": "THE IDOLM@STER ... -Stella-", "…": "…" },
      "tracks": [
        {
          "file": "solo2 inst/Team.Stella/櫻木真乃 MAGICAL FOREST.wav",
          "title": "MAGICAL FOREST",
          "album": "stella",                  // 引用 albums 的 key
          "character": "櫻木真乃",             // 单人曲：写角色的官方写法
          "cover": "solo2 inst/Team.Stella/LACA-25301.jpg"
        },
        {
          "file": "泡沫に染まる 風野….wav",
          "title": "泡沫に染まる",
          "album": "utakata",
          "performers": ["風野灯織", "月岡恋鐘", "…"],   // 合同曲：写角色数组
          "cover": "泡沫に染まる.jpg"
        }
      ]
    }
  ]
}
```

**artist 由 `data/units.json` 反查生成**，`角色名 → 「角色名 (CV.声優名)」`，
多人用 `/` 连接 —— 现成的 CV 表只有一份，手抄一遍就会有两份会各自过期的真相。
角色名查不到 = 规划期直接报错（拼错一个片假名不会静默产出半张专辑）。

`character` 与 `performers` 二选一；两个都写或都不写都是错误。

### `planIngest()`（纯函数，单测对象）

输入：批次表 + `UnitTables` + 「源目录下的 wav 相对路径清单」。
输出：`{ jobs: IngestJob[], problems: string[] }`，`IngestJob` 携带
`{ srcWav, srcCover, outDir, outMp3, outJpg, title, artist, album }`。

规划期校验（任一不过就不执行，逐条打印）：

1. **未列出的 wav** —— 源目录里出现表里没有的 wav ⇒ 报错。这是本设计最重要的一条：
   漏一首曲子不会以任何方式显形，只会让曲库静默少一首。
2. 表里列出的 `file` 不存在 ⇒ 报错。
3. `cover` 文件不存在 ⇒ 报错。
4. `character` / `performers` 查不到 ⇒ 报错（带上是哪个名字）。
5. 曲名重复、输出目录重复（同一 Page 内） ⇒ 报错。
6. `album` 引用不存在的 key ⇒ 报错。

### `runIngest()`（执行）

每条 job：

```bash
ffmpeg -hide_banner -v error -i <wav> -i <cover.jpg> \
  -map 0:a:0 -map 1:v:0 -c:a libmp3lame -b:a 320k -ar 44100 -ac 2 \
  -c:v copy -disposition:v:0 attached_pic -id3v2_version 3 -write_id3v1 0 \
  -metadata title="<曲名> (Off Vocal)" -metadata artist="<署名>" -metadata album="<专辑>" \
  -y <out.mp3>
```

与现役 243 首同形（320k CBR / 44.1k / stereo / 内嵌 mjpeg 封面流）；
封面流保留也顺带维持了 `slice.ts` 里 `-map 0:a:0` 那条注释的前提。
jpg 直接 `fs.copyFile`（转码由 `covers` stage 负责，这里不预压）。

写完后回读校验（`probe()`）：title / artist / album 与规划一致、时长与源差 ≤ 0.2s，
不一致则 exit 1 ——「写进去的标签和我以为的不一样」是静默类故障。

---

## 决策 3 · 演唱者决议走 `artist-cv`，不加 override

| 曲 | artist tag | 决议 | 结果 |
|---|---|---|---|
| 28 首 solo | `角色名 (CV.声優名)` | 规则 4 `artist-cv` | `unit` = 该偶像所属组合，`displayArtist` = 原名 |
| 泡沫に染まる | 8 个 `角色名 (CV.声優名)` 用 `/` 连接 | 规则 4 `artist-cv` | `unit = null`（8 个组合）、`displayArtist` = `風野灯織・月岡恋鐘 他6名` |

现役曲库已有 5 首走 `artist-cv`，其中 `Summer Night Paradise` 就是 8 人 `/` 连接的先例，
连 `unit = null` 的展示行为都已被现役 UI 覆盖。所以 `overrides.json` 一行都不用加。

## 决策 4 · 产物落在 `songs/闪彩off vocal无重复_Page26/`

`page` 只用于溯源（`ScannedSong.page`），沿用既有命名序列最省心。
目录名 = `<曲名> (Off Vocal) - <署名（`/` → `_`）>`，与现役目录逐一同规则
（`Summer Night Paradise` 的目录名 159 字符、整路径 403 字符，长路径支持已就位）。

## 决策 5 · sliceId 稳定性怎么保证

老曲目一个 id 都不变，靠的是 `specsFor(song, analysis, cached?.map(s => s.sliceId))`
（复用缓存 id）+ `StageCache` 以 `(stageVersion, srcSize, srcMtimeMs)` 为键。
**所以本次绝不能 bump `STAGE_VERSIONS`，也不能 `--force` 重编码老曲**；
只要不动老曲源文件，analyze / slice 两级全缓存命中，新曲则按正常路径编码。

验证方式：构建前把 `manifest.private.json` 的 `songId → sliceId[]` 抽成快照
（**放仓库外**，它就是答案表），构建后逐条 diff，要求 243 首零差异、总切片数 +174。

## 回滚

- 代码 / 文档：`git revert` 本轮提交即可。
- 素材：删除 `songs/闪彩off vocal无重复_Page26/` 后，**必须手工删掉那 174 个切片与 29 张缩略图**
  —— pipeline 只写不删（`assets/slices` 用随机 id 命名，manifest 一重写就再也认不出孤儿是谁的）。
  这与 2026-08-30 移除人声版那次的已知行为一致。

## 风险

| 风险 | 处置 |
|---|---|
| 素材其实是带人声的版本（会唱出答案） | 机器判不了；列成待人工确认项 + 给出 audit 控制台走法（PRD 最后一条 AC） |
| 文件名里的「角色名 + 曲名」拆分点猜错（尤其 `斑鳩ルカHELL-O` 这种没空格的） | 与官方 track list 逐条对照过（`research/batch-provenance.md`）；存疑的两条已在表里显式写 title，不靠解析 |
| 长路径（>260 字符）在 Windows 上失败 | 全部 fs / ffmpeg 调用走 `win32Long()`，与现有 403 字符路径同路 |
| 磁盘占用 | +约 230MB mp3 + 约 25MB 切片；`songs/` 与 `assets/` 都不入库 |
| 老曲目被连带重编码 | 不 bump `STAGE_VERSIONS`、不 `--force`；用 sliceId 快照逐条验证 |
