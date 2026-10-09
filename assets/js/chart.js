// ==================== CHART ====================
// Dexscreener-style candlestick chart drawn on a <canvas> (no chart library).
// Data layer:
//   1. On-chain backfill: every pool is a Uniswap-V2-style pair, so each trade
//      emits Sync(reserve0, reserve1). We read those logs over the last 7 days
//      with eth_getLogs and rebuild the price curve.
//   2. Live ticks: every 20s poll appends a point (see recordAllPricePoints).
// Everything is priced in WHERESY (1:1 with HERESY) straight from reserves.
// USD mode multiplies by the *current* HERESY/USD rate, so it is approximate.

const HIST_KEY = 'heresy_hist_v2';
const SYNC_TOPIC = ethers.id('Sync(uint112,uint112)');
const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');
const HIST_WINDOW_SECS = 7 * 24 * 3600;
const HIST_BUCKET_MS = 60 * 1000;
const HIST_MAX_POINTS = 4000;

// secs: visible window (0 = all history); candle: candle width in seconds
const CHART_RANGES = {
  '1H':  { secs: 3600,           candle: 60 },
  '6H':  { secs: 6 * 3600,       candle: 5 * 60 },
  '24H': { secs: 86400,          candle: 15 * 60 },
  '7D':  { secs: 7 * 86400,      candle: 3600 },
  'ALL': { secs: 0,              candle: 4 * 3600 }
};

let chartRange = '24H';
let chartDenom = 'native';      // 'native' (priced in HERESY / BOB) | 'usd'
let histData = {};              // key -> [[tMs, wheresyPerToken], ...] ascending
let histMeta = { lastBlock: 0, avgBt: 2 };
let histState = 'idle';         // idle | loading | ready | failed

const UP_RGB = '34,197,94';
const DOWN_RGB = '255,74,28';
const ACCENT = '#FF9500';

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
  } catch (e) { /* quota: refetch next time */ }
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
    else if (histMeta.lastBlock >= latest) fromBlock = latest + 1;

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
    const freshTrades = [];
    let span = 20000, start = fromBlock, requests = 0;
    while (start <= latest && requests < 300) {
      const end = Math.min(latest, start + span - 1);
      try {
        const logs = await roProvider.getLogs({ address: pools, topics: [[SYNC_TOPIC, SWAP_TOPIC]], fromBlock: start, toBlock: end });
        for (const log of logs) {
          const meta = byPool[log.address.toLowerCase()];
          if (!meta) continue;
          const dec = TOKENS[meta.key].decimals;
          const t = (latestBlk.timestamp - (latest - log.blockNumber) * avgBt) * 1000;
          if (log.topics[0] === SYNC_TOPIC) {
            const [r0, r1] = coder.decode(['uint112', 'uint112'], log.data);
            const tokRaw = meta.tokenIsToken0 ? r0 : r1;
            const wheRaw = meta.tokenIsToken0 ? r1 : r0;
            const tok = parseFloat(ethers.formatUnits(tokRaw, dec));
            const whe = parseFloat(ethers.formatUnits(wheRaw, 18));
            if (!(tok > 0) || !(whe > 0)) continue;
            (fresh[meta.key] = fresh[meta.key] || []).push([Math.round(t), whe / tok]);
          } else if (log.topics[0] === SWAP_TOPIC) {
            const [a0i, a1i, a0o, a1o] = coder.decode(['uint256', 'uint256', 'uint256', 'uint256'], log.data);
            const tokIn = meta.tokenIsToken0 ? a0i : a1i, tokOut = meta.tokenIsToken0 ? a0o : a1o;
            const wheIn = meta.tokenIsToken0 ? a1i : a0i, wheOut = meta.tokenIsToken0 ? a1o : a0o;
            const side = wheIn > 0n ? 'buy' : 'sell';          // buy = WHERESY in, token out
            const tok = parseFloat(ethers.formatUnits(side === 'buy' ? tokOut : tokIn, dec));
            const whe = parseFloat(ethers.formatUnits(side === 'buy' ? wheIn : wheOut, 18));
            if (!(tok > 0) || !(whe > 0)) continue;
            freshTrades.push({ key: meta.key, t: Math.round(t), side, tok, whe,
              tx: log.transactionHash, idx: log.index, maker: '0x' + log.topics[2].slice(26) });
          }
        }
        start = end + 1;
        requests++;
        setChartStatus(`Loading on-chain history… ${Math.min(100, Math.round(((start - fromBlock) / Math.max(1, latest - fromBlock + 1)) * 100))}%`);
      } catch (e) {
        if (span > 500) { span = Math.floor(span / 2); continue; }
        throw e;
      }
    }

    const cutoff = Date.now() - HIST_WINDOW_SECS * 1000;
    poolKeys.forEach(k => {
      const merged = (histData[k] || []).concat(fresh[k] || []).filter(p => p[0] >= cutoff);
      merged.sort((a, b) => a[0] - b[0]);
      const buckets = new Map();
      merged.forEach(p => buckets.set(Math.floor(p[0] / HIST_BUCKET_MS), p));
      let out = Array.from(buckets.values());
      if (out.length > HIST_MAX_POINTS) out = out.slice(out.length - HIST_MAX_POINTS);
      histData[k] = out;
    });
    ingestTrades(freshTrades);
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
  if (typeof renderDetails === 'function') renderDetails();
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
  (priceHistory[key] || []).forEach(p => { if (p.wheresy > 0) out.push([p.t, p.wheresy]); });
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
  let pts;
  if (chartDenom === 'usd') {
    pts = inverse
      ? raw.map(p => ({ t: p[0], v: bobUsd / p[1] }))          // 1 HERESY = bobUsd / (HERESY per BOB)
      : raw.map(p => ({ t: p[0], v: p[1] * wheresyUsd }));
  } else {
    pts = raw.map(p => ({ t: p[0], v: inverse ? 1 / p[1] : p[1] }));
  }
  return pts.filter(p => isFinite(p.v) && p.v > 0);
}

