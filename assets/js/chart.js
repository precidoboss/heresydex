// ==================== CHART ====================
// Price history comes from two places:
//   1. On-chain backfill — every pool is a Uniswap-V2-style pair, so each
//      trade emits Sync(reserve0, reserve1). We read those logs over the last
//      7 days with eth_getLogs and rebuild the price curve. This is what makes
//      the chart useful on the very first visit (the old chart only filled in
//      from live ticks stored in the visitor's own browser).
//   2. Live ticks — every 20s poll appends a point (see recordAllPricePoints).
// Everything is priced in WHERESY (1:1 with HERESY) straight from reserves.
// USD mode multiplies by the *current* HERESY/USD rate, so it is approximate.
const HIST_KEY = 'heresy_hist_v2';
const SYNC_TOPIC = ethers.id('Sync(uint112,uint112)');
const HIST_WINDOW_SECS = 7 * 24 * 3600;
const HIST_BUCKET_MS = 60 * 1000;
const HIST_MAX_POINTS = 4000;
const CHART_RANGES = { '1H': 3600, '6H': 6 * 3600, '24H': 86400, '7D': 7 * 86400, 'ALL': 0 };

let chartRange = '24H';
let chartDenom = 'native';      // 'native' (priced in HERESY / BOB) | 'usd'
let histData = {};              // key -> [[tMs, wheresyPerToken], ...] ascending
let histMeta = { lastBlock: 0, avgBt: 2 };
let histState = 'idle';         // idle | loading | ready | failed

function loadHist() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY) || 'null');
    if (raw && raw.v === 2 && raw.points) {
      histData = raw.points;
      histMeta = { lastBlock: raw.lastBlock || 0, avgBt: raw.avgBt || 2 };
    }
  } catch (e) { histData = {}; }
}
function saveHist() {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify({ v: 2, lastBlock: histMeta.lastBlock, avgBt: histMeta.avgBt, points: histData }));
  } catch (e) { /* quota — fine, we just refetch next time */ }
}

function setChartStatus(msg) {
  const el = document.getElementById('chart-status');
  if (el) el.textContent = msg;
}

