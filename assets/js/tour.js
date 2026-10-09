// ==================== GUIDE DEMO (fully simulated) ====================
// A self-contained walkthrough of a swap. Nothing here touches the live app:
// the wallet is a simulated demo wallet, the network switch is a visual
// simulation, the chart is generated demo data and the swap never sends a
// transaction. The demo is labelled as such on screen.
const TOUR_KEY = 'heresy_tour_v1';
const GD_CANCEL = {};
let gdRunId = 0;
let gdIndex = -1;
let gdAuto = false;
let gdOpen = false;
let gdTypeId = 0;
const gdSnaps = [];
let gdLooping = false;
let gdDone = false;

const GD_TOK = {
  BOB:   { rate: 1 },        // tokens received per 1 BOB
  CAVE:  { rate: 32.4 },
  EARLY: { rate: 0.91 },
  USDC:  { rate: 0.52 }
};
const GD_BOB_USD = 0.42;
const GD_INIT = { conn: false, net: 'avax', tab: 'BOB', to: 'USDC', amt: '', slip: 1,
  menu: false, modal: null, status: 'idle', toast: null, bal: 128.4 };
let S = gdClone(GD_INIT);

function gdClone(o) { return JSON.parse(JSON.stringify(o)); }
function gdEl(id) { return document.getElementById(id); }
function gdQ(sel) { return document.querySelector(`#tour-root [data-demo="${sel}"]`); }
function gdClamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function gdFmt(n) { return (n || 0).toLocaleString(undefined, { maximumFractionDigits: n >= 10 ? 2 : 4 }); }
function gdCalc() {
  const amt = parseFloat(S.amt) || 0;
  const rate = GD_TOK[S.to].rate;
  const out = amt * rate * (1 - 0.003);            // 0.30% fee
  const min = out * (1 - S.slip / 100);
  const impact = Math.min(4, amt * 0.04);          // demo price-impact model
  return { amt, rate, out, min, impact };
}

// ---------- scripted scenes ----------
const GD_SCENES = [
  { title: 'Welcome to the HERESY DEX guide',
    body: 'This is a simulated walkthrough of a swap on The Grotto L1. Your wallet is not connected for real, and no funds move.',
    run: async A => { await A.w(900); } },

  { title: '1. Connect your wallet',
    body: 'Click Connect Wallet and pick a wallet. This demo links a simulated wallet, so nothing is requested from a real one.',
    run: async A => {
      await A.click('connect');
      A.set(() => S.modal = 'wallet');
      await A.click('w-a');
      A.set(() => S.modal = 'connecting');
      await A.w(1400);
      A.set(() => { S.modal = null; S.conn = true; S.toast = 'Demo wallet connected · 0x4f2a…9c1d'; });
      await A.w(1600);
      A.set(() => S.toast = null);
    } },

  { title: '2. Auto-switch to The Grotto',
    body: 'The wallet starts on Avalanche C-Chain. The app asks it to switch to The Grotto automatically, and you approve once.',
    run: async A => {
      await A.w(600);
      A.set(() => S.modal = 'switch');
      await A.click('approve-switch');
      A.set(() => { S.modal = null; S.net = 'grotto'; S.toast = 'Switched to The Grotto (chain 36463)'; });
      await A.w(1800);
      A.set(() => S.toast = null);
    } },

  { title: '3. Watch the market',
    body: 'The chart and trades update live. Tap a token tab to see its chart morph to that token. Demo data only.',
    run: async A => {
      for (const t of ['CAVE', 'EARLY', 'BOB']) {
        await A.click('tab-' + t);
        A.set(() => S.tab = t);
        await A.w(1100);
      }
    } },

  { title: '4. Choose what you receive',
    body: 'Open the token list on the receive side and pick a token. The estimate and route update to match.',
    run: async A => {
      await A.click('to');
      A.set(() => S.menu = true);
      await A.click('opt-CAVE');
      A.set(() => { S.menu = false; S.to = 'CAVE'; });
      await A.w(900);
    } },

  { title: '5. Enter an amount',
    body: 'Type how much you want to pay. Watch the receive estimate and the minimum update as you type.',
    run: async A => {
      await A.click('amount');
      A.set(() => S.amt = '');
      for (const ch of '25') {
        A.set(() => S.amt += ch);
        await A.w(380);
      }
      await A.w(600);
    } },

  { title: '6. Set slippage',
    body: 'Slippage is the most the price may move before the swap executes. The minimum you receive changes with it. 1% suits most tokens.',
    run: async A => {
      await A.click('slip-3');
      A.set(() => S.slip = 3);
      await A.w(1000);
      await A.click('slip-1');
      A.set(() => S.slip = 1);
      await A.w(900);
    } },

  { title: '7. Swap',
    body: 'Press Swap, then confirm in your wallet. Real swaps are on-chain and cannot be reversed, so check the amounts first.',
    run: async A => {
      await A.click('cta');
      A.set(() => S.modal = 'approve');
      await A.click('approve-swap');
      A.set(() => { S.modal = null; S.status = 'swapping'; });
      await A.w(2000);
      const out = gdCalc().out;
      A.set(() => {
        S.status = 'done';
        S.bal = +(S.bal - 25).toFixed(2);
        S.toast = `Swapped 25 BOB → ${gdFmt(out)} ${S.to} · tx 0x9af3…e21c (demo)`;
      });
      gdConfetti(0.8);
      await A.w(2800);
      A.set(() => { S.toast = null; S.status = 'idle'; });
    } },

  { title: 'That is the whole flow',
    body: 'On the real site the same steps run with your own wallet. Replay this guide any time from the Guide button.',
    run: async A => { await A.w(300); gdConfetti(1); } }
];

