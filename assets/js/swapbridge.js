// ==================== SWAP & BRIDGE (GrottoBridgeHub) ====================
let sbFromKey = 'BOB';
let sbViaKey = 'BOB';
let sbSlippagePct = 2;
let sbEstimateTimer = null;
const hubWriteFor = ()=> new ethers.Contract(GROTTO_BRIDGE_HUB, HUB_ABI, signer);

function setBridgeMode(mode){
  document.getElementById('bmode-swapbridge').classList.toggle('active', mode==='swapbridge');
  document.getElementById('bmode-raw').classList.toggle('active', mode==='raw');
  document.getElementById('bridge-swapbridge-section').style.display = mode==='swapbridge' ? 'block' : 'none';
  document.getElementById('bridge-raw-section').style.display = mode==='raw' ? 'block' : 'none';
  if(mode==='raw') refreshBridgeBalances();
}

function buildSbTokenMenu(){
  const menu = document.getElementById('sb-from-menu');
  menu.innerHTML = '';
  Object.keys(TOKENS).forEach(key=>{
    const t = TOKENS[key];
    const item = document.createElement('div');
    item.className = 'token-menu-item';
    item.innerHTML = `<img src="${iconFor(key)}" alt=""/><span>${key}</span>${t.lowLiq?'<span class="liq-flag">⚠ thin</span>':''}`;
    item.onclick = (ev)=>{ ev.stopPropagation(); selectSbToken(key); closeAllMenus(); };
    menu.appendChild(item);
  });
}
function selectSbToken(key){
  sbFromKey = key;
  setPickerUI('sb-from', key);
  if(!BRIDGEABLE_KEYS.includes(key)) sbViaKey = 'BOB'; // reset to a valid default
  else sbViaKey = key;
  document.getElementById('sb-via-select').value = sbViaKey;
  updateSbViaVisibility();
  refreshSbBalance();
  updateSbRouteLine();
  resetSbFinalToken();
  onSbAmountChange();
}
function updateSbViaVisibility(){
  document.getElementById('sb-via-group').style.display = BRIDGEABLE_KEYS.includes(sbFromKey) ? 'none' : 'block';
}
function onSbViaChange(){
  sbViaKey = document.getElementById('sb-via-select').value;
  updateSbRouteLine();
  resetSbFinalToken();
  onSbAmountChange();
}
function updateSbRouteLine(){
  const line = document.getElementById('sb-route-line');
  if(sbFromKey === sbViaKey || BRIDGEABLE_KEYS.includes(sbFromKey)){
    line.textContent = `Route: bridge ${sbViaKey} directly · via GrottoBridgeHub`;
  } else {
    line.textContent = `Route: ${sbFromKey} → ${sbViaKey} on Grotto → bridge ${sbViaKey} · via GrottoBridgeHub`;
  }
}
async function refreshSbBalance(){
  document.getElementById('sb-bal-from').textContent = 'Balance: –';
  if(!userAddress) return;
  const bal = await getBalance(sbFromKey);
  document.getElementById('sb-bal-from').textContent = 'Balance: ' + fmtAdaptive(bal);
}

