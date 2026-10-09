// ==================== NEW-USER TOUR ====================
// Spotlight walkthrough: takes a first-time visitor from the header to a
// finished swap. Auto-starts once; replay any time with the Guide button.
const TOUR_KEY = 'heresy_tour_v1';

const TOUR_STEPS = [
  {
    title: 'Welcome to HERESY DEX',
    body: 'This is a swap for tokens on The Grotto L1. This guide takes about a minute and shows you how to make your first swap.'
  },
  {
    target: '#btn-connect',
    title: '1. Connect your wallet',
    body: 'Click Connect Wallet and pick a browser wallet (MetaMask, Core, and similar). Swaps happen from your wallet, so nothing is held by this site.'
  },
  {
    target: '.net-pill',
    title: '2. Check you are on The Grotto',
    body: 'Your wallet needs to be on The Grotto network. If it is not, the app asks your wallet to add or switch to it for you.'
  },
  {
    target: '#chart-card',
    title: '3. Look at the market',
    body: 'The chart and Markets table show live prices and liquidity. Click any token in the Markets table to preload it in the swap box.'
  },
  {
    target: '#io-from',
    title: '4. Choose what you pay',
    body: 'Type the amount in the top box, or tap your balance to use all of it. Use the token picker to change which token you pay with.'
  },
  {
    target: '#to-picker',
    title: '5. Choose what you receive',
    body: 'Pick the token you want. The amount you will receive is estimated automatically below the box.'
  },
  {
    target: '.slippage-row',
    title: '6. Set slippage',
    body: 'Slippage is how much the price may move before your swap executes. 1% is fine for most tokens. Raise it for thin, volatile ones.'
  },
  {
    target: '.swap-details',
    title: '7. Review the details',
    body: 'Rate, price impact, the minimum you will receive, and the fee are shown here. Check them before you sign.'
  },
  {
    target: '#btn-swap',
    title: '8. Swap',
    body: 'Press Swap and confirm in your wallet. Swaps are on-chain and cannot be reversed, so double-check the amounts first. You are ready.'
  }
];

let tourIndex = -1;
let tourActive = false;

function tourEls() {
  if (!document.getElementById('tour-root')) {
    const root = document.createElement('div');
    root.id = 'tour-root';
    root.innerHTML = `
      <div class="tour-spot" id="tour-spot"></div>
      <div class="tour-card" id="tour-card" role="dialog" aria-live="polite">
        <div class="tour-progress" id="tour-progress"></div>
        <h4 id="tour-title"></h4>
        <p id="tour-body"></p>
        <div class="tour-actions">
          <button class="btn btn-ghost btn-sm" id="tour-skip" onclick="endTour(true)">Skip</button>
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
    window.addEventListener('resize', () => tourActive && tourPlace());
    window.addEventListener('scroll', () => tourActive && tourPlace(), { passive: true });
  }
  return {
    spot: document.getElementById('tour-spot'),
    card: document.getElementById('tour-card')
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
  tourIndex = i;
  const step = TOUR_STEPS[i];
  const { spot } = tourEls();
  const el = step.target ? document.querySelector(step.target) : null;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-body').textContent = step.body;
  document.getElementById('tour-progress').textContent = `Step ${i + 1} of ${TOUR_STEPS.length}`;
  document.getElementById('tour-back').style.visibility = i === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Finish' : (i === 0 ? 'Start' : 'Next');
  spot.style.display = el ? 'block' : 'none';
  tourPlace();
  // give smooth scroll a moment, then re-place the spotlight
  setTimeout(() => tourActive && tourPlace(), 350);
}

function tourPlace() {
  const step = TOUR_STEPS[tourIndex];
  if (!step) return;
  const { spot, card } = tourEls();
  const el = step.target ? document.querySelector(step.target) : null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 180;

  if (el) {
    const r = el.getBoundingClientRect();
    const pad = 8;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    // card below the target if it fits, otherwise above
    let top = r.bottom + pad + 14;
    if (top + ch > vh - 10) top = Math.max(10, r.top - pad - 14 - ch);
    const left = chClamp(r.left + r.width / 2 - cw / 2, 10, vw - cw - 10);
    card.style.top = top + 'px';
    card.style.left = left + 'px';
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

function endTour(skipped) {
  tourActive = false;
  const root = document.getElementById('tour-root');
  if (root) root.classList.remove('on');
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* private mode */ }
}

// first visit: start automatically once the page has settled
function maybeAutoStartTour() {
  let done = false;
  try { done = localStorage.getItem(TOUR_KEY) === '1'; } catch (e) {}
  if (!done) setTimeout(startTour, 900);
}
maybeAutoStartTour();
