# 这批素材是什么（外部取证）

> 29 个 WAV **没有任何容器标签**（ffprobe 的 `format.tags` / `stream.tags` 都是空），
> 曲名、演唱者、专辑全部只能从文件名 + 目录结构 + 外部资料重建。这里记的是外部资料。

---

## 1. `solo2 inst/Team.{Stella,Luna,Sol}/*.wav` → 三张 HOPEFUL FE@THERS 专辑

封面文件 `LACA-2530{1,2,3}.jpg` 就是这三张专辑的商品编号，据此定位：

| 批次内的目录 | 封面 | 品番 | 官方专辑名 | 名义 | 发售日 |
|---|---|---|---|---|---|
| `solo2 inst/Team.Stella` | `LACA-25301.jpg` | LACA-25301 | `THE IDOLM@STER SHINY COLORS HOPEFUL FE@THERS -Stella-` | Team.Stella | 2026-09-16 |
| `solo2 inst/Team.Luna` | `LACA-25302.jpg` | LACA-25302 | `THE IDOLM@STER SHINY COLORS HOPEFUL FE@THERS -Luna-` | Team.Luna | 2026-09-16 |
| `solo2 inst/Team.Sol` | `LACA-25303.jpg` | LACA-25303 | `THE IDOLM@STER SHINY COLORS HOPEFUL FE@THERS -Sol-` | Team.Sol | 2026-09-16 |

来源：Lantis 官方特设页 <https://shinycolors.lantis.jp/releaseinfo/laca-25301/>（-Luna- / -Sol- 同站
`laca-25302/`、`laca-25303/`）、CDJapan / Neowing / ORICON 商品页。
今天 2026-09-10，发售日 09-16 —— 这就是「即将上线」四个字的来源。

**收录曲（官方 track list，仅列本批次取用的新 solo 曲）**

-Luna-（LACA-25302）
1. Embers glow / 風野灯織 (CV.近藤玲奈)
2. 正解な不正解 / 田中摩美々 (CV.菅沼千紗)
3. 最上級パンチライン / 三峰結華 (CV.希水しお)
4. カラースプレーとうさぎさん / 幽谷霧子 (CV.結名美月)
5. 月とネオンと薄紅と / 杜野凛世 (CV.丸岡和佳奈)
6. Odette / 大崎甜花 (CV.前川涼子)
7. Hold on me / 和泉愛依 (CV.北原沙弥香)
8. Here for you / 福丸小糸 (CV.田嶌紗蘭)
9. HELL-O / 斑鳩ルカ (CV.川口莉奈)

-Sol-（LACA-25303）
1. Take Ur Time / 八宮めぐる (CV.峯田茉優)
2. Lights on me / 白瀬咲耶 (CV.八巻アンナ)
3. パラボラ / 西城樹里 (CV.永井真里子)
4. Be-witched / 有栖川夏葉 (CV.涼本あきほ)
5. Sweet Boozy / 桑山千雪 (CV.芝崎典子)
6. ガガリズム / 黛冬優子 (CV.幸村恵理)
7. Paradox / 浅倉透 (CV.和久井優)
8. ハートフルデイ ハートフルミー / 市川雛菜 (CV.岡咲美保)　← 官方写法是**半角空格**，与文件名一致
9. Unstoppable / 七草にちか (CV.紫月杏朱彩)
10. HSV色空間 / 郁田はるき (CV.小澤麗那)

-Stella-（LACA-25301）官方页只写了「新ソロ楽曲9曲 + プラニスフィア ～planisphere～ -9 colors-」，
不列曲名。但批次的 9 个文件名自带「角色名 + 曲名」，且角色集合与该专辑名义 Team.Stella 的
9 人完全吻合（櫻木真乃 / 月岡恋鐘 / 小宮果穂 / 園田智代子 / 大崎甘奈 / 芹沢あさひ /
樋口円香 / 緋田美琴 / 鈴木羽那），故直接采信文件名拆分。

**每张专辑还收了 1 首既存曲的 re-arrange**（`プラニスフィア ～planisphere～ -9 colors-` /
`リフレクトサイン -9 colors-` / `SOLAR WAY -10 colors-`）——**批次里没有这三首，是正确的**：
它们的原曲已经在曲库里（`プラニスフィア ～planisphere～` team-stella、`リフレクトサイン`
team-luna、`SOLAR WAY` team-sol），本次只上线新曲。

## 2. `泡沫に染まる ...wav` → Song for Prism 2026 夏季乐曲

- 初出：`Song for Prism` 2026-08-01，作为新夏乐曲追加，同时开新曲活动「ハレルヤ、小さき者よ」
  （官方情报汇总 <https://idolmaster-official.jp/news/01_19142>）。
- 演唱者 8 人，**每个常设组合各出 1 人**，官方署名形如
  `風野灯織 (CV.近藤玲奈),月岡恋鐘 (CV.礒部花凜),園田智代子 (CV.白石晴香),大崎甘奈 (CV.黒木ほの香),`
  `芹沢あさひ (CV.田中有紀),浅倉透 (CV.和久井優),七草にちか (CV.紫月杏朱彩),斑鳩ルカ (CV.川口莉奈)`
  （<https://pc.animelo.jp/portals/product/20756292>、<https://www.music765plus.com/泡沫に染まる>）。
- 与批内文件名里的 8 个角色名逐一吻合，CV 名与本仓库 `data/units.json` 一致（含 `関根瞳` 之类的空格差异，
  `normalizeName()` 会归一）。
- 数字发行单曲，没有 CD 品番；album tag 按本仓库 Song for Prism 单曲的既有写法
  （`THE IDOLM@STER SHINY COLORS Song for Prism 星の声`）落成
  `THE IDOLM@STER SHINY COLORS Song for Prism 泡沫に染まる`。

## 3. 素材形态

| 项 | 实测 |
|---|---|
| 数量 | 29 个 WAV（28 solo + 1 合同曲） |
| 格式 | PCM WAV，44100 Hz，2ch，无标签 |
| 时长 | 163.2s ~ 268.8s（全部落在 `scan` 的 60~900s 合理区间内） |
| 体积 | 54.9 ~ 90.4 MB，合计约 2.1 GB |
| 封面 | 4 张 jpg：`LACA-25301/302/303.jpg` 各 750²、`泡沫に染まる.jpg` 200² |
| 现有曲库对照 | 243 首全部是 320kbps CBR / 44.1kHz / stereo mp3，且内嵌 mjpeg 封面流 |

## 4. 与曲库既有事实的关系

- 29 个曲名在现役曲库里**都不存在**（逐一比对 `assets/manifest.public.json`）。
- 28 首 solo 的演唱者署名形态 `角色名 (CV.声優名)` 正是 `resolveUnit` 的第 4 条规则
  （`artist-cv`）期望的形态，现役曲库已有 5 首走这条 —— 不需要 `overrides.json` 新条目。
- `泡沫に染まる` 的 8 人 `/` 连接署名与既存 `Summer Night Paradise` 完全同形（也是 `artist-cv`
  命中、`unit = null`、`displayArtist = 「風野灯織・月岡恋鐘 他6名」`），同样不需要 override。