// ---- Final-token (Avalanche) picker ----
let sbFinalKey = 'BOB';
function availableFinalKeys(){
  // Previously AVAX (native OUT) was hidden as a target for BOB/CAVE/USDC,
  // because the old fixed Avalanche router could only ever call
  // swapExactTokensForTokens (ERC20-out only, never native-out). That
  // restriction no longer applies — AvalancheBridgeReceiver now executes
  // whatever calldata KyberSwap's API builds, and KyberSwap can swap any
  // ERC20 into native AVAX directly, output sent straight to the
  // recipient. All final-token options are available regardless of what's
  // being bridged.
  return Object.keys(AVAX_TOKENS);
}
function buildSbFinalMenu(){
  const menu = document.getElementById('sb-final-menu');
  menu.innerHTML = '';
  availableFinalKeys().forEach(key=>{
    const t = AVAX_TOKENS[key];
    const item = document.createElement('div');
    item.className = 'token-menu-item';
    item.innerHTML = `<img src="${t.icon}" alt=""/><span>${key}</span>`;
    item.onclick = (ev)=>{ ev.stopPropagation(); selectSbFinal(key); closeAllMenus(); };
    menu.appendChild(item);
  });
}
function selectSbFinal(key){
  sbFinalKey = key;
  const t = AVAX_TOKENS[key];
  document.getElementById('sb-final-picker-label').textContent = key;
  document.getElementById('sb-final-picker-icon').src = t.icon;
  // picking from the list overrides any custom address typed in
  document.getElementById('sb-final-token').value = '';
  onSbAmountChange();
}
function resetSbFinalToken(){
  const key = SB_DEFAULT_FINAL_KEY[sbViaKey] || 'BOB';
  document.getElementById('sb-final-custom-group').style.display = 'none';
  document.getElementById('sb-final-token').value = '';
  buildSbFinalMenu();
  selectSbFinal(key);
}
function toggleSbCustomFinal(){
  const grp = document.getElementById('sb-final-custom-group');
  const opening = grp.style.display === 'none';
  grp.style.display = opening ? 'block' : 'none';
  if(opening) document.getElementById('sb-final-token').focus();
}
// Resolves { address, decimals, label } for whatever is currently selected —
// the picker, or a custom address if one's been typed in. For a custom
// address we read decimals() live off Avalanche rather than assuming 18,
// so the estimate shown before signing is accurate for any token.
async function resolveFinalToken(){
  const raw = document.getElementById('sb-final-token').value.trim();
  if(raw && ethers.isAddress(raw)){
    try{
      const c = new ethers.Contract(raw, ERC20_ABI, avaxRoProvider);
      const decimals = await c.decimals();
      return { address: raw, decimals: Number(decimals), label: raw.slice(0,6)+'…'+raw.slice(-4) };
    }catch(e){
      return { address: raw, decimals: 18, label: raw.slice(0,6)+'…'+raw.slice(-4), decimalsUnknown: true };
    }
  }
  const t = AVAX_TOKENS[sbFinalKey];
  return { address: t.address, decimals: t.decimals, label: t.symbol };
}