// Aggregate points into OHLC candles. The last point before `start` seeds the
// first candle's open so the candle sequence is continuous.
function buildCandles(pts, candleSecs, start, end) {
  const size = candleSecs * 1000;
  const seed = pts.filter(p => p.t < start).pop();
  const work = (seed ? [{ t: start, v: seed.v }] : []).concat(pts.filter(p => p.t >= start && p.t <= end));
  const map = new Map();
  for (const p of work) {
    const k = Math.floor(p.t / size);
    let c = map.get(k);
    if (!c) { c = { t: k * size, o: p.v, h: p.v, l: p.v, c: p.v }; map.set(k, c); }
    if (p.v > c.h) c.h = p.v;
    if (p.v < c.l) c.l = p.v;
    c.c = p.v;
  }
  const sorted = Array.from(map.values()).sort((a, b) => a.t - b.t);
  // fill quiet periods with flat candles at the previous close (no gaps)
  const out = [];
  for (const c of sorted) {
    if (out.length) {
      const prev = out[out.length - 1];
      for (let t = prev.t + size; t < c.t && t - prev.t < 2000 * size; t += size) {
        out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, flat: true });
      }
    }
    out.push(c);
  }
  return out;
}

function chartWindow() {
  const r = CHART_RANGES[chartRange];
  const end = Date.now();
  const start = r.secs ? end - r.secs * 1000 : end - HIST_WINDOW_SECS * 1000;
  return { start, end, candleSecs: r.candle };
}

// ---- formatting ----
function fmtChartVal(v) { return chartDenom === 'usd' ? fmtUsd(v) : fmtAdaptive(v); }
function fmtChartValUnit(v) { return chartDenom === 'usd' ? fmtUsd(v) : fmtAdaptive(v) + ' ' + quoteSymbolFor(chartTokenKey); }
function fmtAxisTime(ms) {
  const d = new Date(ms);
  const secs = CHART_RANGES[chartRange].secs;
  if (secs && secs <= 86400) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function chClamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// ---- UI controls ----
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
  renderChart();
}

// ==================== CANVAS RENDERER ====================
const CV = {
  canvas: null, ctx: null, w: 0, h: 0, dpr: 1, started: false,
  candles: [], sig: '', enterT: 0,
  min: 0, max: 1, tMin: 0, tMax: 1, ready: false,   // y-domain (eased toward target)
  hoverX: null, hoverY: null, flashT: -1e9, lastClose: null
};
const CV_PAD = { l: 10, r: 74, t: 28, b: 26 };

