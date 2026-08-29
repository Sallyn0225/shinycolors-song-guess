export const AUDIT_PAGE = /* html */ `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>切片可辨识度抽检</title>
<style>
:root{color-scheme:dark;--bg:#0B0E1A;--panel:#141a2e;--panel2:#1b2440;--line:#232c47;
  --line2:#2e3a5c;--fg:#e8ecf5;--dim:#8792ad}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:20;background:rgba(11,14,26,.92);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:12px 20px}
.nav{display:flex;gap:4px}
.nav a{padding:7px 14px;border-radius:8px;text-decoration:none;font-size:14px;color:var(--dim)}
.nav a.on{background:var(--panel2);color:var(--fg)}
.nav a:hover{color:var(--fg)}
main{display:grid;place-items:center;padding:40px 0}
.wrap{width:min(560px,92vw)}
h1{font-size:18px;font-weight:600;letter-spacing:.02em;margin:0 0 4px}
.sub{color:var(--dim);font-size:13px;margin-bottom:28px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px}
.count{font-variant-numeric:tabular-nums;color:var(--dim);font-size:13px}
button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid var(--line2);
  background:var(--panel2);color:var(--fg);padding:12px 16px;transition:.12s}
button:hover:not(:disabled){background:#26325a;border-color:#3d4d7a}
button:disabled{opacity:.4;cursor:default}
.plays{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:18px 0 22px}
.plays button{padding:18px 8px;font-size:16px;background:#2a3768;border-color:#3d4d7a}
.plays small{display:block;color:var(--dim);font-size:12px;margin-top:2px}
.rates{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.r3{border-color:#1f6f4a}.r3:hover:not(:disabled){background:#18402f}
.r2{border-color:#7a6420}.r2:hover:not(:disabled){background:#3d3418}
.r1{border-color:#7a2b2b}.r1:hover:not(:disabled){background:#3d1c1c}
.answer{margin-top:22px;padding-top:18px;border-top:1px solid var(--line);min-height:52px}
.title{font-size:17px;font-weight:600}
.meta{color:var(--dim);font-size:13px}
.hidden{visibility:hidden}
.stats{margin-top:24px;font-size:13px;color:var(--dim)}
.bar{display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0;background:var(--panel2)}
.bar i{display:block}
</style></head><body>

<header>
  <div class="nav">
    <a href="/" class="on">抽检</a>
    <a href="/review">归属编辑</a>
  </div>
</header>

<main><div class="wrap">
<h1>切片可辨识度抽检</h1>
<div class="sub">听伴奏片段，判断能否认出是哪首歌。这一步决定游戏是否成立——off vocal 抽走了主旋律载体，某些片段客观上无法辨认。<br>两个按钮对应两档难度的片段长度，<b>先按 6 秒听</b>；不够再听 8 秒。评分会记录你最后用的时长。</div>
<div class="card">
  <div class="count" id="count"></div>
  <div class="plays">
    <button data-sec="6">▶ 6 秒<small>困难</small></button>
    <button data-sec="8">▶ 8 秒<small>简单 · 联机</small></button>
  </div>
  <div class="rates">
    <button class="r3" data-s="3" disabled>一听就认出</button>
    <button class="r2" data-s="2" disabled>想一下能认</button>
    <button class="r1" data-s="1" disabled>完全认不出</button>
  </div>
  <div class="answer hidden" id="answer">
    <div class="title" id="atitle"></div>
    <div class="meta" id="ameta"></div>
  </div>
</div>
<div class="stats" id="stats"></div>
</div></main>

<script>
let cur = null, ctx = null, buf = null, lastSecs = null, heard = [];
const $ = (id) => document.getElementById(id);

async function load() {
  const r = await fetch('/api/next').then(x => x.json());
  cur = r; buf = null; lastSecs = null; heard = [];
  $('count').textContent = '已评 ' + r.rated + ' 个 · 共 ' + r.total + ' 个切片';
  $('answer').classList.add('hidden');
  document.querySelectorAll('.rates button').forEach(b => b.disabled = true);
  document.querySelectorAll('.plays button').forEach(b => b.disabled = false);
  renderStats(r.dist);
}

async function play(secs) {
  ctx = ctx || new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  if (!buf) {
    const ab = await fetch('/clip/' + cur.sliceId).then(x => x.arrayBuffer());
    buf = await ctx.decodeAudioData(ab);
  }
  const g = ctx.createGain(), src = ctx.createBufferSource();
  const t0 = ctx.currentTime + 0.05;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 0.025);
  g.gain.setValueAtTime(1, t0 + secs - 0.06);
  g.gain.linearRampToValueAtTime(0.0001, t0 + secs);
  src.buffer = buf; src.connect(g).connect(ctx.destination);
  src.start(t0, 0, secs + 0.01); src.stop(t0 + secs + 0.01);
  lastSecs = secs; if (!heard.includes(secs)) heard.push(secs);
  document.querySelectorAll('.rates button').forEach(b => b.disabled = false);
}

async function rate(score) {
  await fetch('/api/rate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...cur, score, ratedAtSeconds: lastSecs, heardSeconds: heard.slice() }),
  });
  $('atitle').textContent = cur.title;
  $('ameta').textContent = (cur.unit || '—') + ' · 第 ' + (cur.sliceIndex + 1) + ' 段 · 原曲 ' + cur.startSec.toFixed(0) + 's 处';
  $('answer').classList.remove('hidden');
  document.querySelectorAll('.rates button').forEach(b => b.disabled = true);
  setTimeout(load, 1600);
}

function renderStats(d) {
  const tot = d[1] + d[2] + d[3];
  if (!tot) { $('stats').textContent = ''; return; }
  const pct = (n) => (n / tot * 100).toFixed(0) + '%';
  $('stats').innerHTML =
    '<div class="bar">' +
      '<i style="background:#2f9e6b;width:' + pct(d[3]) + '"></i>' +
      '<i style="background:#b8942f;width:' + pct(d[2]) + '"></i>' +
      '<i style="background:#b84545;width:' + pct(d[1]) + '"></i>' +
    '</div>一听就认出 ' + d[3] + ' · 想一下能认 ' + d[2] + ' · 完全认不出 ' + d[1] +
    '（' + pct(d[1]) + ' 认不出）';
}

document.querySelectorAll('.plays button').forEach(b => b.onclick = () => play(+b.dataset.sec));
document.querySelectorAll('.rates button').forEach(b => b.onclick = () => rate(+b.dataset.s));
load();
</script></body></html>`