// ---------- runner ----------
function gdWait(ms, run) {
  return new Promise((res, rej) => setTimeout(() => (run === gdRunId ? res() : rej(GD_CANCEL)), ms));
}
function gdMakeA(run) {
  const guard = () => { if (run !== gdRunId) throw GD_CANCEL; };
  const cursorTo = async sel => {
    const el = gdQ(sel); if (!el) return;
    const r = el.getBoundingClientRect();
    const cur = gdEl('gd-cursor');
    cur.classList.add('on');
    cur.style.left = (r.left + r.width / 2) + 'px';
    cur.style.top = (r.top + r.height / 2) + 'px';
    await gdWait(850, run);
  };
  return {
    w: ms => gdWait(ms, run),
    click: async sel => {
      await cursorTo(sel);
      const el = gdQ(sel); if (!el) return;
      const r = el.getBoundingClientRect();
      gdEl('gd-cursor').classList.add('press');
      const rip = document.createElement('div');
      rip.className = 'tour-ripple';
      rip.style.left = (r.left + r.width / 2) + 'px';
      rip.style.top = (r.top + r.height / 2) + 'px';
      gdEl('tour-root').appendChild(rip);
      setTimeout(() => rip.remove(), 700);
      await gdWait(200, run);
      gdEl('gd-cursor').classList.remove('press');
    },
    set: fn => { guard(); fn(); gdRender(); }
  };
}

function gdPlay(i) {
  if (i < 0 || i >= GD_SCENES.length) return;
  const run = ++gdRunId;
  gdIndex = i;
  gdSnaps[i] = gdClone(S);
  gdDone = false;
  gdSay(GD_SCENES[i].title, GD_SCENES[i].body);
  gdNavUI();
  GD_SCENES[i].run(gdMakeA(run))
    .then(() => {
      if (run !== gdRunId) return;
      gdDone = true;
      if (gdAuto && i < GD_SCENES.length - 1) gdWait(1800, run).then(() => gdPlay(i + 1)).catch(() => {});
    })
    .catch(e => { if (e !== GD_CANCEL) console.error(e); });
}
function gdNext() {
  if (gdIndex >= GD_SCENES.length - 1) return endTour(false);
  gdPlay(gdIndex + 1);
}
function gdBack() {
  if (gdIndex <= 0) return;
  S = gdClone(gdSnaps[gdIndex - 1]);
  gdRender();
  gdPlay(gdIndex - 1);
}
function gdToggleAuto() {
  gdAuto = !gdAuto;
  gdEl('gd-auto').textContent = gdAuto ? '❚❚ Pause' : '▶ Auto-play';
  // if the current step already finished, move on right away
  if (gdAuto && gdDone && gdIndex < GD_SCENES.length - 1) setTimeout(() => gdOpen && gdAuto && gdPlay(gdIndex + 1), 400);
}

