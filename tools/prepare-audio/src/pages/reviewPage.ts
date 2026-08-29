export const REVIEW_PAGE = /* html */ `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>演唱者归属编辑</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0B0E1A; --panel:#141a2e; --panel2:#1b2440; --line:#232c47; --line2:#2e3a5c;
  --fg:#e8ecf5; --dim:#8792ad; --accent:#6d8bff;
  --hi:#e05252; --mid:#d0a13a; --lo:#3f9e6b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
a{color:inherit}
header{position:sticky;top:0;z-index:20;background:rgba(11,14,26,.92);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:12px 20px}
.nav{display:flex;gap:4px}
.nav a{padding:7px 14px;border-radius:8px;text-decoration:none;font-size:14px;color:var(--dim)}
.nav a.on{background:var(--panel2);color:var(--fg)}
.nav a:hover{color:var(--fg)}
.grow{flex:1}
.hint{font-size:13px;color:var(--dim)}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line2);
  background:var(--panel2);color:var(--fg);padding:8px 14px;transition:.12s}
button:hover:not(:disabled){background:#26325a;border-color:#3d4d7a}
button:disabled{opacity:.4;cursor:default}
button.primary{background:#2f4a9e;border-color:#4460c4}
button.primary:hover:not(:disabled){background:#3a5ac4}
button.ghost{background:transparent}
main{display:grid;grid-template-columns:264px 1fr;gap:20px;
  max-width:1400px;margin:0 auto;padding:20px}
aside{position:sticky;top:61px;align-self:start;max-height:calc(100vh - 81px);overflow:auto}
.box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.box h3{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.08em;
  text-transform:uppercase;color:var(--dim)}
input[type=text],input[type=search],select{width:100%;font:inherit;padding:8px 10px;
  border-radius:8px;border:1px solid var(--line2);background:#10152a;color:var(--fg)}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}
.filter{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
  padding:7px 10px;border-radius:8px;border:1px solid transparent;background:transparent;
  color:var(--fg);text-align:left;font-size:14px}
.filter:hover{background:var(--panel2)}
.filter.on{background:var(--panel2);border-color:var(--line2)}
.filter .n{color:var(--dim);font-variant-numeric:tabular-nums;font-size:13px}
.dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.swatch{width:10px;height:10px;border-radius:3px;flex:none;
  border:1px solid rgba(255,255,255,.25)}
label.chk{display:flex;align-items:center;gap:8px;font-size:14px;padding:6px 2px;cursor:pointer}
.rows{display:flex;flex-direction:column;gap:8px}
.row{background:var(--panel);border:1px solid var(--line);border-left-width:4px;
  border-radius:10px;padding:12px 14px;cursor:pointer;transition:.12s}
.row:hover{border-color:var(--line2);background:#171e35}
.row.open{border-color:var(--accent);background:#171e35}
.row .top{display:flex;align-items:center;gap:10px}
.title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--panel2);
  color:var(--dim);white-space:nowrap}
.badge.ov{background:#2a3f6e;color:#b9caff}
.src{font:12px ui-monospace,"Cascadia Code",Consolas,monospace;color:var(--dim)}
.sub{font-size:13px;color:var(--dim);margin-top:4px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.edit{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
  display:grid;grid-template-columns:1fr 1fr;gap:12px}
.edit .full{grid-column:1/-1}
.edit label{display:block;font-size:12px;color:var(--dim);margin-bottom:5px}
.acts{display:flex;gap:8px;align-items:center}
.empty{padding:48px;text-align:center;color:var(--dim)}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);
  background:#1f2b4d;border:1px solid var(--line2);border-radius:10px;padding:12px 20px;
  font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.5);opacity:0;pointer-events:none;
  transition:.2s;z-index:50}
.toast.show{opacity:1}
.toast.err{background:#4a1f22;border-color:#7a2b2b}
</style></head><body>

<header>
  <div class="nav">
    <a href="/">抽检</a>
    <a href="/review" class="on">归属编辑</a>
  </div>
  <div class="grow"></div>
  <span class="hint" id="hint"></span>
  <button class="primary" id="apply">写出 manifest</button>
</header>

<main>
  <aside>
    <div class="box">
      <h3>搜索</h3>
      <input type="search" id="q" placeholder="曲名 / 署名 / 专辑">
    </div>
    <div class="box">
      <h3>风险</h3>
      <div id="riskFilters"></div>
    </div>
    <div class="box">
      <h3>范围</h3>
      <label class="chk"><input type="checkbox" id="onlyChanged"> 只看被改写过署名的</label>
      <label class="chk"><input type="checkbox" id="onlyOverridden"> 只看已人工覆盖的</label>
    </div>
    <div class="box">
      <h3>组合</h3>
      <div id="unitFilters"></div>
    </div>
  </aside>

  <section>
    <div class="rows" id="rows"></div>
  </section>
</main>

<div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
let DATA = { rows: [], units: [], characters: [] };
let filter = { risk: null, unit: null, q: '', onlyChanged: false, onlyOverridden: false };
let openTitle = null;
let ctx = null;

const RISKS = [
  { k: '高', c: 'var(--hi)' },
  { k: '中', c: 'var(--mid)' },
  { k: '低', c: 'var(--lo)' },
];

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function unitOf(id) { return DATA.units.find(u => u.id === id); }

function changed(r) {
  return r.source.startsWith('album-') || r.source === 'seiyuu-table' || r.source === 'override';
}

function visible() {
  const q = filter.q.trim().toLowerCase();
  return DATA.rows.filter(r => {
    if (filter.risk && r.risk !== filter.risk) return false;
    if (filter.unit !== null && (r.unit ?? '') !== filter.unit) return false;
    if (filter.onlyChanged && !changed(r)) return false;
    if (filter.onlyOverridden && !r.isOverridden) return false;
    if (q && !(r.title + ' ' + r.fileArtist + ' ' + r.resolvedArtist + ' ' + r.album)
      .toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderFilters() {
  const rf = $('riskFilters');
  const mk = (label, count, active, onclick, dotColor, swatch) => {
    const b = document.createElement('button');
    b.className = 'filter' + (active ? ' on' : '');
    const left = document.createElement('span');
    left.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0';
    if (dotColor) {
      const d = document.createElement('i');
      d.className = 'dot'; d.style.background = dotColor;
      left.appendChild(d);
    }
    if (swatch !== undefined) {
      const d = document.createElement('i');
      d.className = 'swatch';
      d.style.background = swatch || 'transparent';
      if (!swatch) d.style.borderStyle = 'dashed';
      left.appendChild(d);
    }
    const t = document.createElement('span');
    t.textContent = label;
    t.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    left.appendChild(t);
    const n = document.createElement('span');
    n.className = 'n'; n.textContent = count;
    b.append(left, n);
    b.onclick = onclick;
    return b;
  };

  rf.replaceChildren(
    mk('全部', DATA.rows.length, filter.risk === null,
      () => { filter.risk = null; render(); }),
    ...RISKS.map(({ k, c }) => mk(k + '风险',
      DATA.rows.filter(r => r.risk === k).length,
      filter.risk === k,
      () => { filter.risk = filter.risk === k ? null : k; render(); }, c)),
  );

  const uf = $('unitFilters');
  const counts = new Map();
  for (const r of DATA.rows) {
    const k = r.unit ?? '';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  uf.replaceChildren(
    mk('全部组合', DATA.rows.length, filter.unit === null,
      () => { filter.unit = null; render(); }, null, undefined),
    ...entries.map(([id, n]) => {
      const u = unitOf(id);
      return mk(u ? u.name : '（未归属 / 跨组合）', n, filter.unit === id,
        () => { filter.unit = filter.unit === id ? null : id; render(); },
        null, u ? (u.color && u.color.startsWith('#') ? u.color : '') : '');
    }),
  );
}

function renderRow(r) {
  const el = document.createElement('div');
  const u = unitOf(r.unit);
  const stripe = u && u.color && u.color.startsWith('#') ? u.color : 'var(--line2)';
  el.className = 'row' + (openTitle === r.title ? ' open' : '');
  el.style.borderLeftColor = stripe;

  const risk = RISKS.find(x => x.k === r.risk);
  el.innerHTML =
    '<div class="top">' +
      '<i class="dot" style="background:' + risk.c + '" title="' + r.risk + '风险"></i>' +
      '<span class="title">' + esc(r.title) + '</span>' +
      (r.isOverridden ? '<span class="badge ov">已人工覆盖</span>' : '') +
      '<span class="badge">' + esc(u ? u.name : '未归属') + '</span>' +
      '<span class="src">' + esc(r.source) + '</span>' +
    '</div>' +
    '<div class="sub">' +
      (changed(r)
        ? '原署名 <b>' + esc(r.fileArtist) + '</b> &nbsp;→&nbsp; ' + esc(r.resolvedArtist)
        : esc(r.resolvedArtist)) +
      ' &nbsp;·&nbsp; ' + esc(r.album) +
    '</div>';

  el.onclick = (e) => {
    if (e.target.closest('.edit')) return;
    openTitle = openTitle === r.title ? null : r.title;
    render();
  };

  if (openTitle === r.title) el.appendChild(renderEditor(r));
  return el;
}

function renderEditor(r) {
  const box = document.createElement('div');
  box.className = 'edit';

  const unitSel = document.createElement('select');
  unitSel.innerHTML = '<option value="">（未归属 / 跨组合）</option>' +
    DATA.units.map(u => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('');
  unitSel.value = r.unit ?? '';

  const perf = document.createElement('input');
  perf.type = 'text';
  perf.setAttribute('list', 'chars');
  perf.placeholder = '留空则按组合处理；多人用 / 分隔';
  perf.value = (r.performers || []).join(' / ');

  const note = document.createElement('input');
  note.type = 'text';
  note.placeholder = '备注（可选，会写进 overrides.json）';

  const wrap = (labelText, node, full) => {
    const d = document.createElement('div');
    if (full) d.className = 'full';
    const l = document.createElement('label');
    l.textContent = labelText;
    d.append(l, node);
    return d;
  };

  const acts = document.createElement('div');
  acts.className = 'full acts';
  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = '保存归属';
  const reset = document.createElement('button');
  reset.className = 'ghost';
  reset.textContent = '恢复自动判定';
  reset.disabled = !r.isOverridden;
  const listen = document.createElement('button');
  listen.className = 'ghost';
  listen.textContent = '▶ 试听 8 秒';
  const why = document.createElement('span');
  why.className = 'hint';
  why.style.marginLeft = 'auto';
  why.textContent = r.why;

  save.onclick = async () => {
    save.disabled = true;
    const performers = perf.value.split(/[\\/、,，･・]/).map(s => s.trim()).filter(Boolean);
    const res = await post('/api/override', {
      title: r.title, unit: unitSel.value || null, performers, note: note.value,
    });
    save.disabled = false;
    if (res.ok) { toast('已保存：' + r.title); await reload(); }
    else toast(res.error || '保存失败', true);
  };
  reset.onclick = async () => {
    const res = await post('/api/override/clear', { title: r.title });
    if (res.ok) { toast('已恢复自动判定：' + r.title); await reload(); }
    else toast(res.error || '操作失败', true);
  };
  listen.onclick = async () => {
    try {
      ctx = ctx || new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const ab = await fetch('/clip/' + r.sampleSliceId).then(x => x.arrayBuffer());
      const buf = await ctx.decodeAudioData(ab);
      const g = ctx.createGain(), src = ctx.createBufferSource();
      const t0 = ctx.currentTime + 0.05, secs = 8;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 0.025);
      g.gain.setValueAtTime(1, t0 + secs - 0.06);
      g.gain.linearRampToValueAtTime(0.0001, t0 + secs);
      src.buffer = buf; src.connect(g).connect(ctx.destination);
      src.start(t0, 0, secs + 0.01); src.stop(t0 + secs + 0.01);
    } catch (e) { toast('试听失败：' + e, true); }
  };

  acts.append(save, reset, listen, why);
  box.append(
    wrap('组合', unitSel),
    wrap('演唱者（角色名）', perf),
    wrap('备注', note, true),
    acts,
  );
  return box;
}

function render() {
  renderFilters();
  const list = visible();
  $('hint').textContent = list.length + ' / ' + DATA.rows.length + ' 首 · 已人工覆盖 ' +
    DATA.rows.filter(r => r.isOverridden).length + ' 条';
  const rows = $('rows');
  if (!list.length) {
    rows.innerHTML = '<div class="empty">没有符合条件的曲目</div>';
    return;
  }
  rows.replaceChildren(...list.map(renderRow));
}

async function post(url, body) {
  try {
    return await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(x => x.json());
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function reload() {
  DATA = await fetch('/api/review').then(x => x.json());
  const dl = document.getElementById('chars') || document.createElement('datalist');
  dl.id = 'chars';
  dl.replaceChildren(...DATA.characters.map(c => {
    const o = document.createElement('option');
    o.value = c.name;
    o.label = c.unitName;
    return o;
  }));
  document.body.appendChild(dl);
  render();
}

$('q').oninput = (e) => { filter.q = e.target.value; render(); };
$('onlyChanged').onchange = (e) => { filter.onlyChanged = e.target.checked; render(); };
$('onlyOverridden').onchange = (e) => { filter.onlyOverridden = e.target.checked; render(); };
$('apply').onclick = async () => {
  $('apply').disabled = true;
  $('apply').textContent = '写出中…';
  const res = await post('/api/rebuild', {});
  $('apply').disabled = false;
  $('apply').textContent = '写出 manifest';
  toast(res.ok ? res.message : (res.error || res.message || '失败'), !res.ok);
};

reload();
</script></body></html>`
