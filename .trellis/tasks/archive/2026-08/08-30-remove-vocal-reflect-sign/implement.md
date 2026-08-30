# 执行计划 — 移除人声版 リフレクトサイン (2022 Ver.)

> 关键顺序坑：**切片 id 是随机的，映射只存在于当前 `manifest.private.json` 的 `sliceIndex` 里。
> 一旦重跑 manifest 阶段把它覆盖掉，那 6 个 `.opus` 就永远变成查不出身份的孤儿。
> 所以 Step 1 必须在 Step 3 之前完成，并把 id 落盘。**

环境事实（已核实）：

- `aacFallback: false` → 只有 `.opus`，没有 `.m4a` 兜底副本。
- 缓存布局：`assets/.cache/analysis/<songId>.json`、`assets/.cache/slices/<songId>.json`、`assets/.cache/scan.json`。
- `pnpm assets all` = scan → slice（内部触发 analyze）→ covers → manifest，全部按内容缓存。
- 重建前基线：`songs` 234 首 / `sliceIndex` 1404 条。

---

## Step 1 — 取证：捞出待删的 sliceId 与基线快照 ⛔ 回滚点前置

在动任何东西之前执行。产物写进任务目录，便于回滚与验收。

```bash
python - <<'PY'
import json, pathlib
SID = "リフレクトサイン-(2022-Ver.)-cd76f3"
d = json.load(open('assets/manifest.private.json', encoding='utf-8'))
doomed = sorted(k for k, v in d['sliceIndex'].items() if v['songId'] == SID)
baseline = {k: v for k, v in d['sliceIndex'].items() if v['songId'] != SID}
out = pathlib.Path('.trellis/tasks/08-30-remove-vocal-reflect-sign')
out.joinpath('doomed-slices.json').write_text(
    json.dumps({'songId': SID, 'sliceIds': doomed,
                'baselineSongs': len(d['songs']),
                'baselineSlices': len(d['sliceIndex']),
                'survivingSliceIndex': baseline},
               ensure_ascii=False, indent=2), encoding='utf-8')
print('待删切片:', len(doomed), doomed)
print('基线: songs =', len(d['songs']), ' slices =', len(d['sliceIndex']))
PY
```

**验证**：输出 `待删切片: 6`，基线 `songs = 234  slices = 1404`。
若不是 6，停下来排查（可能已被部分处理过）。

---

## Step 2 — 删除源素材（R1）

```bash
rm -rf "songs/闪彩off vocal无重复_Page18/リフレクトサイン (2022 Ver.) - Team.Luna"
```

**验证**：

```bash
ls -d songs/*/*リフレクトサイン*
```
只应剩 `songs/闪彩off vocal无重复_Page20/リフレクトサイン (Off Vocal) - Team.Luna/`（AC1）。

---

## Step 3 — 删除该曲的构建产物与缓存（R2 / AC4）

```bash
python - <<'PY'
import json, pathlib
t = pathlib.Path('.trellis/tasks/08-30-remove-vocal-reflect-sign/doomed-slices.json')
info = json.loads(t.read_text(encoding='utf-8'))
SID = info['songId']
removed = []
for sid in info['sliceIds']:
    for ext in ('.opus', '.m4a'):
        p = pathlib.Path('assets/slices') / sid[:2] / f'{sid}{ext}'
        if p.exists():
            p.unlink(); removed.append(str(p))
for d in ('assets/cover', 'assets/thumb'):
    p = pathlib.Path(d) / f'{SID}.webp'
    if p.exists():
        p.unlink(); removed.append(str(p))
for d in ('assets/.cache/analysis', 'assets/.cache/slices'):
    p = pathlib.Path(d) / f'{SID}.json'
    if p.exists():
        p.unlink(); removed.append(str(p))
print(f'已删 {len(removed)} 个文件:')
for r in removed: print(' ', r)
PY
```

**验证**：应删除 6 个 `.opus` + 2 个 `.webp` + 2 个缓存 json = **10 个文件**（无 `.m4a`）。

---

