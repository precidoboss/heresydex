// ==================== PRICES ====================
// Never display a fake $0.00: a missing value is shown as "–" and the app
// falls back to on-chain, HERESY-denominated pool ratios until USD loads.

function fmtUsdOr(v){ return (isFinite(v) && v > 0) ? fmtUsd(v) : '–'; }

// on-chain price of one token expressed in WHERESY (== HERESY, 1:1)
function wheresyPerToken(key){
  if(key === 'HERESY' || key === 'WHERESY') return 1;
  const info = poolData[key];
  return (info && info.tokenReserve > 0) ? info.wheresyReserve / info.tokenReserve : 0;
}

// Try several DexScreener routes; the first one that yields a USD price wins.
async function fetchBobUsd(){
  const BOB_TOKEN = TOKENS.BOB.address;
  const sources = [
    DEXSCREENER_BOB_AVAX,
    `https://api.dexscreener.com/latest/dex/tokens/${BOB_TOKEN}`
  ];
  for(const url of sources){
    try{
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if(!res.ok) continue;
      const data = await res.json();
      let pair = data.pair || (data.pairs && data.pairs[0]);
      if(!pair && data.pairs){
        // token endpoint returns many pairs: prefer the Avalanche BOB pair
        pair = data.pairs.find(p => p.pairAddress && p.pairAddress.toLowerCase() === '0x200ce172bf316d302d8e38e712fe0d093162b84b');
      }
      const usd = pair && parseFloat(pair.priceUsd);
      if(usd > 0) return usd;
    }catch(e){ /* try next source */ }
  }
  return 0;
}

async function refreshPrices(){
  // Fetch each pool independently: one bad pool must not blank the others.
  const entries = Object.entries(TOKENS).filter(([,t])=>t.pool);
  const settled = await Promise.allSettled(entries.map(async ([key,t])=>{
    const pair = new ethers.Contract(t.pool, PAIR_ABI, roProvider);
    const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
    const tokenIsToken0 = token0.toLowerCase() === t.address.toLowerCase();
    const rawTok = tokenIsToken0 ? reserves[0] : reserves[1];
    const rawWheresy = tokenIsToken0 ? reserves[1] : reserves[0];
    const tokenReserve = parseFloat(ethers.formatUnits(rawTok, t.decimals));
    const wheresyReserve = parseFloat(ethers.formatUnits(rawWheresy, 18));
    return [key, { tokenReserve, wheresyReserve }];
  }));
  settled.forEach((result, i)=>{
    const key = entries[i][0];
    if(result.status === 'fulfilled') poolData[key] = result.value[1];
    else console.warn(`pool reserves load failed for ${key}`, result.reason);
  });

  const usd = await fetchBobUsd();
  if(usd > 0) bobUsd = usd;
  if(poolData.BOB && poolData.BOB.tokenReserve > 0){
    const wheresyPerBob = poolData.BOB.wheresyReserve / poolData.BOB.tokenReserve;
    if(bobUsd > 0 && wheresyPerBob > 0) wheresyUsd = bobUsd / wheresyPerBob;
  }

  recordAllPricePoints();
  updatePriceGrid();
  updateEstimate();
  renderChart();
  if(typeof onPricesUpdated === 'function') onPricesUpdated();
}

function recordAllPricePoints(){
  Object.keys(TOKENS).forEach(key=>{
    const usd = tokenUsd(key);
    const wp = wheresyPerToken(key);
    if(usd > 0 || wp > 0) recordPricePoint(key, usd, wp);
  });
  savePriceHistory();
}

function tokenUsd(key){
  if(key === 'BOB') return bobUsd;
  if(key === 'HERESY' || key === 'WHERESY') return wheresyUsd;
  const wp = wheresyPerToken(key);
  return (wp > 0 && wheresyUsd > 0) ? wp * wheresyUsd : 0;
}

function updatePriceGrid(){
  document.getElementById('pc1-icon').src = iconFor(fromKey);
  document.getElementById('pc1-label').textContent = '$' + fromKey;
  document.getElementById('pc1-val').textContent = fmtUsdOr(tokenUsd(fromKey));
  document.getElementById('pc1-sub').textContent = fromKey === 'BOB' ? 'via Avax dexscreener ref.' : 'derived from WHERESY pool';

  document.getElementById('pc2-label').textContent = `1 ${fromKey} ≈`;
  const rate = quoteRatePreview();
  document.getElementById('pc2-val').textContent = rate != null ? `${fmtAdaptive(rate)} ${toKey}` : '–';

  document.getElementById('pc3-icon').src = iconFor('WHERESY');
  document.getElementById('pc3-val').textContent = fmtUsdOr(wheresyUsd);
}

// cheap local estimate for the price-grid card only (not used for the actual swap quote)
function quoteRatePreview(){
  if(fromKey === toKey) return null;
  const fu = tokenUsd(fromKey), tu = tokenUsd(toKey);
  if(fu > 0 && tu > 0) return fu / tu;
  // USD not loaded yet: use the on-chain pool ratio (both sides priced in HERESY)
  const f = wheresyPerToken(fromKey), t = wheresyPerToken(toKey);
  if(f > 0 && t > 0) return f / t;
  return null;
}