function gdNavUI() {
  const i = gdIndex, last = GD_SCENES.length - 1;
  gdEl('gd-step').textContent = `Step ${i + 1} of ${GD_SCENES.length}`;
  gdEl('gd-back').style.visibility = i === 0 ? 'hidden' : 'visible';
  gdEl('gd-next').textContent = i === last ? 'Finish' : (i === 0 ? 'Start' : 'Next');
  gdEl('gd-dots').innerHTML = GD_SCENES.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`).join('');
}

// typewriter narration (id guards against stale typing)
function gdSay(title, body) {
  const id = ++gdTypeId;
  const t = gdEl('gd-title'), b = gdEl('gd-body');
  t.textContent = ''; b.textContent = '';
  const type = (el, text, speed, go) => {
    let k = 0;
    const tick = () => {
      if (id !== gdTypeId) return;
      el.textContent = text.slice(0, ++k);
      if (k < text.length) setTimeout(tick, speed); else if (go) go();
    };
    tick();
  };
  type(t, title, 18, () => type(b, body, 12));
}

// ---------- rendering (idempotent, from state S) ----------
function gdRender() {
  const netName = S.net === 'grotto' ? 'The Grotto' : 'Avalanche C-Chain';
  gdEl('gd-top').innerHTML = `
    <div class="gd-logo">🕯️ HERESY<span>DEX</span></div>
    <span class="gd-demo-tag">DEMO · simulated, no real funds</span>
    <div class="gd-top-r">
      <button class="gd-net ${S.net}" data-demo="net"><i></i>${netName}</button>
      ${S.conn
        ? `<span class="gd-addr">0x4f2a…9c1d</span>`
        : `<button class="gd-connect" data-demo="connect">Connect Wallet</button>`}
    </div>`;

  gdEl('gd-tabs').innerHTML = Object.keys(GD_TOK).map(k =>
    `<button class="gd-tab ${S.tab === k ? 'on' : ''}" data-demo="tab-${k}">${k}</button>`).join('');

  const c = gdCalc();
  const hasAmt = c.amt > 0;
  const cta = !S.conn ? 'Connect Wallet'
    : S.net === 'avax' ? 'Switch to The Grotto'
    : S.status === 'done' ? 'Swapped ✓'
    : S.status === 'swapping' ? 'Swapping…'
    : S.status === 'confirm' ? 'Confirm in wallet…'
    : !hasAmt ? 'Enter an amount'
    : 'Swap';
  const warn = S.conn && S.net === 'avax'
    ? `<div class="gd-warn">⚠ Wrong network: you are on Avalanche C-Chain</div>` : '';

  gdEl('gd-card').innerHTML = `
    ${warn}
    <div class="gd-head"><b>Swap</b><span>router 0xd087…6b10B</span></div>
    <div class="gd-io">
      <div class="gd-io-top"><span>You pay</span><span>Balance: ${S.conn ? gdFmt(S.bal) + ' BOB' : '–'}</span></div>
      <div class="gd-io-row">
        <div class="gd-input" data-demo="amount">${S.amt || '<span class="ph">0.0</span>'}</div>
        <div class="gd-pick">BOB</div>
      </div>
    </div>
    <div class="gd-flip">⇅</div>
    <div class="gd-io">
      <div class="gd-io-top"><span>You receive (est.)</span><span></span></div>
      <div class="gd-io-row">
        <div class="gd-input out" data-demo="out">${hasAmt ? gdFmt(c.out) : '0.0'}</div>
        <button class="gd-pick ${S.menu ? 'open' : ''}" data-demo="to">${S.to} ▾</button>
        ${S.menu ? `<div class="gd-menu">${Object.keys(GD_TOK).filter(k => k !== 'BOB')
          .map(k => `<button data-demo="opt-${k}">${k}</button>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="gd-route">${hasAmt ? `BOB → WHERESY → ${S.to}` : 'Enter an amount to see the route'}</div>
    <div class="gd-slip">
      <span>Slippage</span>
      ${[0.5, 1, 3].map(s => `<button data-demo="slip-${s}" class="${S.slip === s ? 'on' : ''}">${s}%</button>`).join('')}
    </div>
    <div class="gd-details">
      <div><span>Rate</span><b>1 BOB ≈ ${gdFmt(c.rate)} ${S.to}</b></div>
      <div><span>Price impact</span><b>${hasAmt ? c.impact.toFixed(2) + '%' : '–'}</b></div>
      <div><span>Min. received</span><b>${hasAmt ? gdFmt(c.min) + ' ' + S.to : '–'}</b></div>
      <div><span>Platform fee</span><b>0.30%</b></div>
    </div>
    <button class="gd-cta ${S.status === 'swapping' ? 'busy' : ''}" data-demo="cta">${cta}</button>`;

  const modal = !S.modal ? '' : `<div class="gd-modal-bg"><div class="gd-modal">${gdModalBody(c)}</div></div>`;
  gdEl('gd-modal').innerHTML = modal;
  gdEl('gd-toast').innerHTML = S.toast ? `<div class="gd-toast">${S.toast}</div>` : '';
}

function gdModalBody(c) {
  if (S.modal === 'wallet') return `
    <h4>Choose a wallet</h4>
    <p>Simulated for this demo. No real wallet is used.</p>
    <button class="gd-opt" data-demo="w-a"><span>🦊</span>Demo Wallet A<small>MetaMask-style</small></button>
    <button class="gd-opt" data-demo="w-b"><span>🔺</span>Demo Wallet B<small>Core-style</small></button>`;
  if (S.modal === 'connecting') return `
    <h4>Connecting…</h4><div class="gd-spin"></div>
    <p>Approve the request in your demo wallet.</p>`;
  if (S.modal === 'switch') return `
    <h4>Switch network?</h4>
    <p>Avalanche C-Chain → <b>The Grotto</b><br><small>chain 36463</small></p>
    <button class="gd-btn-pri" data-demo="approve-switch">Switch network</button>`;
  if (S.modal === 'approve') return `
    <h4>Confirm swap</h4>
    <p>Pay <b>25 BOB</b><br>Receive ≈ <b>${gdFmt(c.out)} ${S.to}</b><br>Min. received <b>${gdFmt(c.min)} ${S.to}</b></p>
    <button class="gd-btn-pri" data-demo="approve-swap">Confirm</button>`;
  return '';
}

// ---------- chart: demo series that morph between tokens and keep moving ----------
const GC = { shown: null, from: null, tok: null, t0: -1e9, lastTick: 0, data: {} };

function gdSeries(tok, n = 60) {
  let seed = 7;
  for (const ch of tok) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let p = GD_BOB_USD / GD_TOK[tok].rate;
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = p, c = o * (1 + (rnd() - 0.47) * 0.06);
    out.push({ o, c, h: Math.max(o, c) * (1 + rnd() * 0.015), l: Math.min(o, c) * (1 - rnd() * 0.015) });
    p = c;
  }
  return out;
}
function gdTick(tok) {
  const arr = GC.data[tok]; if (!arr) return;
  const last = arr[arr.length - 1];
  const c = last.c * (1 + (Math.random() - 0.48) * 0.012);
  arr.shift();
  arr.push({ o: last.c, c, h: Math.max(last.c, c) * 1.002, l: Math.min(last.c, c) * 0.998 });
}
function gdChartFrame(now) {
  if (!gdOpen) { gdLooping = false; return; }
  requestAnimationFrame(gdChartFrame);
  const canvas = gdEl('gd-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // token switch: start a morph from what is on screen now
  if (!GC.data[S.tab]) GC.data[S.tab] = gdSeries(S.tab);
  if (GC.tok !== S.tab) {
    GC.from = GC.shown ? GC.shown.map(x => ({ ...x })) : null;
    GC.tok = S.tab; GC.t0 = now;
  }
  if (now - GC.lastTick > 1100) { Object.keys(GC.data).forEach(gdTick); GC.lastTick = now; }

  const k = gdClamp((now - GC.t0) / 900, 0, 1);
  const e = 1 - Math.pow(1 - k, 3);
  const to = GC.data[S.tab];
  const arr = to.map((c, i) => {
    const f = (GC.from && GC.from[i]) || c;
    const L = (a, b) => a + (b - a) * e;
    return { o: L(f.o, c.o), c: L(f.c, c.c), h: L(f.h, c.h), l: L(f.l, c.l) };
  });
  GC.shown = arr;

  const PL = 8, PR = 62, PT = 10, PB = 16;
  const pw = w - PL - PR, ph = h - PT - PB;
  const lo = Math.min(...arr.map(x => x.l)), hi = Math.max(...arr.map(x => x.h));
  const pad = (hi - lo) * 0.1 || 1;
  const min = lo - pad, span = (hi - lo + pad * 2) || 1;
  const yOf = v => PT + (1 - (v - min) / span) * ph;
  const n = arr.length, slot = pw / n, bw = Math.max(2, slot * 0.62);
  ctx.font = '10px "DM Mono", monospace';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 3; g++) {
    const y = PT + (ph * g) / 3;
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.moveTo(PL, y + 0.5); ctx.lineTo(PL + pw, y + 0.5); ctx.stroke();
    ctx.fillStyle = '#6E6E76'; ctx.textAlign = 'left';
    ctx.fillText((min + span * (1 - (y - PT) / ph)).toFixed(5), PL + pw + 6, y);
  }
  arr.forEach((cd, i) => {
    const x = PL + slot * i + slot / 2;
    const up = cd.c >= cd.o;
    const rgb = up ? '34,197,94' : '255,74,28';
    ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yOf(cd.h)); ctx.lineTo(Math.round(x) + 0.5, yOf(cd.l)); ctx.stroke();
    ctx.fillStyle = `rgb(${rgb})`;
    const top = Math.min(yOf(cd.o), yOf(cd.c));
    ctx.fillRect(x - bw / 2, top, bw, Math.max(1.5, Math.abs(yOf(cd.c) - yOf(cd.o))));
  });
  const last = arr[n - 1];
  const up = last.c >= arr[0].o, rgb = up ? '34,197,94' : '255,74,28';
  const ly = yOf(last.c);
  ctx.setLineDash([3, 4]); ctx.strokeStyle = `rgba(${rgb},.55)`;
  ctx.beginPath(); ctx.moveTo(PL, ly + 0.5); ctx.lineTo(PL + pw, ly + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(PL + pw + 2, ly - 8, PR - 6, 16);
  ctx.fillStyle = '#070708'; ctx.textAlign = 'left';
  ctx.fillText(last.c.toFixed(5), PL + pw + 6, ly);
  const pulse = (Math.sin(now / 320) + 1) / 2;
  ctx.beginPath(); ctx.arc(PL + slot * (n - 1) + slot / 2, ly, 3 + pulse * 6, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb},${0.35 * (1 - pulse)})`; ctx.fill();

  const pct = ((last.c - arr[0].o) / arr[0].o) * 100;
  const sym = gdEl('gd-sym'), px = gdEl('gd-px'), chg = gdEl('gd-chg');
  if (sym) sym.textContent = `${S.tab} / HERESY`;
  if (px) px.textContent = '$' + (last.c * GD_BOB_USD).toFixed(4);
  if (chg) { chg.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(2) + '%'; chg.className = pct >= 0 ? 'up' : 'down'; }
}

// ---------- confetti (demo only) ----------
function gdConfetti(strength) {
  const root = gdEl('tour-root'); if (!root) return;
  const colors = ['#FF9500', '#FF4A1C', '#22C55E', '#FFD27A'];
  for (let k = 0; k < Math.round(46 * strength); k++) {
    const p = document.createElement('i');
    p.className = 'tour-confetti';
    p.style.background = colors[k % colors.length];
    p.style.left = (window.innerWidth / 2 + (Math.random() - 0.5) * 240) + 'px';
    p.style.top = (window.innerHeight * 0.45) + 'px';
    p.style.setProperty('--dx', ((Math.random() - 0.5) * 420) + 'px');
    p.style.setProperty('--dy', (-120 - Math.random() * 260) + 'px');
    p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = (Math.random() * 0.15) + 's';
    root.appendChild(p);
    setTimeout(() => p.remove(), 1700);
  }
}

// ---------- open / close ----------
function buildGuide() {
  if (gdEl('tour-root')) return;
  const root = document.createElement('div');
  root.id = 'tour-root';
  root.innerHTML = `
    <div class="gd-frame">
      <div class="gd-top" id="gd-top"></div>
      <div class="gd-body">
        <div class="gd-left">
          <div class="gd-chart-head"><b id="gd-sym">BOB / HERESY</b><span id="gd-px">$0.4200</span><span id="gd-chg" class="up">▲ 0.00%</span></div>
          <div class="gd-tabs" id="gd-tabs"></div>
          <div class="gd-chart-wrap"><canvas id="gd-canvas"></canvas></div>
          <div class="gd-hint">Demo chart: simulated prices, not real market data.</div>
        </div>
        <div class="gd-card-wrap"><div class="gd-card" id="gd-card"></div></div>
      </div>
      <div class="gd-narr">
        <div class="gd-narr-text">
          <div class="gd-step" id="gd-step"></div>
          <div class="gd-title" id="gd-title"></div>
          <div class="gd-desc" id="gd-body"></div>
        </div>
        <div class="gd-ctrl">
          <div class="gd-dots" id="gd-dots"></div>
          <div class="gd-btns">
            <button class="btn btn-ghost btn-sm" onclick="endTour(true)">Skip</button>
            <button class="btn btn-ghost btn-sm" id="gd-auto" onclick="gdToggleAuto()">▶ Auto-play</button>
            <button class="btn btn-ghost btn-sm" id="gd-back" onclick="gdBack()">Back</button>
            <button class="btn btn-primary btn-sm" id="gd-next" onclick="gdNext()">Next</button>
          </div>
        </div>
      </div>
      <div class="gd-modal-host" id="gd-modal"></div>
      <div id="gd-toast"></div>
    </div>
    <div class="tour-cursor" id="gd-cursor"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 18 2.6-7.4L20.5 10z" fill="#fff" stroke="#FF9500" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`;
  document.body.appendChild(root);
  document.addEventListener('keydown', e => {
    if (!gdOpen) return;
    if (e.key === 'Escape') endTour(true);
    if (e.key === 'ArrowRight' || e.key === 'Enter') gdNext();
    if (e.key === 'ArrowLeft') gdBack();
  });
}

function startTour() {
  buildGuide();
  gdOpen = true;
  gdAuto = false;
  gdRunId++;
  S = gdClone(GD_INIT);
  GC.shown = null; GC.from = null; GC.tok = null; GC.t0 = -1e9;
  gdEl('gd-auto').textContent = '▶ Auto-play';
  gdEl('tour-root').classList.add('on');
  gdRender();
  if (!gdLooping) { gdLooping = true; requestAnimationFrame(gdChartFrame); }
  gdPlay(0);
}

function endTour(markSeen) {
  gdOpen = false;
  gdAuto = false;
  gdRunId++;                       // cancels any running scene
  gdTypeId++;                      // stops typing
  const root = gdEl('tour-root');
  if (root) root.classList.remove('on');
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* private mode */ }
}

function maybeAutoStartTour() {
  let done = false;
  try { done = localStorage.getItem(TOUR_KEY) === '1'; } catch (e) {}
  if (!done) setTimeout(startTour, 900);
}
maybeAutoStartTour();