async function backfillHistory() {
  if (histState === 'loading') return;
  histState = 'loading';
  setChartStatus('Loading on-chain history…');
  renderChart();
  const poolKeys = Object.keys(TOKENS).filter(k => TOKENS[k].pool);
  try {
    const latest = await roProvider.getBlockNumber();
    const latestBlk = await roProvider.getBlock(latest);
    const sampleN = Math.max(0, latest - 20000);
    const sampleBlk = await roProvider.getBlock(sampleN);
    let avgBt = latest > sampleN ? (latestBlk.timestamp - sampleBlk.timestamp) / (latest - sampleN) : 2;
    if (!isFinite(avgBt) || avgBt < 0.05) avgBt = 2;
    histMeta.avgBt = avgBt;

    let fromBlock = Math.max(0, latest - Math.ceil(HIST_WINDOW_SECS / avgBt));
    if (histMeta.lastBlock && histMeta.lastBlock < latest && histMeta.lastBlock >= fromBlock) fromBlock = histMeta.lastBlock + 1;
    else if (histMeta.lastBlock >= latest) fromBlock = latest + 1; // nothing new

    // token0 ordering per pool (needed to know which reserve is which)
    const t0 = await Promise.allSettled(poolKeys.map(k => new ethers.Contract(TOKENS[k].pool, PAIR_ABI, roProvider).token0()));
    const byPool = {};
    poolKeys.forEach((k, i) => {
      if (t0[i].status !== 'fulfilled') return;
      byPool[TOKENS[k].pool.toLowerCase()] = { key: k, tokenIsToken0: t0[i].value.toLowerCase() === TOKENS[k].address.toLowerCase() };
    });
    const pools = Object.keys(byPool);
    if (pools.length === 0) throw new Error('no pools readable');

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const fresh = {};
    let span = 20000, start = fromBlock, requests = 0;
    while (start <= latest && requests < 300) {
      const end = Math.min(latest, start + span - 1);
      try {
        const logs = await roProvider.getLogs({ address: pools, topics: [SYNC_TOPIC], fromBlock: start, toBlock: end });
        for (const log of logs) {
          const meta = byPool[log.address.toLowerCase()];
          if (!meta) continue;
          const [r0, r1] = coder.decode(['uint112', 'uint112'], log.data);
          const tokRaw = meta.tokenIsToken0 ? r0 : r1;
          const wheRaw = meta.tokenIsToken0 ? r1 : r0;
          const tok = parseFloat(ethers.formatUnits(tokRaw, TOKENS[meta.key].decimals));
          const whe = parseFloat(ethers.formatUnits(wheRaw, 18));
          if (!(tok > 0) || !(whe > 0)) continue;
          const t = (latestBlk.timestamp - (latest - log.blockNumber) * avgBt) * 1000;
          (fresh[meta.key] = fresh[meta.key] || []).push([Math.round(t), whe / tok]);
        }
        start = end + 1;
        requests++;
        setChartStatus(`Loading on-chain history… ${Math.min(100, Math.round(((start - fromBlock) / Math.max(1, latest - fromBlock + 1)) * 100))}%`);
      } catch (e) {
        if (span > 500) { span = Math.floor(span / 2); continue; } // RPC range/result limit — shrink and retry
        throw e;
      }
    }

    const cutoff = Date.now() - HIST_WINDOW_SECS * 1000;
    poolKeys.forEach(k => {
      const merged = (histData[k] || []).concat(fresh[k] || []).filter(p => p[0] >= cutoff);
      merged.sort((a, b) => a[0] - b[0]);
      const buckets = new Map();
      merged.forEach(p => buckets.set(Math.floor(p[0] / HIST_BUCKET_MS), p)); // last-in-bucket wins
      let out = Array.from(buckets.values());
      if (out.length > HIST_MAX_POINTS) out = out.slice(out.length - HIST_MAX_POINTS);
      histData[k] = out;
    });
    histMeta.lastBlock = latest;
    saveHist();
    histState = 'ready';
    const n = (histData[chartTokenKey] || []).length;
    setChartStatus(`On-chain history · ${n} point${n === 1 ? '' : 's'} (last 7d) + live ticks every 20s`);
  } catch (e) {
    console.warn('history backfill failed', e);
    histState = 'failed';
    setChartStatus('Live ticks only — on-chain history unavailable from this RPC right now');
  }
  renderChart();
  if (typeof renderMarkets === 'function') renderMarkets();
}

// ---- series assembly ----
function chartableTokens() {
  return Object.keys(TOKENS).filter(k => k === 'HERESY' || k === 'WHERESY' || TOKENS[k].pool);
}
function quoteSymbolFor(key) {
  if (chartDenom === 'usd') return 'USD';
  return (key === 'HERESY' || key === 'WHERESY') ? 'BOB' : 'HERESY';
}
// raw series in WHERESY-per-token for a pool token (history + live ticks)
function rawPoolSeries(key) {
  const out = (histData[key] || []).slice();
  const live = (priceHistory[key] || []);
  live.forEach(p => { if (p.wheresy > 0) out.push([p.t, p.wheresy]); });
  out.sort((a, b) => a[0] - b[0]);
  const cur = poolData[key];
  if (cur && cur.tokenReserve > 0) out.push([Date.now(), cur.wheresyReserve / cur.tokenReserve]);
  return out;
}
// series in display units: [{t, v}]
function seriesFor(key) {
  const poolKey = (key === 'HERESY' || key === 'WHERESY') ? 'BOB' : key;
  const raw = rawPoolSeries(poolKey);
  const inverse = (key === 'HERESY' || key === 'WHERESY');
  let pts = raw.map(p => ({ t: p[0], v: inverse ? 1 / p[1] : p[1] }));
  if (chartDenom === 'usd') {
    if (inverse) {
      // raw p[1] = HERESY per BOB, so 1 HERESY = bobUsd / p[1] USD
      pts = raw.map(p => ({ t: p[0], v: bobUsd / p[1] }));
    } else {
      pts = pts.map(p => ({ t: p.t, v: p.v * wheresyUsd }));
    }
    pts = pts.filter(p => isFinite(p.v) && p.v > 0);
  }
  return pts;
}
function rangedSeries(key) {
  let pts = seriesFor(key);
  const secs = CHART_RANGES[chartRange];
  const now = Date.now();
  if (secs) {
    const cutoff = now - secs * 1000;
    const before = pts.filter(p => p.t < cutoff);
    pts = pts.filter(p => p.t >= cutoff);
    // price at the left edge = last known price before the window
    if (before.length) pts.unshift({ t: cutoff, v: before[before.length - 1].v });
    else if (pts.length === 1) pts.unshift({ t: cutoff, v: pts[0].v });
    if (pts.length === 1) pts.unshift({ t: cutoff, v: pts[0].v });
  } else if (pts.length === 1) {
    pts.unshift({ t: now - HIST_WINDOW_SECS * 1000, v: pts[0].v });
  }
  // downsample for rendering
  const MAX = 320;
  if (pts.length > MAX) {
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, step = (t1 - t0) / MAX || 1;
    const m = new Map();
    pts.forEach(p => m.set(Math.floor((p.t - t0) / step), p));
    pts = Array.from(m.values());
  }
  return pts;
}

