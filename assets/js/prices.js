// ==================== PRICES ====================
async function refreshPrices(){
  // Fetch each pool independently — one bad/unresponsive pool (e.g. a newly
  // added token with a wrong pool address) must not zero out every other
  // token's price. This used Promise.all before, which meant a single
  // rejected call blanked out poolData entirely and permanently emptied
  // the chart (recordPricePoint never fires if usd<=0 for everything).
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
    if(result.status === 'fulfilled'){
      poolData[key] = result.value[1];
    } else {
      console.warn(`pool reserves load failed for ${key}`, result.reason);
      // keep any previously-known value rather than deleting it, so a single
      // flaky RPC call doesn't blank an otherwise-working chart/price
    }
  });

  try{
    const res = await fetch(DEXSCREENER_BOB_AVAX);
    const data = await res.json();
    const pair = data.pair || (data.pairs && data.pairs[0]);
    if(pair && pair.priceUsd){
      bobUsd = parseFloat(pair.priceUsd);
      if(poolData.BOB && poolData.BOB.tokenReserve>0){
        const wheresyPerBob = poolData.BOB.wheresyReserve/poolData.BOB.tokenReserve;
        wheresyUsd = wheresyPerBob>0 ? bobUsd/wheresyPerBob : 0;
      }
    }
  }catch(e){ console.warn('usd price fetch failed', e); }

  recordAllPricePoints();
  updatePriceGrid();
  updateEstimate();
  renderChart();
  if(typeof onPricesUpdated==='function') onPricesUpdated();
}
function recordAllPricePoints(){
  // Chart data must never depend on the Dexscreener fetch above succeeding -
  // that's a single external call (often CORS-blocked or rate-limited in a
  // browser context) and gating chart recording behind usd>0 meant EVERY
  // token's chart silently stayed empty forever whenever that one fetch
  // failed, even though on-chain reserves (poolData) were fetched
  // successfully the whole time. Record whenever we have a valid
  // on-chain-derived WHERESY price OR a usd price - usd is an optional
  // upgrade layered on top, not a prerequisite.
  Object.keys(TOKENS).forEach(key=>{
    const usd = tokenUsd(key);
    let wp; // price in WHERESY terms
    if(key==='WHERESY'||key==='HERESY') wp = 1;
    else{
      const info = poolData[key];
      wp = (info && info.tokenReserve>0) ? info.wheresyReserve/info.tokenReserve : 0;
    }
    if(usd>0 || wp>0) recordPricePoint(key, usd, wp);
  });
  savePriceHistory();
}
function tokenUsd(key){
  if(key==='BOB') return bobUsd;
  if(key==='HERESY'||key==='WHERESY') return wheresyUsd;
  const info = poolData[key];
  if(!info || info.tokenReserve<=0 || wheresyUsd<=0) return 0;
  const wheresyPerToken = info.wheresyReserve/info.tokenReserve;
  return wheresyPerToken*wheresyUsd;
}
function updatePriceGrid(){
  document.getElementById('pc1-icon').src = iconFor(fromKey);
  document.getElementById('pc1-label').textContent = '$'+fromKey;
  document.getElementById('pc1-val').textContent = fmtUsd(tokenUsd(fromKey));
  document.getElementById('pc1-sub').textContent = fromKey==='BOB' ? 'via Avax dexscreener ref.' : 'derived from WHERESY pool';

  document.getElementById('pc2-label').textContent = `1 ${fromKey} ≈`;
  const rate = quoteRatePreview();
  document.getElementById('pc2-val').textContent = rate!=null ? `${fmtAdaptive(rate)} ${toKey}` : '–';

  document.getElementById('pc3-icon').src = iconFor('WHERESY');
  document.getElementById('pc3-val').textContent = fmtUsd(wheresyUsd);
}
// cheap local estimate for the price-grid card only (not used for the actual swap quote)
function quoteRatePreview(){
  if(fromKey===toKey) return null;
  const fu = tokenUsd(fromKey), tu = tokenUsd(toKey);
  if(fu>0 && tu>0) return fu/tu;
  return null;
}

