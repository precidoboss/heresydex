// ==================== NEW-USER TOUR (animated demo) ====================
// A visual walkthrough: a fake cursor glides to each part of the page, clicks
// with a ripple, and types example values into a preview bubble. It NEVER
// presses real buttons or writes to real inputs, so it cannot open a wallet
// prompt or send a transaction. Auto-starts once; Guide button replays it.
const TOUR_KEY = 'heresy_tour_v1';

const TOUR_STEPS = [
  { title: 'Welcome to HERESY DEX',
    body: 'A swap for tokens on The Grotto L1. Watch a quick demo of your first swap, or follow along step by step.' },
  { target: '#btn-connect', click: true,
    title: '1. Connect your wallet',
    body: 'Click Connect Wallet and pick a browser wallet (MetaMask, Core, and similar). Swaps happen from your wallet, so this site never holds your funds.' },
  { target: '.net-pill',
    title: '2. Be on The Grotto',
    body: 'Your wallet needs to be on The Grotto network. If it is not, the app asks your wallet to add or switch to it for you.' },
  { target: '#chart-card',
    title: '3. Look at the market',
    body: 'Live chart, trades and liquidity update as the chain moves. Click any token in the Markets table to preload it in the swap box.' },
  { target: '#io-from', type: '25',
    title: '4. Choose what you pay',
    body: 'Type an amount, or tap your balance to use all of it. The token picker changes which token you pay with.' },
  { target: '#to-picker', click: true,
    title: '5. Choose what you receive',
    body: 'Pick the token you want. The amount you receive is estimated automatically below the box.' },
  { target: '.slippage-row', click: true,
    title: '6. Set slippage',
    body: 'Slippage is how far the price may move before your swap executes. 1% suits most tokens. Raise it for thin, volatile ones.' },
  { target: '.swap-details',
    title: '7. Review the details',
    body: 'Rate, price impact, the minimum you will receive, and the fee. Check them before you sign.' },
  { target: '#btn-swap', click: true, press: true,
    title: '8. Swap',
    body: 'Press Swap and confirm in your wallet. Swaps are on-chain and cannot be reversed, so double-check the amounts. You are ready.' }
];

let tourIndex = -1;
let tourActive = false;
let tourAuto = false;
let tourRun = 0;              // increments on each step; cancels stale timers
let tourTimers = [];

const later = (ms, fn) => { const id = setTimeout(fn, ms); tourTimers.push(id); return id; };
function clearTourTimers() { tourTimers.forEach(clearTimeout); tourTimers = []; }