function fmtChartVal(v) { return chartDenom === 'usd' ? fmtUsd(v) : fmtAdaptive(v); }
function fmtChartValUnit(v) { return chartDenom === 'usd' ? fmtUsd(v) : fmtAdaptive(v) + ' ' + quoteSymbolFor(chartTokenKey); }
function fmtAxisTime(ms) {
  const d = new Date(ms);
  const secs = CHART_RANGES[chartRange];
  if (secs && secs <= 86400) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- UI ----
function buildChartTabs() {
  const wrap = document.getElementById('chart-tabs');
  wrap.innerHTML = '';
  chartableTokens().forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'chart-tab' + (key === chartTokenKey ? ' active' : '');
    btn.dataset.key = key;
    btn.innerHTML = `<img src="${iconFor(key)}" alt=""/><span>${key}</span>`;
    btn.onclick = () => setActiveChartToken(key);
    wrap.appendChild(btn);
  });
  const rw = document.getElementById('chart-ranges');
  rw.innerHTML = '';
  Object.keys(CHART_RANGES).forEach(r => {
    const b = document.createElement('button');
    b.className = 'range-btn' + (r === chartRange ? ' active' : '');
    b.textContent = r;
    b.onclick = () => setChartRange(r);
    rw.appendChild(b);
  });
}
function setActiveChartToken(key) {
  chartTokenKey = key;
  document.querySelectorAll('.chart-tab').forEach(el => el.classList.toggle('active', el.dataset.key === key));
  renderChart();
}
function setChartRange(r) {
  chartRange = r;
  document.querySelectorAll('#chart-ranges .range-btn').forEach(b => b.classList.toggle('active', b.textContent === r));
  renderChart();
}
function setChartDenom(d) {
  chartDenom = d;
  document.querySelectorAll('#chart-denom .range-btn').forEach(b => b.classList.toggle('active', b.dataset.d === d));
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  renderChart();
}

const crosshairPlugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const a = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!a.length) return;
    const x = a[0].element.x, { top, bottom } = chart.chartArea, c = chart.ctx;
    c.save(); c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom);
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,149,0,.45)'; c.setLineDash([4, 4]); c.stroke(); c.restore();
  }
};

