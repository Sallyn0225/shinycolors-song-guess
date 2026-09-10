# Implementation Plan

顺序原则：**先取证、再写可 `git revert` 的代码、最后做不可逆的素材与产物**。
阶段 3 一旦跑完，`assets/` 就再也回不到「只有 243 首」的样子（切片按随机 id 命名），
所以阶段 0 的快照是后面所有验证的前提。

> **执行记录（2026-09-10）**：阶段 0–6 全部执行完毕。曲库 **243 → 272 首**、
> 切片 **1458 → 1632 个**，旧 243 首的 sliceId **逐条零变化**（快照 diff），
> 174 个新切片全部是新的。`pnpm -r typecheck` 5/5 干净；`pnpm -r test` **412 项全绿**
> （shared 17 / game-core 62 / web 195 / server 114 / prepare-audio 24，prepare-audio 由 14 → 24）。
>
> **执行中的偏差与实物修正**（规划里写错的，按实测落笔）：
>
> - 规划时以为要靠 `normalizeName()` 兜住 `関根 瞳`（带空格）这类写法差异；实测 `units.json`
>   里写的是无空格的 `関根瞳`，而现役曲库里存在带空格的旧署名 `(CV.関根 瞳)`。
>   两者仍能对齐，不影响结论，但「正字法以 units.json 为准」这条要记住。
> - 三张 HOPEFUL FE@THERS 里附的 re-arrange 曲确实不在批次里，与规划一致；顺带核实原曲已在库
>   （`プラニスフィア ～planisphere～` / `リフレクトサイン` / `SOLAR WAY` 都在 manifest 里）。
> - 批内封面是**专辑封**（750² ×3）与单曲封（200²）：28 首 solo 里 9/9/10 首分别共用三张专辑封。
>   查过现役曲库，共用封面是**既有常态**（272 张缩略图里有 67 组字节完全相同），不是这次引入的新问题，
>   故未做「一歌一图」的额外处理。
> - `assets/audit-ratings.json` 里有 1 条 sliceId 已失效（`44SFPC9JN3BHBNCVW4WA` → `1/3`）：
>   它**不在本次构建前的快照里**，是这批本地审计草稿本来的陈旧条目（该文件不入库），
>   与本次上线无关，未动。
>
> **人工验收（2026-09-10，用户执行）**：本机 `:5179` 实机走查 + `:5178` 抽检台试听整轮通过，
> 含 29 首无人声确认、首页数据组 272/1632、窄屏不溢出、新曲专辑封与新曲名在牌面的显示。
> 服务已关闭，无残留进程。
>
> **遗留**：线上 VPS 的 `assets/` 同步（部署动作，需要访问凭证，不在本任务范围）。

---

## 阶段 0 · 快照（动任何东西之前）

- [x] 把 `assets/manifest.private.json` 的 `songId → sliceId[]` 抽成快照，写到**仓库外**
      （`$env:TEMP\scg-slices-before.json`）——它就是答案表，`asset-secrecy` 明令不得入库
- [x] 记录基线：曲目数 243、切片数 1458、`assets/thumb` 243 张、`assets/slices/**/*.opus` 1458 个、
      analyze/slice 缓存各 243 条
- [x] 记录 29 首源 WAV 的时长表（ffprobe，163.18~268.78s），供后面逐条对时长

**验证**：快照里恰好 243 条 songId、1458 条 sliceId；文件落在仓库外。
→ 实测 243 / 1458 / keys 243，文件在 `%TEMP%`。

---

## 阶段 1 · ingest 工具（纯代码，可 revert）

- [x] `tools/prepare-audio/data/ingest.json`：29 条人工判定（曲名 / 角色 / 专辑 / 封面）
- [x] `tools/prepare-audio/src/ingest.ts`：
      `planIngest()`（纯函数，六条规划期校验）+ `runIngest()`（转码 / 拷贝 / 回读校验）
- [x] `tools/prepare-audio/src/index.ts`：`STAGES` 加 `ingest`、`parseArgs` 加 `--batch`、
      `case 'ingest'` 接上；**不**加进 `case 'all'`
- [x] `tools/prepare-audio/src/ingest.test.ts`：未列出的 wav、缺文件、未知角色名、
      `character`/`performers` 二选一、曲名重复、署名生成（单人与多人）
- [x] `.gitignore` 加 `闪猜歌即将上线曲目/`
- [x] 顺带把 `buildMeta.ts` 里的「角色 → CV 成员」查找提成 `resolveUnit.ts#memberOf()`，
      让 ingest 与显示名生成共用同一次查找（否则 CV 表会有第二份读法）

**验证**：`pnpm --filter @scg/prepare-audio test`（新增用例全绿）+ `pnpm -r typecheck`。
此时**先不执行** ingest，只跑测试。
→ 24 passed（新增 10 条）；typecheck 干净。写测试时抓到一条自己的用例缺陷：
「一条坏数据只挡它自己」那条原本给了两个同曲名的 track，于是「重复」也被算成问题，
改成第二个用不同曲名后，它才真正在测「坏数据不牵连同批其它曲目」。

---

## 阶段 2 · 素材落地到 `songs/`

- [x] 规划期校验先过（测试覆盖「漏列 wav」「缺文件」「未知角色名」三类拒绝路径）
- [x] 真跑：`pnpm assets ingest --batch hopeful-feathers-2026-09` → 29/29 转码，失败 0，耗时 17.2s
- [x] 产物抽查：29 个新目录，每个恰好 1 mp3（8.0~10.3MB，容器 `mp3`）+ 1 jpg；
      ffprobe 回读 title / artist / album / 时长
