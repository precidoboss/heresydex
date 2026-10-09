// ==================== ROUTING DISPLAY ====================
function updateRouteLine(){
  const line = document.getElementById('route-line');
  if(fromKey===toKey){ line.textContent=''; return; }
  if((fromKey==='WHERESY'&&toKey==='HERESY')||(fromKey==='HERESY'&&toKey==='WHERESY')){
    line.textContent = fromKey==='HERESY' ? 'Route: wrap HERESY → WHERESY (1:1, no fee)' : 'Route: unwrap WHERESY → HERESY (1:1, no fee)';
    return;
  }
  const fromHub = fromKey==='WHERESY'||fromKey==='HERESY';
  const toHub = toKey==='WHERESY'||toKey==='HERESY';
  if(fromHub || toHub){
    line.textContent = `Route: ${fromKey} → pool → ${toKey} · via HeresyRouter`;
  } else {
    line.textContent = `Route: ${fromKey} → WHERESY → ${toKey} · via HeresyRouter`;
  }
}
function flipDirection(){
  const btn = document.getElementById('flip-btn');
  btn.classList.add('spin');
  setTimeout(()=>btn.classList.remove('spin'),400);
  const tmp = fromKey; fromKey = toKey; toKey = tmp;
  setPickerUI('from', fromKey);
  setPickerUI('to', toKey);
  document.getElementById('in-amount').value='';
  document.getElementById('out-amount').value='';
  updateRouteLine();
  updatePriceGrid();
  updateEstimate();
  refreshBalances();
  updateSwapButtonLabel();
}
function setSlippage(v, btn){
  slippagePct = v;
  document.querySelectorAll('.slip-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('custom-slip').value = '';
  updateEstimate();
}
function setCustomSlippage(v){
  const n = parseFloat(v);
  if(!v || isNaN(n) || n<=0){ return; }
  slippagePct = Math.min(n, 50);
  document.querySelectorAll('.slip-btn').forEach(b=>b.classList.remove('active'));
  updateEstimate();
}
function onAmountChange(){
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(updateEstimate, 300);
}

function routerAddrFor(key){
  return TOKENS[key].type==='native' ? ethers.ZeroAddress : TOKENS[key].address;
}

function estimateImpact(amtIn, amountOut){
  let info=null, dir=null;
  if((fromKey==='WHERESY'||fromKey==='HERESY') && poolData[toKey]){ info=poolData[toKey]; dir='out'; }
  else if((toKey==='WHERESY'||toKey==='HERESY') && poolData[fromKey]){ info=poolData[fromKey]; dir='in'; }
  if(!info) return fromKey==='WHERESY'||fromKey==='HERESY'||toKey==='WHERESY'||toKey==='HERESY' ? '–' : '~ (2-hop)';
  let spot;
  if(dir==='out'){
    const rate = info.wheresyReserve>0 ? info.tokenReserve/info.wheresyReserve : 0;
    spot = amtIn*rate;
  } else {
    const rate = info.tokenReserve>0 ? info.wheresyReserve/info.tokenReserve : 0;
    spot = amtIn*rate;
  }
  if(spot<=0) return '–';
  const impact = ((spot-amountOut)/spot)*100;
  return impact.toFixed(2)+'%';
}

async function updateEstimate(){
  const amtIn = parseFloat(document.getElementById('in-amount').value || '0');
  const outEl = document.getElementById('out-amount');

  if(!amtIn || amtIn<=0 || fromKey===toKey){
    outEl.value='';
    document.getElementById('usd-from').textContent='≈ $0.00';
    document.getElementById('usd-to').textContent='≈ $0.00';
    document.getElementById('det-price').textContent='–';
    document.getElementById('det-impact').textContent='–';
    document.getElementById('det-min').textContent='–';
    document.getElementById('det-fee').textContent='–';
    return;
  }

  document.getElementById('usd-from').textContent = '≈ ' + fmtUsd(amtIn * tokenUsd(fromKey));

  const fromTok = TOKENS[fromKey], toTok = TOKENS[toKey];
  const amountInWei = ethers.parseUnits(amtIn.toString(), fromTok.decimals);

  let q;
  try{
    q = await routerRO.quote(routerAddrFor(fromKey), routerAddrFor(toKey), amountInWei);
  }catch(e){
    outEl.value='';
    document.getElementById('det-impact').textContent='–';
    return;
  }
  const amountOutRaw = q[0], feeRaw = q[1], routeExists = q[2];

  if(!routeExists){
    outEl.value='';
    document.getElementById('usd-to').textContent='≈ $0.00';
    document.getElementById('det-price').textContent='No route';
    document.getElementById('det-impact').textContent='–';
    document.getElementById('det-min').textContent='–';
    document.getElementById('det-fee').textContent='–';
    return;
  }

  const amountOut = parseFloat(ethers.formatUnits(amountOutRaw, toTok.decimals));
  const feeAmt = parseFloat(ethers.formatUnits(feeRaw, fromTok.decimals));

  outEl.value = amountOut>0 ? fmtAdaptive(amountOut) : '';
  pulse(outEl);
  document.getElementById('usd-to').textContent = '≈ ' + fmtUsd(amountOut * tokenUsd(toKey));

  const rate = amtIn>0 && amountOut>0 ? amountOut/amtIn : 0;
  document.getElementById('det-price').textContent = amountOut>0 ? `1 ${fromKey} ≈ ${fmtAdaptive(rate)} ${toKey}` : '–';
  document.getElementById('det-impact').textContent = amountOut>0 ? estimateImpact(amtIn, amountOut) : '–';

  const minReceived = amountOut * (1 - slippagePct/100);
  document.getElementById('det-min').textContent = amountOut>0 ? fmtAdaptive(minReceived)+' '+toKey : '–';
  document.getElementById('det-fee').textContent = feeAmt>0 ? fmtAdaptive(feeAmt)+' '+fromKey+' (1%)' : 'No fee (wrap/unwrap)';
}

async function getBalance(key){
  if(!userAddress) return 0;
  const t = TOKENS[key];
  try{
    if(t.type==='native'){
      const bal = await roProvider.getBalance(userAddress);
      return parseFloat(ethers.formatUnits(bal, 18));
    } else {
      const c = new ethers.Contract(t.address, ERC20_ABI, roProvider);
      const bal = await c.balanceOf(userAddress);
      return parseFloat(ethers.formatUnits(bal, t.decimals));
    }
  }catch(e){ return 0; }
}
async function refreshBalances(){
  document.getElementById('bal-from').textContent='Balance: –';
  document.getElementById('bal-to').textContent='Balance: –';
  if(!userAddress) return;
  const [fromBal, toBal] = await Promise.all([getBalance(fromKey), getBalance(toKey)]);
  document.getElementById('bal-from').textContent = 'Balance: ' + fmtAdaptive(fromBal);
  document.getElementById('bal-to').textContent = 'Balance: ' + fmtAdaptive(toBal);
}
function updateSwapButtonLabel(){
  const btn = document.getElementById('btn-swap');
  if(!userAddress){ btn.textContent='Connect Wallet'; btn.disabled=false; return; }
  if(fromKey===toKey){ btn.textContent='Choose different tokens'; btn.disabled=true; return; }
  btn.textContent = `Swap ${fromKey} → ${toKey}`;
  btn.disabled=false;
}

async function doSwap(){
  if(!userAddress){ connectWallet(); return; }
  const amtIn = parseFloat(document.getElementById('in-amount').value || '0');
  if(!amtIn || amtIn<=0){ toast('Enter an amount','error'); return; }
  if(fromKey===toKey){ toast('Pick two different tokens','error'); return; }

  const fromTok = TOKENS[fromKey], toTok = TOKENS[toKey];
  const amountInWei = ethers.parseUnits(amtIn.toString(), fromTok.decimals);
  const fromAddr = routerAddrFor(fromKey), toAddr = routerAddrFor(toKey);

  let q;
  try{
    q = await routerRO.quote(fromAddr, toAddr, amountInWei);
  }catch(e){ toast('Could not fetch a quote — try again','error'); return; }

  const amountOutRaw = q[0], routeExists = q[2];
  if(!routeExists || amountOutRaw === 0n){
    toast('No route or not enough liquidity for this amount','error');
    return;
  }
  const slippageBps = BigInt(Math.round((1 - slippagePct/100) * 10000));
  const amountOutMin = (amountOutRaw * slippageBps) / 10000n;

  const btn = document.getElementById('btn-swap');
  const coin = document.getElementById('coin-fly');
  document.getElementById('coin-fly-img').src = iconFor(toKey);
  btn.disabled = true;
  coin.classList.add('go');

  const needsApprove = fromTok.type !== 'native';
  resetProgress(needsApprove);
  if(!needsApprove) setProgress(1,'done');

  const deadline = Math.floor(Date.now()/1000) + 20*60; // 20 min

  try{
    if(needsApprove){
      const erc20 = new ethers.Contract(fromTok.address, ERC20_ABI, signer);
      const allowance = await erc20.allowance(userAddress, ROUTER_ADDRESS);
      if(allowance < amountInWei){
        setProgress(1,'active');
        setTxStatus('tx-swap', `Approving ${fromKey} for the router (sign in wallet)…`, 'pending', true);
        const txA = await erc20.approve(ROUTER_ADDRESS, amountInWei);
        await txA.wait(1);
      }
      setProgress(1,'done');
    }

    setProgress(2,'active');
    setTxStatus('tx-swap', `Swapping ${fromKey} → ${toKey} (sign in wallet)…`, 'pending', true);

    const routerWrite = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
    let tx;
    if(fromTok.type === 'native'){
      tx = await routerWrite.swapExactNativeForTokens(toAddr, amountOutMin, userAddress, deadline, { value: amountInWei });
    } else if(toTok.type === 'native'){
      tx = await routerWrite.swapExactTokensForNative(fromTok.address, amountInWei, amountOutMin, userAddress, deadline);
    } else {
      tx = await routerWrite.swapExactTokensForTokens(fromTok.address, toTok.address, amountInWei, amountOutMin, userAddress, deadline);
    }
    const receipt = await tx.wait(1);
    setProgress(2,'done');

    setTxStatus('tx-swap','✅ Swap complete!','success');
    toast('Swap complete 🎉','success');
    pushTxHistory({
      type: 'swap',
      from: fromKey,
      to: toKey,
      amountIn: amtIn,
      amountOut: parseFloat(ethers.formatUnits(amountOutRaw, toTok.decimals)),
      hash: receipt?.hash || tx.hash,
      t: Date.now()
    });
    document.getElementById('in-amount').value='';
    document.getElementById('out-amount').value='';
    refreshPrices();
    refreshBalances();
    if(document.getElementById('page-portfolio').classList.contains('active')) refreshPortfolio();
  }catch(e){
    setTxStatus('tx-swap','❌ '+friendlyError(e),'error');
    setProgress(1,''); setProgress(2,'');
  }finally{
    btn.disabled = false;
    setTimeout(()=>coin.classList.remove('go'),1000);
  }
}