function setSbSlippage(v, btn){
  sbSlippagePct = v;
  btn.parentElement.querySelectorAll('.slip-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sb-custom-slip').value = '';
  onSbAmountChange();
}
function setSbCustomSlippage(v){
  const n = parseFloat(v);
  if(!v || isNaN(n) || n<=0) return;
  sbSlippagePct = Math.min(n, 50);
  document.getElementById('sb-custom-slip').closest('.slippage-row').querySelectorAll('.slip-btn').forEach(b=>b.classList.remove('active'));
  onSbAmountChange();
}
function onSbAmountChange(){
  clearTimeout(sbEstimateTimer);
  sbEstimateTimer = setTimeout(updateSbEstimate, 300);
}
async function updateSbEstimate(){
  const amtStr = document.getElementById('sb-amount').value;
  const amt = parseFloat(amtStr || '0');
  const btn = document.getElementById('btn-swapbridge');
  if(!amt || amt<=0){
    document.getElementById('sb-det-bridge').textContent = '–';
    document.getElementById('sb-det-final').textContent = '–';
    document.getElementById('sb-det-min').textContent = '–';
    return;
  }
  const fromTok = TOKENS[sbFromKey];
  const amountInWei = ethers.parseUnits(amt.toString(), fromTok.decimals);
  const viaTok = TOKENS[sbViaKey];

  // Leg 1: on Grotto, tokenIn -> bridgeToken (skipped if they're the same)
  let bridgeAmountWei = amountInWei;
  if(sbFromKey !== sbViaKey){
    try{
      const q = await routerRO.quote(routerAddrFor(sbFromKey), routerAddrFor(sbViaKey), amountInWei);
      if(!q[2]){ document.getElementById('sb-det-bridge').textContent = 'No route on Grotto'; document.getElementById('sb-det-final').textContent='–'; document.getElementById('sb-det-min').textContent='–'; return; }
      bridgeAmountWei = q[0];
    }catch(e){
      document.getElementById('sb-det-bridge').textContent = 'Quote failed';
      return;
    }
  }
  const bridgeAmount = parseFloat(ethers.formatUnits(bridgeAmountWei, viaTok.decimals));
  document.getElementById('sb-det-bridge').textContent = `${fmtAdaptive(bridgeAmount)} ${sbViaKey}`;

  // Leg 2: on Avalanche, bridged asset -> final token (skipped if same asset)
  const final = await resolveFinalToken();
  const bridgedAssetAddr = AVAX_BRIDGE_ASSET[sbViaKey];
  if(final.address.toLowerCase() === bridgedAssetAddr.toLowerCase()){
    document.getElementById('sb-det-final').textContent = `${fmtAdaptive(bridgeAmount)} ${sbViaKey} (no swap)`;
    document.getElementById('sb-det-min').textContent = `${fmtAdaptive(bridgeAmount)} ${sbViaKey}`;
    updateSwapBridgeButtonLabel();
    return;
  }
  document.getElementById('sb-det-final').textContent = 'Fetching best rate via KyberSwap…';
  document.getElementById('sb-det-min').textContent = '–';
  if(!userAddress){
    document.getElementById('sb-det-final').textContent = 'Connect wallet to see final-leg quote';
    document.getElementById('sb-det-min').textContent = '–';
    updateSwapBridgeButtonLabel();
    return;
  }
  const kyberIn = toKyberAddr(bridgedAssetAddr);
  const kyberOut = toKyberAddr(final.address);
  const kyberSlippageBps = Math.round(sbSlippagePct * 100);
  const kq = await getKyberSwapQuote(kyberIn, kyberOut, bridgeAmountWei, userAddress, kyberSlippageBps);
  if(!kq){
    document.getElementById('sb-det-final').textContent = 'No KyberSwap route right now — will fall back to raw ' + sbViaKey;
    document.getElementById('sb-det-min').textContent = '–';
  } else {
    const estOut = parseFloat(ethers.formatUnits(kq.amountOut, final.decimals));
    const decNote = final.decimalsUnknown ? ' (decimals unverified — assuming 18)' : '';
    document.getElementById('sb-det-final').textContent = `≈ ${fmtAdaptive(estOut)} ${final.label}${decNote} · via KyberSwap`;
    // Kyber already applies slippageTolerance when it BUILDS the actual
    // calldata (the guaranteed-min is enforced on-chain by Kyber's own
    // router at execution time) — this is a display-only estimate of that
    // same floor, not a separately-enforced value on our side.
    const minOut = estOut * (1 - sbSlippagePct/100);
    document.getElementById('sb-det-min').textContent = fmtAdaptive(minOut) + ' ' + final.label;
  }
  updateSwapBridgeButtonLabel();
}
function updateSwapBridgeButtonLabel(){
  const btn = document.getElementById('btn-swapbridge');
  if(!userAddress){ btn.textContent = 'Connect Wallet'; btn.disabled = false; return; }
  btn.textContent = `Swap & Bridge ${sbFromKey}`;
  btn.disabled = false;
}
function sbSetProgress(step, state){
  const seg = document.getElementById('sb-seg-'+step);
  seg.classList.remove('active','done');
  if(state) seg.classList.add(state);
}
async function doSwapAndBridge(){
  if(!userAddress){ connectWallet(); return; }
  const amt = parseFloat(document.getElementById('sb-amount').value || '0');
  if(!amt || amt<=0){ toast('Enter an amount','error'); return; }
  const recipientInput = document.getElementById('sb-recipient').value.trim();
  const recipient = recipientInput || userAddress;
  if(!ethers.isAddress(recipient)){ toast('Recipient is not a valid address','error'); return; }
  const finalTok = await resolveFinalToken();
  const finalTokenAddr = finalTok.address;
  if(!ethers.isAddress(finalTokenAddr)){ toast('Enter a valid final token address (or leave it defaulted)','error'); return; }

  const fromTok = TOKENS[sbFromKey];
  const viaTok = TOKENS[sbViaKey];
  const amountInWei = ethers.parseUnits(amt.toString(), fromTok.decimals);

  // Recompute min-bridge and min-final right before sending, same as the
  // estimate above, so what gets signed matches what was shown.
  let bridgeAmountWei = amountInWei;
  let minBridgeWei = 0n;
  if(sbFromKey !== sbViaKey){
    let q;
    try{ q = await routerRO.quote(routerAddrFor(sbFromKey), routerAddrFor(sbViaKey), amountInWei); }
    catch(e){ toast('Could not fetch a Grotto-side quote','error'); return; }
    if(!q[2] || q[0]===0n){ toast(`No route from ${sbFromKey} to ${sbViaKey} on Grotto`,'error'); return; }
    bridgeAmountWei = q[0];
    const bps = BigInt(Math.round((1 - sbSlippagePct/100)*10000));
    minBridgeWei = (bridgeAmountWei * bps) / 10000n;
  }

  const bridgedAssetAddr = AVAX_BRIDGE_ASSET[sbViaKey];
  // Build the destination-chain payload EXACTLY the way
  // AvalancheBridgeReceiver.sol expects: abi.encode(address swapTarget,
  // bytes swapCalldata, address recipient, uint256 deadline). swapTarget
  // stays the zero address when no swap is needed OR when Kyber has no
  // route right now — the receiver treats that as "just deliver the raw
  // bridged asset", which is always safe, never reverts, never loses funds.
  const destinationDeadline = Math.floor(Date.now()/1000) + 3600;
  let swapTarget = ethers.ZeroAddress;
  let swapCalldata = '0x';
  if(finalTokenAddr.toLowerCase() !== bridgedAssetAddr.toLowerCase()){
    const kyberSlippageBps = Math.round(sbSlippagePct * 100);
    const kq = await getKyberSwapQuote(
      toKyberAddr(bridgedAssetAddr), toKyberAddr(finalTokenAddr),
      bridgeAmountWei, recipient, kyberSlippageBps
    );
    if(kq){
      swapTarget = kq.routerAddress;
      swapCalldata = kq.calldata;
    }
    // else: no route available right now — proceeding with swapTarget
    // still zero, exactly matching what the estimate above already told
    // the user would happen ("will fall back to raw <asset>"). This is a
    // deliberate, informed fallback, not a silent failure.
  }
  const destinationPayload = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address','bytes','address','uint256'],
    [swapTarget, swapCalldata, recipient, destinationDeadline]
  );

  const btn = document.getElementById('btn-swapbridge');
  btn.disabled = true;
  document.getElementById('sb-progress-track').style.display = 'flex';
  document.getElementById('sb-progress-labels').style.display = 'flex';
  sbSetProgress(1,''); sbSetProgress(2,'');

  try{
    if(sbFromKey === 'HERESY'){
      // Native path — bridgeNativeAndCall, no approval needed
      sbSetProgress(1,'done');
      sbSetProgress(2,'active');
      setTxStatus('tx-swapbridge', 'Bridging HERESY (sign in wallet)…', 'pending', true);
      const hub = hubWriteFor();
      const tx = await hub.bridgeNativeAndCall(destinationPayload, { value: amountInWei });
      setTxStatus('tx-swapbridge', 'Confirming on Grotto — funds arrive on Avalanche shortly after…', 'pending', true);
      await tx.wait(1);
      sbSetProgress(2,'done');
      setTxStatus('tx-swapbridge', '✅ Bridge transaction sent! Check the recipient address on Avalanche shortly.', 'success');
      toast('Swap & Bridge sent 🎉','success');
    } else {
      // ERC20 path — approve the HUB (not the router), then swapAndBridge
      const erc20 = new ethers.Contract(fromTok.address, ERC20_ABI, signer);
      const allowance = await erc20.allowance(userAddress, GROTTO_BRIDGE_HUB);
      if(allowance < amountInWei){
        sbSetProgress(1,'active');
        setTxStatus('tx-swapbridge', `Approving ${sbFromKey} for GrottoBridgeHub (sign in wallet)…`, 'pending', true);
        const txA = await erc20.approve(GROTTO_BRIDGE_HUB, amountInWei);
        await txA.wait(1);
      }
      sbSetProgress(1,'done');
      sbSetProgress(2,'active');
      setTxStatus('tx-swapbridge', `Swapping & bridging ${sbFromKey} (sign in wallet)…`, 'pending', true);
      const hub = hubWriteFor();
      const tx = await hub.swapAndBridge(fromTok.address, viaTok.address, amountInWei, minBridgeWei, destinationPayload);
      setTxStatus('tx-swapbridge', 'Confirming on Grotto — funds arrive on Avalanche shortly after…', 'pending', true);
      await tx.wait(1);
      sbSetProgress(2,'done');
      setTxStatus('tx-swapbridge', '✅ Bridge transaction sent! Check the recipient address on Avalanche shortly.', 'success');
      toast('Swap & Bridge sent 🎉','success');
    }
    document.getElementById('sb-amount').value = '';
    refreshSbBalance();
  }catch(e){
    setTxStatus('tx-swapbridge', '❌ '+friendlyError(e), 'error');
    sbSetProgress(1,''); sbSetProgress(2,'');
  }finally{
    btn.disabled = false;
  }
}

