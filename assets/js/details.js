// ==================== TOKEN DETAILS + TRADES ====================
// Built from Swap events read in chart.js's backfill (trade size + direction),
// plus on-chain totalSupply. All figures are for the selected pool
// (HERESY/WHERESY charts show the BOB pool, the only one priced from HERESY).

const TRADE_KEY = 'heresy_trades_v1';
const TRADE_CAP = 800;             // per token, kept in localStorage
let tradeStore = {};               // key -> [{t, side, tok, whe, tx, idx, maker, key}]
const supplyCache = {};            // key -> total supply (number) | null while loading

function loadTrades() {
  try { tradeStore = JSON.parse(localStorage.getItem(TRADE_KEY) || '{}') || {}; }
  catch (e) { tradeStore = {}; }
}
function ingestTrades(list) {
  list.forEach(tr => { (tradeStore[tr.key] = tradeStore[tr.key] || []).push(tr); });
  const cutoff = Date.now() - HIST_WINDOW_SECS * 1000;
  Object.keys(tradeStore).forEach(k => {
    const m = new Map();
    tradeStore[k].filter(t => t.t >= cutoff).forEach(t => m.set(t.tx + ':' + t.idx, t));
    tradeStore[k] = Array.from(m.values()).sort((a, b) => a.t - b.t).slice(-TRADE_CAP);
  });
  try { localStorage.setItem(TRADE_KEY, JSON.stringify(tradeStore)); } catch (e) { /* quota */ }
}

function shortAddr(addr) { return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '–'; }
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function loadSupply(pk) {
  if (pk in supplyCache || !TOKENS[pk] || TOKENS[pk].type !== 'erc20') return;
  supplyCache[pk] = null;
  try {
    const c = new ethers.Contract(TOKENS[pk].address, ['function totalSupply() view returns (uint256)'], roProvider);
    supplyCache[pk] = parseFloat(ethers.formatUnits(await c.totalSupply(), TOKENS[pk].decimals));
    renderDetails();
  } catch (e) { supplyCache[pk] = null; }
}

function setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function renderDetails() {
  const card = document.getElementById('details-card');
  if (!card) return;
  const key = chartTokenKey;
  const pk = (key === 'HERESY' || key === 'WHERESY') ? 'BOB' : key;
  if (!TOKENS[pk]) return;
  loadSupply(pk);

  const t = TOKENS[pk];
  const now = Date.now();
  const trades24 = (tradeStore[pk] || []).filter(x => x.t >= now - 86400000);
  const buys = trades24.filter(x => x.side === 'buy');
  const sells = trades24.filter(x => x.side === 'sell');
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const volWhe = sum(trades24, x => x.whe);
  const buyVol = sum(buys, x => x.whe), sellVol = sum(sells, x => x.whe);
  const makers = new Set(trades24.map(x => x.maker)).size;
  const pd = poolData[pk];
  const liqWhe = pd ? pd.wheresyReserve * 2 : 0;
  const usd = tokenUsd(pk);
  const whePerTok = wheresyPerToken(pk);
  const supply = supplyCache[pk];

  setTxt('det-title', `${pk} details`);
  setTxt('det-sub', key === 'HERESY' || key === 'WHERESY' ? 'BOB / HERESY pool' : `${pk} / HERESY pool`);
  setTxt('det-price-usd', fmtUsdOr(usd));
  setTxt('det-price-whe', whePerTok > 0 ? fmtAdaptive(whePerTok) + ' HERESY' : '–');
  setTxt('det-vol', volWhe > 0 ? (wheresyUsd > 0 ? fmtUsd(volWhe * wheresyUsd) : fmtAdaptive(volWhe) + ' HERESY') : '–');
  setTxt('det-txns', trades24.length ? String(trades24.length) : '0');
  setTxt('det-makers', trades24.length ? String(makers) : '0');
  setTxt('det-liq', liqWhe > 0 ? (wheresyUsd > 0 ? fmtUsd(liqWhe * wheresyUsd) : fmtAdaptive(liqWhe) + ' HERESY') : '–');
  setTxt('det-supply', supply ? fmtAdaptive(supply) + ' ' + pk : (t.type === 'native' ? '–' : 'loading…'));
  if (supply && usd > 0) setTxt('det-fdv', fmtUsd(supply * usd));
  else if (supply && whePerTok > 0) setTxt('det-fdv', fmtAdaptive(supply * whePerTok) + ' HERESY');
  else setTxt('det-fdv', '–');

  // buy/sell pressure bar
  const n = buys.length + sells.length;
  const pct = n ? (buys.length / n) * 100 : 50;
  const bp = document.getElementById('det-bp');
  if (bp) bp.style.width = pct.toFixed(1) + '%';
  setTxt('det-buys', `Buys ${buys.length}`);
  setTxt('det-sells', `Sells ${sells.length}`);
  setTxt('det-buyvol', buyVol > 0 ? 'Buy vol ' + fmtAdaptive(buyVol) + ' HERESY' : 'Buy vol –');
  setTxt('det-sellvol', sellVol > 0 ? 'Sell vol ' + fmtAdaptive(sellVol) + ' HERESY' : 'Sell vol –');

  // addresses
  const addrBox = document.getElementById('det-addrs');
  if (addrBox) {
    addrBox.innerHTML = `
      <div><span class="k">${pk} token</span> <a class="addr-link" href="${GROTTO_ADDR_URL}${t.address}" target="_blank" rel="noopener">${shortAddr(t.address)}</a></div>
      <div><span class="k">Pool</span> <a class="addr-link" href="${GROTTO_ADDR_URL}${t.pool || ''}" target="_blank" rel="noopener">${shortAddr(t.pool || '')}</a></div>`;
  }

  // recent trades
  const body = document.getElementById('trades-body');
  if (!body) return;
  const recent = (tradeStore[pk] || []).slice().sort((a, b) => b.t - a.t).slice(0, 25);
  if (!recent.length) {
    body.innerHTML = `<tr><td colspan="7" class="portfolio-empty">No trades in the loaded window yet.</td></tr>`;
    return;
  }
  body.innerHTML = recent.map(x => {
    const px = x.tok > 0 ? x.whe / x.tok : 0;
    const val = wheresyUsd > 0 ? fmtUsd(x.whe * wheresyUsd) : fmtAdaptive(x.whe) + ' <small>HERESY</small>';
    return `<tr>
      <td class="mono" title="${new Date(x.t).toLocaleString()}">${ago(x.t)}</td>
      <td><span class="chg ${x.side === 'buy' ? 'up' : 'down'}">${x.side === 'buy' ? 'Buy' : 'Sell'}</span></td>
      <td class="num">${fmtAdaptive(px)}</td>
      <td class="num">${fmtAdaptive(x.tok)} <small>${pk}</small></td>
      <td class="num">${val}</td>
      <td class="hide-sm mono">${shortAddr(x.maker)}</td>
      <td><a class="addr-link" href="${GROTTO_EXPLORER}/tx/${x.tx}" target="_blank" rel="noopener">tx ↗</a></td>
    </tr>`;
  }).join('');
}

loadTrades();