function renderChart() {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;
  const key = chartTokenKey;
  if (!TOKENS[key]) return;
  document.getElementById('chart-icon').src = iconFor(key);
  document.getElementById('chart-sym').textContent = (key === 'HERESY' || key === 'WHERESY') && chartDenom !== 'usd' ? `${key} / BOB` : (chartDenom === 'usd' ? `${key} / USD` : `${key} / HERESY`);

  const empty = document.getElementById('chart-empty');
  const changeEl = document.getElementById('chart-change');
  if (typeof Chart === 'undefined') {
    empty.style.display = 'flex';
    empty.innerHTML = 'Chart library failed to load (network or ad-blocker). <button class="btn btn-ghost btn-sm" onclick="location.reload()">Reload</button>';
    return;
  }

  const data = rangedSeries(key);
  const loading = histState === 'loading' && data.length < 2;
  if (data.length < 2) {
    empty.style.display = 'flex';
    empty.textContent = loading ? 'Loading on-chain price history…' : 'No price data yet for this pair — it appears as soon as the pool reserves load.';
    canvas.style.visibility = 'hidden';
    changeEl.textContent = '–'; changeEl.className = 'chart-change flat';
    ['stat-high', 'stat-low', 'stat-liq'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = '–'; });
    if (priceChart) { priceChart.destroy(); priceChart = null; }
    return;
  }
  empty.style.display = 'none';
  canvas.style.visibility = 'visible';

  const first = data[0].v, last = data[data.length - 1].v;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const hi = Math.max(...data.map(p => p.v)), lo = Math.min(...data.map(p => p.v));
  document.getElementById('chart-px').textContent = fmtChartValUnit(last);
  changeEl.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(2) + '%';
  changeEl.className = 'chart-change ' + (pct > 0.001 ? 'up' : pct < -0.001 ? 'down' : 'flat');
  document.getElementById('stat-high').textContent = fmtChartVal(hi);
  document.getElementById('stat-low').textContent = fmtChartVal(lo);
  const poolKey = (key === 'HERESY' || key === 'WHERESY') ? 'BOB' : key;
  const pd = poolData[poolKey];
  const liqEl = document.getElementById('stat-liq');
  if (pd && pd.wheresyReserve > 0) {
    const liqHeresy = pd.wheresyReserve * 2;
    liqEl.textContent = wheresyUsd > 0 ? fmtUsd(liqHeresy * wheresyUsd) : fmtAdaptive(liqHeresy) + ' HERESY';
  } else liqEl.textContent = '–';

  const rising = last >= first;
  const color = rising ? '#22C55E' : '#FF4A1C';
  const points = data.map(p => ({ x: p.t, y: p.v }));

  if (priceChart) {
    priceChart.data.datasets[0].data = points;
    priceChart.data.datasets[0].borderColor = color;
    priceChart.data.datasets[0]._rising = rising;
    priceChart.update('none');
    return;
  }
  priceChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [crosshairPlugin],
    data: {
      datasets: [{
        data: points, borderColor: color, borderWidth: 2, fill: true, tension: 0.25,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#FF9500', pointHoverBorderColor: '#0A0A0A', pointHoverBorderWidth: 2,
        backgroundColor: (ctx) => {
          const ch = ctx.chart, a = ch.chartArea;
          if (!a) return 'transparent';
          const up = ch.data.datasets[0]._rising !== false;
          const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, up ? 'rgba(34,197,94,.32)' : 'rgba(255,74,28,.32)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          return g;
        },
        _rising: rising
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { intersect: false, mode: 'nearest', axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(14,14,16,.96)', borderColor: '#2E2E33', borderWidth: 1,
          titleColor: '#8C8C94', bodyColor: '#F4F4F5', bodyFont: { family: 'DM Mono', size: 13 }, titleFont: { family: 'DM Mono', size: 11 },
          padding: 10, displayColors: false,
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            label: (c) => fmtChartValUnit(c.parsed.y)
          }
        }
      },
      scales: {
        x: {
          type: 'linear', grid: { display: false }, border: { display: false },
          ticks: { color: '#6E6E76', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 5, maxRotation: 0, callback: (v) => fmtAxisTime(v) }
        },
        y: {
          position: 'right', grace: '8%', border: { display: false },
          grid: { color: 'rgba(255,255,255,.045)' },
          ticks: { color: '#6E6E76', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 5, callback: (v) => fmtChartVal(v) }
        }
      }
    }
  });
}