## Step 4 — 重建 assets（R2 / C2 / C3）

```bash
pnpm assets all
```

**⚠️ 观察缓存命中率。** 控制台会打印 `[analyze] 缓存命中 N/233` 之类的行。
- 期望：analyze / slice 阶段 **233/233 全命中**，只有 manifest 阶段真正重写。
- 若出现大规模重编码（命中率远低于 233），**立刻中断**——说明踩到了缓存 key，回到 Step 1 的快照排查，不要硬跑完（C2）。

---

## Step 5 — 验证产物（AC2 / AC3 / AC5 / AC6 / AC7）

```bash
python - <<'PY'
import json, pathlib
SID = "リフレクトサイン-(2022-Ver.)-cd76f3"
t = json.loads(pathlib.Path('.trellis/tasks/08-30-remove-vocal-reflect-sign/doomed-slices.json').read_text(encoding='utf-8'))
priv = json.load(open('assets/manifest.private.json', encoding='utf-8'))
pub  = json.load(open('assets/manifest.public.json',  encoding='utf-8'))

ok = True
def chk(label, cond, extra=''):
    global ok
    ok &= bool(cond)
    print(('  OK  ' if cond else ' FAIL ') + label + (f'  {extra}' if extra else ''))

chk('AC2 songs == 233', len(priv['songs']) == 233, len(priv['songs']))
chk('AC2 sliceIndex == 1398', len(priv['sliceIndex']) == 1398, len(priv['sliceIndex']))
chk('AC2 private 无该 songId', all(s['id'] != SID for s in priv['songs']))
chk('AC2 sliceIndex 无该 songId', all(v['songId'] != SID for v in priv['sliceIndex'].values()))

pubsongs = pub['songs'] if isinstance(pub, dict) else pub
titles = [s['title'] for s in pubsongs]
chk('AC3 public 无 2022 Ver.', 'リフレクトサイン (2022 Ver.)' not in titles)
chk('AC3 public 只剩 1 首 リフレクトサイン', titles.count('リフレクトサイン') == 1)

from collections import Counter
groups = Counter(s['confusableGroup'] for s in priv['songs'] if s.get('confusableGroup'))
chk('AC5 只剩 Migratory Echoes 一组', set(groups) == {'Migratory Echoes'}, dict(groups))

base = t['survivingSliceIndex']
same = all(priv['sliceIndex'].get(k) == v for k, v in base.items())
chk('AC7 其余 233 首 sliceId 逐一不变', same and len(base) == 1398)

print('\n=> ' + ('全部通过' if ok else '有失败项'))
PY
```

`pnpm assets all` 内部已跑 `assertPublicManifestClean` / `selfCheck`（AC6）；若它失败，构建会直接非零退出，Step 4 就不会通过。

再确认切片目录里没有孤儿：

```bash
python - <<'PY'
import json, pathlib
priv = json.load(open('assets/manifest.private.json', encoding='utf-8'))
known = set(priv['sliceIndex'])
on_disk = {p.stem for p in pathlib.Path('assets/slices').rglob('*.opus')}
print('磁盘切片:', len(on_disk), ' manifest:', len(known))
print('孤儿:', sorted(on_disk - known) or '无')
print('缺失:', sorted(known - on_disk) or '无')
PY
```

**验证**：孤儿与缺失均为「无」，磁盘 = manifest = 1398。

---

## Step 6 — 更新代码注释与测试断言（R3）

不要用全局替换，逐处改：

1. `apps/server/src/app.test.ts:47` — `toBe(234)` → `toBe(233)`
2. `packages/game-core/src/deal.ts:10` — 删掉「`リフレクトサイン` 有 2 个」，改成只讲 `Migratory Echoes` 的 9 个版本
3. `packages/game-core/src/karuta.test.ts:65` — 同步注释措辞（**测试本体用 `makeSongs` 合成数据，`reflect-sign` 组是构造出来的，不要动逻辑**，只改注释里对真实曲库的描述）
4. `tools/prepare-audio/src/util/text.ts:31` — 改写为：此前混入过一首没有后缀的人声版，已剔除；正则保持可选以容错（**`OFF_VOCAL_SUFFIX` 正则本体一个字符都不改** — C1 / AC10）
5. `tools/prepare-audio/src/util/text.ts:40` — 举例只留 `Migratory Echoes`，并把「10 个版本」改成 **9 个**（现有数字是错的）
6. `tools/prepare-audio/src/slice.ts:62` — 注释「全部 234 个 mp3」→ 233