- [x] `pnpm assets scan`：272 首、0 结构问题、决议覆盖率 100%

**评审门**：`scan` 的决议分布里 `artist-cv` 应从 5 涨到 34（+29），
`unresolved` 必须为空；易混淆组输出里不得出现新曲与老曲被误并组。
→ 实测 `artist-cv` 34、`unresolved` 0；易混淆组仍只有 `Migratory Echoes` 9 首（新曲未触发误并）。
29 首新曲逐条核对：28 首 solo 各自归到正确组合；`泡沫に染まる` `unit = null`、
`displayArtist = 風野灯織・月岡恋鐘 他6名`、`source = artist-cv`（与现役 `Summer Night Paradise` 同形）。

---

## 阶段 3 · 重建曲库（不可逆）

- [x] `pnpm assets all`：analyze 4.9s（缓存命中 243/272）、slice 6.7s（跳过已存在 1458/1632）、
      covers 0.7s（272 张 / 2.1MB）、manifest 272 首 / 1632 切片
- [x] `selfCheck` 与边界检查：opus 字节数 min=max=**151504**、跨度 **0B**、唯一值 1 个；
      mtime 已统一；抽检 12 个切片无残留 tag；`assertPublicManifestClean` 通过
- [x] sliceId 稳定性：`before` 快照 vs `assets/manifest.private.json` →
      **旧曲丢失 0、旧曲 sliceId 变化 0、新曲 29、新切片 174**
- [x] `pnpm assets review`：272 条（🔴 0 / 🟡 93 / 🟢 179），新曲的 `fileArtist` 与 `resolvedArtist` 一致
- [x] `pnpm assets preview --only hard`（干扰项里出现新曲）+ `pnpm assets stress`：
      简单 3000 题 / 困难 6000 题，曲库覆盖 100% / 98%，无重复选项、答案始终在选项内
- [x] 端到端抽题：单机 82 轮、1v1 22 局后，29 首新曲**全部**作为答案出过题 / 进过牌池

**评审门**：老曲 243 首 sliceId **零差异**；新曲 174 条 sliceId 全部是新的；
`assets/slices` 的 opus 总数 = 1632；`degradeLevel >= 3` 为 0。
→ 全部达成（L0: 272 首，即无任何降级）。

**回滚点**：这一步之后要回退，必须删 `songs/…_Page26/` **并手工删掉 174 个切片 +
29 张缩略图**（pipeline 只写不删）。

---

## 阶段 4 · 数字清扫（R5）

- [x] 代码：`apps/web/src/features/library.ts`（272 / 1632）、`apps/server/src/app.test.ts` 断言（272）
- [x] 代码注释里的现役数字：`tools/prepare-audio/src/{config,slice,manifest,similarity,resolveUnit,types}.ts`、
      `util/text.ts`、`data/{albums,units}.json` 的 `_comment`
- [x] 文档：`PROGRESS.md` 素材实况表（并订正测试计数 304 → 412）、`DEPLOY.md`（缩略图张数、assets 体积、
      切片总数）、`PRODUCT.md`、`NOTICE`、`docker-compose.yml` 注释、`apps/web/src/features/units.test.ts` 注释
- [x] web 侧另外三处：`features/records.ts`（两处注释）、`screens/Records.tsx`（屏上文案）
- [x] spec：`.trellis/spec/prepare-audio/backend/{index,pipeline-guidelines,error-handling,asset-secrecy,directory-structure,quality-guidelines}.md`、
      `.trellis/spec/shared/backend/protocol-and-contracts.md`、
      `.trellis/spec/server/backend/{quality-guidelines,secrecy-and-anticheat}.md`
- [x] **不动**：`.trellis/workspace/`、`.trellis/tasks/archive/`、`journal-*`（历史叙述）

**验证**：`rg -n "243|1458|233|234|1404|1464"` 剩余命中逐条判定「历史 or 现值」。
→ 剩余三条命中全部是**有意保留的历史/无关值**：`library.ts` 注释里的「原本各自写死 234 首」、
`PROGRESS.md` 增量耗时行里的「243 命缓存 / 1458 跳过」、`Backdrop.tsx` 里作为颜色分量的 `243`。

---

## 阶段 5 · 全量验证

- [x] `pnpm -r typecheck`：5/5 干净
- [x] `pnpm -r test`：412 passed（含 `app.test.ts` 的 272 断言）
- [x] `pnpm --filter @scg/web build`：成功（dist 正常产出，预压缩 3 个文件）
- [x] 端到端抽题：见阶段 3 最后两条
- [x] `PORT=5199 pnpm --filter @scg/server start` → `GET /api/health` = 272；单机会话正常、
      `/api/clip/<sid>/<token>` 返回 `200 / audio/ogg / 151504 B / no-store`
      （新曲切片与老曲**字节数完全相同**，大小旁路没有因为扩容被打开）
- [x] 29 首无人声 → 用户用 `pnpm assets audit`（:5178）试听确认（唯一的人工项，已过）

---

## 阶段 6 · 收尾

- [x] `.trellis/spec/prepare-audio/backend/*` 记下 ingest 这个新环节、「不进 all」的边界，
      以及「规划期必须拒绝漏列的 wav」这条判据
- [ ] 提交（工作提交 → archive → journal，三段式，不 amend、不 push）
- [ ] 遗留项写清：线上 VPS 的 `assets/` 同步（部署动作）
