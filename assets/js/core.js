// ==================== STATE ====================
let provider=null, signer=null, userAddress=null;
let roProvider = new ethers.JsonRpcProvider(GROTTO_RPC);
let routerRO = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, roProvider);
let bobRO = new ethers.Contract(BOB_GROTTO, ERC20_ABI, roProvider);
let avaxRoProvider = new ethers.JsonRpcProvider(AVAX_C_RPC);
// There is no "Avalanche HeresyRouter" — the final leg on Avalanche is
// quoted/executed through KyberSwap's public API instead. See
// getKyberSwapQuote() below.
let fromKey = 'BOB', toKey = 'HERESY';
let slippagePct = 1;
let poolData = {};   // tokenKey => { tokenReserve, wheresyReserve }
let bobUsd = 0;
let wheresyUsd = 0;
let estimateTimer = null;
const iconCache = {};

// ---- price chart state ----
const CHART_HISTORY_KEY = 'heresy_price_history_v1';
const CHART_MAX_POINTS = 500;
let chartTokenKey = 'BOB';
let priceChart = null;
let priceHistory = {}; // loaded lazily from localStorage: { SYMBOL: [{t, usd, wheresy}] }
function loadPriceHistory(){
  try{ priceHistory = JSON.parse(localStorage.getItem(CHART_HISTORY_KEY) || '{}'); }
  catch(e){ priceHistory = {}; }
}
function savePriceHistory(){
  try{ localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(priceHistory)); }catch(e){}
}
function recordPricePoint(key, usd, wheresyPrice){
  if(!isFinite(usd) || usd<=0) return;
  if(!priceHistory[key]) priceHistory[key] = [];
  const arr = priceHistory[key];
  const last = arr[arr.length-1];
  const now = Date.now();
  if(last && now - last.t < 15000) return; // avoid dupes if refreshPrices fires twice quickly
  arr.push({ t: now, usd, wheresy: wheresyPrice });
  if(arr.length > CHART_MAX_POINTS) arr.splice(0, arr.length - CHART_MAX_POINTS);
}

// ---- tx history state ----
const TX_HISTORY_KEY_PREFIX = 'heresy_tx_history_';
function txHistoryKey(){ return TX_HISTORY_KEY_PREFIX + (userAddress||'').toLowerCase(); }
function loadTxHistory(){
  if(!userAddress) return [];
  try{ return JSON.parse(localStorage.getItem(txHistoryKey()) || '[]'); }catch(e){ return []; }
}
function pushTxHistory(entry){
  if(!userAddress) return;
  const list = loadTxHistory();
  list.unshift(entry);
  if(list.length > 100) list.length = 100;
  try{ localStorage.setItem(txHistoryKey(), JSON.stringify(list)); }catch(e){}
}
function clearTxHistory(){
  if(!userAddress) return;
  if(!confirm('Clear your locally-stored transaction history? This only clears it from this browser — nothing on-chain is affected.')) return;
  try{ localStorage.removeItem(txHistoryKey()); }catch(e){}
  renderTxHistory();
}

document.getElementById('router-link').href = 'https://grottoexplorer.xyz/address/' + ROUTER_ADDRESS;
document.getElementById('router-link').textContent = ROUTER_ADDRESS.slice(0,6)+'…'+ROUTER_ADDRESS.slice(-4);

function toggleAdvanced(){ document.getElementById('adv-panel').classList.toggle('open'); }
function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast toast-${type}`;
  el.textContent=msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.classList.add('show'),10);
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),300);},3500);
}
function setTxStatus(id,msg,type,spinner){
  const el=document.getElementById(id);
  el.innerHTML = (spinner? '<span class="spinner"></span>':'') + '<span>'+msg+'</span>';
  el.className = `tx-status show tx-${type}`;
}
function friendlyError(e){
  const msg = e?.reason || e?.shortMessage || e?.message || String(e);
  if(/user rejected/i.test(msg)) return 'Transaction rejected.';
  if(/no route/i.test(msg)) return 'No route available for this pair.';
  if(/insufficient output/i.test(msg)) return 'Price moved past your slippage tolerance — try again or raise slippage.';
  if(/insufficient liquidity/i.test(msg)) return 'Not enough liquidity in the pool for this amount.';
  if(/insufficient/i.test(msg)) return 'Insufficient balance or gas.';
  return msg.slice(0,200);
}
function setProgress(step, state){
  const seg = document.getElementById('seg-'+step);
  seg.classList.remove('active','done');
  if(state) seg.classList.add(state);
}
function resetProgress(needsApprove){
  document.getElementById('progress-track').style.display='flex';
  document.getElementById('progress-labels').style.display='flex';
  setProgress(1,''); setProgress(2,'');
  document.getElementById('seg-1').style.opacity = needsApprove ? '1':'0.25';
}
function pulse(el){ el.classList.remove('pulse-once'); void el.offsetWidth; el.classList.add('pulse-once'); }
function fmtAdaptive(num){
  if(num===0 || num==null || isNaN(num)) return '0';
  if(!isFinite(num)) return '–';
  const abs = Math.abs(num);
  if(abs >= 1000) return num.toLocaleString(undefined,{maximumFractionDigits:2});
  if(abs >= 1) return num.toLocaleString(undefined,{maximumFractionDigits:6});
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(abs)) - 1);
  const decimals = Math.min(leadingZeros + 5, 18);
  let s = num.toFixed(decimals);
  s = s.replace(/0+$/,'').replace(/\.$/,'');
  return s === '' || s === '-' ? '0' : s;
}
function fmtUsd(num){
  if(!isFinite(num) || num==null) return '$0.00';
  const abs = Math.abs(num);
  if(abs===0) return '$0.00';
  if(abs >= 1) return '$' + num.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(abs)) - 1);
  const decimals = Math.min(leadingZeros + 4, 12);
  return '$' + num.toFixed(decimals).replace(/0+$/,'').replace(/\.$/,'');
}