---

## Step 7 — 更新 spec 文档（R3 / AC9）

逐个文件改，注意每处 `234` 的语境（有的是曲目数，有的在句子里做定语）：

- `.trellis/spec/prepare-audio/backend/index.md:3`
- `.trellis/spec/prepare-audio/backend/asset-secrecy.md:37`
- `.trellis/spec/prepare-audio/backend/pipeline-guidelines.md:4, 24, 86, 98, 99`（98/99 是示例控制台输出，`[scan] 234 首` / `[analyze] 缓存命中 234/234`）
- `.trellis/spec/server/backend/quality-guidelines.md:17`
- `.trellis/spec/server/backend/secrecy-and-anticheat.md:26, 61`

顺带检查 `packages/game-core` 与 `apps/web` 的 spec 是否也有曲目数表述：

```bash
grep -rn "234" --include="*.md" .trellis/spec/
grep -rn "1404" --include="*.md" --include="*.ts" .trellis/spec/ apps/ packages/ tools/
```

（1404 = 234×6，若有硬编码需同步为 1398。）

---

## Step 8 — 全量验证（AC8 / AC9 / AC10）

```bash
pnpm -r typecheck && pnpm -r test
```

```bash
# AC9：仓库内不应再有指代曲目数的 234
grep -rn "234" --include="*.ts" --include="*.md" --include="*.json" \
  apps/ packages/ tools/ .trellis/spec/

# AC10：正则未被改动
grep -n "OFF_VOCAL_SUFFIX" tools/prepare-audio/src/util/text.ts
git diff tools/prepare-audio/src/util/text.ts   # 只应有注释行变化
```

可选的端到端确认：`pnpm assets preview` 抽一局看看牌面正常。

---

## Step 9 — 销毁取证文件 ⚠️ 提交前必做

`doomed-slices.json` 里的 `survivingSliceIndex` 是**全部 1398 个 `sliceId → songId` 的完整映射** ——
即 `asset-secrecy.md` 所说「唯一能把切片还原回答案」的那张表。而 `.trellis/tasks/` 是**入库**的
（`.gitignore` 里有 `!.trellis/tasks/`）。它一旦被提交，等于把答案表推上仓库。

验收通过后立刻删除，不要留到 commit 阶段再想起来：

```bash
rm .trellis/tasks/08-30-remove-vocal-reflect-sign/doomed-slices.json
```

> 教训：往入库的任务目录里写 pipeline 中间产物之前，先问一句「这里面有没有 private manifest 的内容」。

---

## 回滚点

| 阶段 | 回滚方式 |
|---|---|
| Step 2 之后 | 源目录已删且不在 git 里 —— **不可逆**。执行前确认 Step 1 快照已落盘；素材本身可从原下载来源重取。 |
| Step 3 之后 | 切片/封面已删 —— 通过 `pnpm assets all` 从源 mp3 重新编码即可恢复（id 会变）。 |
| Step 4/5 失败 | 保留现场，用 `doomed-slices.json` 里的基线对照排查，不要盲目重跑。 |
| Step 6–8 | 纯代码/文档改动，`git checkout --` 即可回退。 |

## 审查关口

- **Step 1 之后**：确认捞到的是 6 个 id，且基线 234/1404 —— 数字不对就别往下走。
- **Step 4 之中**：缓存命中率不对就中断（C2）。
- **Step 5 之后**：产物验证全绿，才开始改代码；否则先修产物。
- **Step 8 之后**：`git diff` 通读一遍，确认没有误伤 `OFF_VOCAL_SUFFIX` 正则和 `karuta.test.ts` 的测试逻辑。
