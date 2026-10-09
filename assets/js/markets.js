// ==================== MARKETS TABLE + HERO STATS ====================
let marketsSort = { by:'liq', dir:-1 };
let marketsFilter = '';

function sparkSvg(key){
  let pts;
  try{ pts = seriesForSpark(key); }catch(e){ pts = []; }
  if(pts.length < 2) return '<svg class="spark" viewBox="0 0 80 28"><line x1="0" y1="14" x2="80" y2="14" stroke="#3a3a40" stroke-dasharray="3 3"/></svg>';
  const vs = pts.map(p=>p.v), min = Math.min(...vs), max = Math.max(...vs), rng = (max-min)||1;
  const t0 = pts[0].t, t1 = pts[pts.length-1].t, tr = (t1-t0)||1;
  const d = pts.map((p,i)=>`${i?'L':'M'}${(((p.t-t0)/tr)*80).toFixed(1)},${(26-((p.v-min)/rng)*24).toFixed(1)}`).join(' ');
  const up = vs[vs.length-1] >= vs[0];
  return `<svg class="spark" viewBox="0 0 80 28"><path d="${d}" fill="none" stroke="${up?'#22C55E':'#FF4A1C'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
// last 24h of the pool series, always in WHERESY-per-token terms (independent of chart denom)
function seriesForSpark(key){
  const raw = rawPoolSeries(key);
  const cutoff = Date.now() - 86400000;
  let pts = raw.filter(p=>p[0]>=cutoff).map(p=>({t:p[0], v:p[1]}));
  const before = raw.filter(p=>p[0]<cutoff);
  if(before.length) pts.unshift({t:cutoff, v:before[before.length-1][1]});
  if(pts.length > 60){
    const step = Math.ceil(pts.length/60);
    pts = pts.filter((_,i)=> i%step===0 || i===pts.length-1);
  }
  return pts;
}
function change24h(key){
  const pts = seriesForSpark(key);
  if(pts.length < 2) return null;
  const a = pts[0].v, b = pts[pts.length-1].v;
  return a>0 ? ((b-a)/a)*100 : null;
}

function marketRows(){
  return Object.keys(TOKENS).filter(k=>TOKENS[k].pool).map(key=>{
    const pd = poolData[key];
    const wp = pd && pd.tokenReserve>0 ? pd.wheresyReserve/pd.tokenReserve : 0;
    const liqH = pd ? pd.wheresyReserve*2 : 0;
    return { key, wp, usd: tokenUsd(key), chg: change24h(key), liqH, liqUsd: liqH*wheresyUsd };
  });
}

function renderMarkets(){
  const body = document.getElementById('markets-body');
  if(!body) return;
  let rows = marketRows();
  if(marketsFilter){
    const q = marketsFilter.toLowerCase();
    rows = rows.filter(r=>r.key.toLowerCase().includes(q));
  }
  const by = marketsSort.by, dir = marketsSort.dir;
  const val = r => by==='name' ? r.key : by==='price' ? (r.usd||r.wp) : by==='chg' ? (r.chg==null?-Infinity:r.chg) : r.liqH;
  rows.sort((a,b)=>{ const x=val(a), y=val(b); return (x>y?1:x<y?-1:0)*dir; });

  if(rows.length === 0){
    body.innerHTML = `<tr><td colspan="6" class="portfolio-empty">${Object.keys(poolData).length? 'No markets match your search.' : 'Loading markets…'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r,i)=>{
    const t = TOKENS[r.key];
    const chg = r.chg==null ? '<span class="chg flat">–</span>' : `<span class="chg ${r.chg>0.005?'up':r.chg<-0.005?'down':'flat'}">${r.chg>=0?'▲':'▼'} ${Math.abs(r.chg).toFixed(2)}%</span>`;
    const price = r.usd>0 ? fmtUsd(r.usd) : (r.wp>0 ? fmtAdaptive(r.wp)+' <small>HERESY</small>' : '–');
    const liq = r.liqH>0 ? (wheresyUsd>0 ? fmtUsd(r.liqUsd) : fmtAdaptive(r.liqH)+' <small>HERESY</small>') : '–';
    return `<tr onclick="openMarket('${r.key}')" tabindex="0" onkeydown="if(event.key==='Enter')openMarket('${r.key}')">
      <td class="rank">${i+1}</td>
      <td><div class="mk-token"><img src="${iconFor(r.key)}" alt=""/><div><b>${r.key}</b>${t.lowLiq?' <span class="liq-flag">thin</span>':''}<div class="mk-sub">${r.key} / HERESY</div></div></div></td>
      <td class="num">${price}</td>
      <td class="num">${chg}</td>
      <td class="num hide-sm">${liq}</td>
      <td class="hide-sm">${sparkSvg(r.key)}</td>
    </tr>`;
  }).join('');
}

function sortMarkets(by){
  if(marketsSort.by === by) marketsSort.dir *= -1; else marketsSort = { by, dir: by==='name'?1:-1 };
  document.querySelectorAll('#markets-table th[data-sort]').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.sort===marketsSort.by);
    th.dataset.dir = th.dataset.sort===marketsSort.by ? (marketsSort.dir>0?'▲':'▼') : '';
  });
  renderMarkets();
}
function filterMarkets(v){ marketsFilter = v.trim(); renderMarkets(); }

// click a market: chart it, and pre-load a HERESY -> token swap
function openMarket(key){
  setActiveChartToken(key);
  if(fromKey !== 'HERESY' || toKey !== key){
    if(key === fromKey) fromKey = 'HERESY';
    fromKey = 'HERESY'; toKey = key;
    setPickerUI('from', fromKey); setPickerUI('to', toKey);
    updateRouteLine(); updatePriceGrid(); updateEstimate(); refreshBalances(); updateSwapButtonLabel();
  }
  const card = document.getElementById('chart-card');
  if(card) card.scrollIntoView({ behavior:'smooth', block:'start' });
}

function updateHeroStats(){
  const rows = marketRows();
  const totalLiq = rows.reduce((s,r)=>s + (r.liqH||0), 0);
  tweenText(document.getElementById('hs-heresy'), wheresyUsd>0 ? fmtUsd(wheresyUsd) : '–');
  tweenText(document.getElementById('hs-bob'), bobUsd>0 ? fmtUsd(bobUsd) : '–');
  tweenText(document.getElementById('hs-liq'), totalLiq>0 ? (wheresyUsd>0 ? fmtUsd(totalLiq*wheresyUsd) : fmtAdaptive(totalLiq)+' HERESY') : '–');
  tweenText(document.getElementById('hs-markets'), String(rows.filter(r=>r.liqH>0).length || rows.length));
}

function onPricesUpdated(){
  updateHeroStats();
  renderMarkets();
}