function tourEls() {
  if (!document.getElementById('tour-root')) {
    const root = document.createElement('div');
    root.id = 'tour-root';
    root.innerHTML = `
      <div class="tour-spot" id="tour-spot"></div>
      <div class="tour-cursor" id="tour-cursor">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 18 2.6-7.4L20.5 10z" fill="#fff" stroke="#FF9500" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </div>
      <div class="tour-ghost" id="tour-ghost"></div>
      <div class="tour-card" id="tour-card" role="dialog" aria-live="polite">
        <div class="tour-bar"><span id="tour-bar-fill"></span></div>
        <div class="tour-progress" id="tour-progress"></div>
        <h4 id="tour-title"></h4>
        <p id="tour-body"></p>
        <div class="tour-actions">
          <button class="btn btn-ghost btn-sm" onclick="endTour(true)">Skip</button>
          <button class="btn btn-ghost btn-sm" id="tour-auto" onclick="toggleTourAuto()">▶ Auto-play</button>
          <div class="tour-nav">
            <button class="btn btn-ghost btn-sm" id="tour-back" onclick="tourStep(-1)">Back</button>
            <button class="btn btn-primary btn-sm" id="tour-next" onclick="tourStep(1)">Next</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    document.addEventListener('keydown', e => {
      if (!tourActive) return;
      if (e.key === 'Escape') endTour(true);
      if (e.key === 'ArrowRight' || e.key === 'Enter') tourStep(1);
      if (e.key === 'ArrowLeft') tourStep(-1);
    });
    const relayout = () => tourActive && tourPlace();
    window.addEventListener('resize', relayout);
    window.addEventListener('scroll', relayout, { passive: true });
  }
  return {
    spot: document.getElementById('tour-spot'),
    card: document.getElementById('tour-card'),
    cursor: document.getElementById('tour-cursor'),
    ghost: document.getElementById('tour-ghost')
  };
}

function startTour() {
  tourEls();
  tourActive = true;
  document.getElementById('tour-root').classList.add('on');
  if (typeof showPage === 'function') showPage('swap');
  tourGo(0);
}

function tourGo(i) {
  clearTourTimers();
  const run = ++tourRun;
  tourIndex = i;
  const step = TOUR_STEPS[i];
  const { spot, cursor, ghost } = tourEls();
  const el = step.target ? document.querySelector(step.target) : null;
  ghost.classList.remove('on');

  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('tour-progress').textContent = `Step ${i + 1} of ${TOUR_STEPS.length}`;
  document.getElementById('tour-back').style.visibility = i === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Finish' : (i === 0 ? 'Start' : 'Next');
  document.getElementById('tour-bar-fill').style.transition = 'none';
  document.getElementById('tour-bar-fill').style.width = (i / TOUR_STEPS.length * 100) + '%';
  later(20, () => {
    document.getElementById('tour-bar-fill').style.transition = 'width .6s ease';
    document.getElementById('tour-bar-fill').style.width = ((i + 1) / TOUR_STEPS.length * 100) + '%';
  });

  typeInto(document.getElementById('tour-title'), step.title, 22, run, () => {
    typeInto(document.getElementById('tour-body'), step.body, 14, run, () => {
      if (tourAuto && tourRun === run) later(1400, () => tourStep(1));
    });
  });
  // the title and body reset here so the typing effect always starts clean
  document.getElementById('tour-body').textContent = '';

  if (!el) {
    spot.classList.remove('on');
    cursor.classList.remove('on');
    tourPlace();
    if (i === 0) burstConfetti(0.5);
    return;
  }

  // spotlight fades in, then the cursor glides to the element
  spot.style.display = 'block';
  tourPlace();
  later(250, () => spot.classList.add('on'));
  cursor.classList.add('on');
  const c = centerOf(el);
  cursor.style.transition = 'none';
  cursor.style.left = (c.x + 120) + 'px';
  cursor.style.top = (c.y + 120) + 'px';
  void cursor.offsetWidth;
  cursor.style.transition = '';
  later(60, () => moveCursor(c.x, c.y));

  // after arriving: click, then the step's own demo animation
  later(950, () => {
    if (tourRun !== run) return;
    if (step.click) clickRipple(c.x, c.y);
    if (step.press) el.classList.add('tour-pressed');
    if (step.type) typeGhost(el, step.type, run);
  });
  later(1300, () => el.classList.remove('tour-pressed'));
  if (i === TOUR_STEPS.length - 1) later(1400, () => burstConfetti(1));
}

// ---- animation helpers ----
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function moveCursor(x, y) {
  const { cursor } = tourEls();
  cursor.style.left = x + 'px';
  cursor.style.top = y + 'px';
}
function clickRipple(x, y) {
  const { cursor } = tourEls();
  cursor.classList.add('press');
  later(160, () => cursor.classList.remove('press'));
  const rip = document.createElement('div');
  rip.className = 'tour-ripple';
  rip.style.left = x + 'px';
  rip.style.top = y + 'px';
  document.getElementById('tour-root').appendChild(rip);
  later(700, () => rip.remove());
}
function typeInto(el, text, speed, run, done) {
  el.textContent = '';
  let i = 0;
  const tick = () => {
    if (tourRun !== run) return;
    el.textContent = text.slice(0, ++i);
    if (i < text.length) later(speed, tick); else if (done) done();
  };
  tick();
}
// shows an example amount typed into a bubble above the element (never into the real input)
function typeGhost(el, text, run) {
  const { ghost } = tourEls();
  const r = el.getBoundingClientRect();
  ghost.style.left = (r.left + 16) + 'px';
  ghost.style.top = (r.top - 40) + 'px';
  ghost.textContent = '';
  ghost.classList.add('on');
  let i = 0;
  const tick = () => {
    if (tourRun !== run) return;
    ghost.textContent = text.slice(0, ++i);
    if (i < text.length) later(180, tick);
    else later(700, () => ghost.classList.remove('on'));
  };
  later(200, tick);
}
function burstConfetti(strength) {
  const root = document.getElementById('tour-root');
  const colors = ['#FF9500', '#FF4A1C', '#22C55E', '#FFD27A'];
  const n = Math.round(46 * strength);
  for (let k = 0; k < n; k++) {
    const p = document.createElement('i');
    p.className = 'tour-confetti';
    p.style.background = colors[k % colors.length];
    p.style.left = (window.innerWidth / 2 + (Math.random() - 0.5) * 200) + 'px';
    p.style.top = (window.innerHeight * 0.45) + 'px';
    p.style.setProperty('--dx', ((Math.random() - 0.5) * 420) + 'px');
    p.style.setProperty('--dy', (-120 - Math.random() * 260) + 'px');
    p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = (Math.random() * 0.15) + 's';
    root.appendChild(p);
    later(1600, () => p.remove());
  }
}

// ---- layout ----
function tourPlace() {
  const step = TOUR_STEPS[tourIndex];
  if (!step) return;
  const { spot, card, cursor } = tourEls();
  const el = step.target ? document.querySelector(step.target) : null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 200;

  if (el) {
    const r = el.getBoundingClientRect();
    const pad = 8;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    let top = r.bottom + pad + 14;
    if (top + ch > vh - 10) top = Math.max(10, r.top - pad - 14 - ch);
    card.style.top = top + 'px';
    card.style.left = chClamp(r.left + r.width / 2 - cw / 2, 10, vw - cw - 10) + 'px';
    if (cursor.classList.contains('on')) {
      const c = centerOf(el);
      cursor.style.left = c.x + 'px';
      cursor.style.top = c.y + 'px';
    }
  } else {
    card.style.top = Math.max(10, (vh - ch) / 2) + 'px';
    card.style.left = Math.max(10, (vw - cw) / 2) + 'px';
  }
}

function tourStep(dir) {
  if (!tourActive) return;
  const next = tourIndex + dir;
  if (next >= TOUR_STEPS.length) return endTour(false);
  if (next < 0) return;
  tourGo(next);
}

function toggleTourAuto() {
  tourAuto = !tourAuto;
  const b = document.getElementById('tour-auto');
  b.textContent = tourAuto ? '❚❚ Pause' : '▶ Auto-play';
  if (tourAuto) tourStep(1);
}

function endTour(skipped) {
  tourActive = false;
  tourAuto = false;
  tourRun++;
  clearTourTimers();
  const root = document.getElementById('tour-root');
  if (root) root.classList.remove('on');
  document.querySelectorAll('.tour-pressed').forEach(el => el.classList.remove('tour-pressed'));
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* private mode */ }
}

function maybeAutoStartTour() {
  let done = false;
  try { done = localStorage.getItem(TOUR_KEY) === '1'; } catch (e) {}
  if (!done) later(900, startTour);
}
maybeAutoStartTour();