function cvInit() {
  if (CV.started) return;
  CV.canvas = document.getElementById('price-chart');
  if (!CV.canvas) return;
  CV.started = true;
  CV.ctx = CV.canvas.getContext('2d');
  const wrap = CV.canvas.parentElement;
  if (window.ResizeObserver) new ResizeObserver(cvResize).observe(wrap);
  else window.addEventListener('resize', cvResize);

  const place = (clientX, clientY) => {
    const r = CV.canvas.getBoundingClientRect();
    CV.hoverX = clientX - r.left;
    CV.hoverY = clientY - r.top;
  };
  CV.canvas.addEventListener('mousemove', e => place(e.clientX, e.clientY));
  CV.canvas.addEventListener('mouseleave', () => { CV.hoverX = CV.hoverY = null; });
  CV.canvas.addEventListener('touchstart', e => place(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  CV.canvas.addEventListener('touchmove', e => place(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  CV.canvas.addEventListener('touchend', () => { CV.hoverX = CV.hoverY = null; });

  cvResize();
  requestAnimationFrame(cvFrame);
}
function cvResize() {
  if (!CV.canvas) return;
  const r = CV.canvas.getBoundingClientRect();
  CV.dpr = Math.min(window.devicePixelRatio || 1, 2);
  CV.w = r.width; CV.h = r.height;
  CV.canvas.width = Math.round(CV.w * CV.dpr);
  CV.canvas.height = Math.round(CV.h * CV.dpr);
}

function cvFrame(now) {
  requestAnimationFrame(cvFrame);
  const ctx = CV.ctx;
  if (!ctx || !CV.w) return;
  const { w, h, dpr } = CV;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // ease the y-domain toward its target: the chart glides instead of snapping
  CV.min += (CV.tMin - CV.min) * 0.12;
  CV.max += (CV.tMax - CV.max) * 0.12;

  const PL = CV_PAD.l, PR = CV_PAD.r, PT = CV_PAD.t, PB = CV_PAD.b;
  const pw = w - PL - PR, ph = h - PT - PB;
  const span = (CV.max - CV.min) || 1;
  const yOf = v => PT + (1 - (v - CV.min) / span) * ph;
  const vOf = y => CV.min + (1 - (y - PT) / ph) * span;
  const n = CV.candles.length;

  ctx.font = '10px "DM Mono", monospace';
  ctx.textBaseline = 'middle';

  // grid + right-axis labels
  for (let i = 0; i <= 4; i++) {
    const y = PT + (ph * i) / 4;
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL, y + 0.5); ctx.lineTo(PL + pw, y + 0.5); ctx.stroke();
    ctx.fillStyle = '#6E6E76';
    ctx.textAlign = 'left';
    ctx.fillText(fmtChartVal(vOf(y)), PL + pw + 8, y);
  }

  if (n) {
    const slot = pw / Math.max(n, 60);
    const bw = Math.max(2, slot * 0.62);
    const xOf = i => PL + pw - slot / 2 - (n - 1 - i) * slot;
    const elapsed = now - CV.enterT;

    // candles grow in with a short stagger whenever the series/range changes
    for (let i = 0; i < n; i++) {
      const c = CV.candles[i];
      const p = chClamp((elapsed - i * 14) / 280, 0, 1);
      if (p <= 0) continue;
      const e = 1 - Math.pow(1 - p, 3);
      const rgb = c.c >= c.o ? UP_RGB : DOWN_RGB;
      const x = xOf(i), dy = (1 - e) * 10;
      const yH = yOf(c.h) + dy, yL = yOf(c.l) + dy;
      const top = Math.min(yOf(c.o), yOf(c.c)) + dy;
      const bh = Math.max(1.5, Math.abs(yOf(c.c) - yOf(c.o)));
      ctx.globalAlpha = e;
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yH); ctx.lineTo(Math.round(x) + 0.5, yL); ctx.stroke();
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillRect(x - bw / 2, top, bw, bh);
      ctx.globalAlpha = 1;
    }

    // time labels along the bottom
    ctx.fillStyle = '#6E6E76';
    ctx.textAlign = 'center';
    const every = Math.max(1, Math.ceil(n / 5));
    for (let i = n - 1; i >= 0; i -= every) {
      ctx.fillText(fmtAxisTime(CV.candles[i].t), xOf(i), h - PB / 2);
    }

    // last-price line + tag
    const last = CV.candles[n - 1];
    const lastRgb = last.c >= CV.candles[0].o ? UP_RGB : DOWN_RGB;
    const ly = yOf(last.c);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = `rgba(${lastRgb},.55)`;
    ctx.beginPath(); ctx.moveTo(PL, ly + 0.5); ctx.lineTo(PL + pw, ly + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgb(${lastRgb})`;
    ctx.fillRect(PL + pw + 2, ly - 8, PR - 6, 16);
    ctx.fillStyle = '#070708';
    ctx.textAlign = 'left';
    ctx.fillText(fmtChartVal(last.c), PL + pw + 6, ly);

    // live tick flash: a short expanding ring when the latest close changes
    const fAge = now - CV.flashT;
    if (fAge < 700) {
      const k = fAge / 700;
      ctx.beginPath(); ctx.arc(xOf(n - 1), ly, 4 + k * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${lastRgb},${0.6 * (1 - k)})`; ctx.lineWidth = 2; ctx.stroke();
    }

    // live pulse on the latest candle
    const lx = xOf(n - 1);
    const pulse = (Math.sin(now / 320) + 1) / 2;
    ctx.beginPath(); ctx.arc(lx, ly, 3 + pulse * 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${lastRgb},${0.35 * (1 - pulse)})`; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${lastRgb})`; ctx.fill();

    // hover: index from x, crosshair + tags
    let hi = -1;
    if (CV.hoverX != null && CV.hoverX >= PL && CV.hoverX <= PL + pw) {
      const base = PL + pw - slot / 2 - (n - 1) * slot;
      hi = chClamp(Math.round((CV.hoverX - base) / slot), 0, n - 1);
    }
    const shown = hi >= 0 ? CV.candles[hi] : last;
    if (hi >= 0) {
      const cx = xOf(hi) + 0.5;
      const cy = CV.hoverY != null ? chClamp(CV.hoverY, PT, PT + ph) : null;
      ctx.strokeStyle = 'rgba(255,149,0,.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cx, PT); ctx.lineTo(cx, PT + ph); ctx.stroke();
      if (cy != null) { ctx.beginPath(); ctx.moveTo(PL, cy + 0.5); ctx.lineTo(PL + pw, cy + 0.5); ctx.stroke(); }
      ctx.setLineDash([]);
      if (cy != null) {
        const pv = vOf(cy);
        ctx.fillStyle = ACCENT;
        ctx.fillRect(PL + pw + 2, cy - 8, PR - 6, 16);
        ctx.fillStyle = '#070708';
        ctx.textAlign = 'left';
        ctx.fillText(fmtChartVal(pv), PL + pw + 6, cy);
      }
      const label = new Date(shown.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      ctx.font = '10px "DM Mono", monospace';
      const tw = ctx.measureText(label).width + 12;
      const tx = chClamp(cx - tw / 2, PL, PL + pw - tw);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(tx, PT + ph + 2, tw, 16);
      ctx.fillStyle = '#070708';
      ctx.textAlign = 'left';
      ctx.fillText(label, tx + 6, PT + ph + 10);
    }

    // OHLC legend (top-left), hovered candle or the latest one
    const up = shown.c >= shown.o;
    ctx.font = '10px "DM Mono", monospace';
    ctx.textAlign = 'left';
    let lx2 = PL + 2;
    const parts = [['O', shown.o], ['H', shown.h], ['L', shown.l], ['C', shown.c]];
    parts.forEach(([k, v]) => {
      ctx.fillStyle = '#6E6E76'; ctx.fillText(k + ' ', lx2, 12);
      lx2 += ctx.measureText(k + ' ').width;
      ctx.fillStyle = `rgb(${up ? UP_RGB : DOWN_RGB})`; ctx.fillText(fmtChartVal(v), lx2, 12);
      lx2 += ctx.measureText(fmtChartVal(v)).width + 10;
    });
  }
}

// ---- main entry: called on every poll / range / token / denom change ----
function renderChart() {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;
  cvInit();
  const key = chartTokenKey;
  if (!TOKENS[key]) return;
  document.getElementById('chart-icon').src = iconFor(key);
  document.getElementById('chart-sym').textContent =
    (key === 'HERESY' || key === 'WHERESY') && chartDenom !== 'usd' ? `${key} / BOB`
      : (chartDenom === 'usd' ? `${key} / USD` : `${key} / HERESY`);

  const empty = document.getElementById('chart-empty');
  const changeEl = document.getElementById('chart-change');
  const { start, end, candleSecs } = chartWindow();
  const candles = buildCandles(seriesFor(key), candleSecs, start, end);

  if (candles.length < 1 || seriesFor(key).length < 2) {
    empty.style.display = 'flex';
    empty.textContent = histState === 'loading' ? 'Loading on-chain price history…' : 'No price data yet for this pair — it appears as soon as the pool reserves load.';
    canvas.style.visibility = 'hidden';
    changeEl.textContent = '–'; changeEl.className = 'chart-change flat';
    ['stat-high', 'stat-low', 'stat-liq'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = '–'; });
    CV.candles = [];
    return;
  }
  empty.style.display = 'none';
  canvas.style.visibility = 'visible';

  // animate candles in only when the series identity changes
  const sig = `${key}|${chartRange}|${chartDenom}`;
  if (sig !== CV.sig) { CV.sig = sig; CV.enterT = performance.now(); }
  if (CV.lastClose != null && sig === CV.sig && candles[candles.length - 1].c !== CV.lastClose) {
    CV.flashT = performance.now();
  }
  CV.lastClose = candles[candles.length - 1].c;
  CV.candles = candles;

  const lo = Math.min(...candles.map(c => c.l)), hi = Math.max(...candles.map(c => c.h));
  const pad = (hi - lo) * 0.10 || hi * 0.02 || 1;
  CV.tMin = lo - pad; CV.tMax = hi + pad;
  if (!CV.ready) { CV.min = CV.tMin; CV.max = CV.tMax; CV.ready = true; }

  const first = candles[0].o, last = candles[candles.length - 1].c;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  tweenText(document.getElementById('chart-px'), fmtChartValUnit(last));
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
  if (typeof renderDetails === 'function') renderDetails();
}
