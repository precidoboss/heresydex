// ==================== PORTFOLIO ====================
async function refreshPortfolio(){
  if(!userAddress){
    document.getElementById('portfolio-disconnected').style.display = 'block';
    document.getElementById('portfolio-connected').style.display = 'none';
    return;
  }
  document.getElementById('portfolio-disconnected').style.display = 'none';
  document.getElementById('portfolio-connected').style.display = 'block';
  document.getElementById('pf-addr').textContent = userAddress.slice(0,6)+'…'+userAddress.slice(-4) + ' · The Grotto';

  const holdingsEl = document.getElementById('pf-holdings');
  holdingsEl.innerHTML = '<div class="portfolio-empty">Loading balances…</div>';

  const keys = Object.keys(TOKENS);
  const balances = await Promise.all(keys.map(k => getBalance(k)));
  const rows = keys.map((key,i)=>{
    const bal = balances[i];
    const usd = bal * tokenUsd(key);
    return { key, bal, usd };
  }).filter(r => r.bal > 0);

  const total = rows.reduce((s,r)=>s+r.usd, 0);
  document.getElementById('pf-total').textContent = fmtUsd(total);

  if(rows.length === 0){
    holdingsEl.innerHTML = '<div class="portfolio-empty">No token balances found on The Grotto for this wallet yet. Swap something to get started.</div>';
  } else {
    rows.sort((a,b)=> b.usd - a.usd);
    const maxUsd = Math.max(...rows.map(r=>r.usd), 0.0001);
    holdingsEl.innerHTML = rows.map(r=>{
      const t = TOKENS[r.key];
      const pct = total>0 ? (r.usd/total*100) : 0;
      return `<div class="holding-row">
        <img src="${iconFor(r.key)}" alt=""/>
        <div class="holding-info">
          <div class="holding-sym">${r.key}${t.lowLiq?' <span class="liq-flag" style="margin-left:4px;">⚠ thin</span>':''}</div>
          <div class="holding-sub">${fmtAdaptive(r.bal)} ${r.key} · ${pct.toFixed(1)}% of portfolio</div>
          <div class="holding-bar"><div class="fill" style="width:${Math.max(pct,1.5)}%;"></div></div>
        </div>
        <div class="holding-amounts">
          <div class="holding-bal">${fmtUsd(r.usd)}</div>
          <div class="holding-usd">@ ${fmtUsd(tokenUsd(r.key))}</div>
        </div>
        <div class="holding-actions">
          <button class="btn btn-primary btn-sm" onclick="quickSell('${r.key}')">Sell</button>
          <button class="btn btn-ghost btn-sm" onclick="openSendModal('${r.key}')">Send</button>
        </div>
      </div>`;
    }).join('');
  }

  renderTxHistory();
  loadOnchainHistory(true);
}

// ==================== QUICK SELL ====================
function quickSell(key){
  // Jump to the Swap page pre-loaded with this token ready to sell against
  // HERESY (or WHERESY, if the token being sold IS HERESY), full balance
  // pre-filled. User still reviews the quote and confirms the swap there —
  // this never fires a transaction on its own.
  fromKey = key;
  toKey = (key === 'HERESY') ? 'WHERESY' : 'HERESY';
  setPickerUI('from', fromKey);
  setPickerUI('to', toKey);
  updateRouteLine();
  updatePriceGrid();
  refreshBalances();
  updateSwapButtonLabel();
  showPage('swap');
  getBalance(key).then(bal=>{
    if(bal>0){
      document.getElementById('in-amount').value = bal;
      onAmountChange();
    }
  });
  toast(`Loaded ${key} → ${toKey}. Review and confirm the swap below.`,'info');
}

// ==================== SEND / TRANSFER ====================
let sendModalKey = null;
function openSendModal(key){
  if(!userAddress){ toast('Connect your wallet first','error'); return; }
  sendModalKey = key;
  document.getElementById('send-modal-sym').textContent = key;
  document.getElementById('send-recipient').value = '';
  document.getElementById('send-amount').value = '';
  document.getElementById('send-modal-status').className = 'tx-status';
  document.getElementById('send-max-label').textContent = '…';
  getBalance(key).then(bal=>{ document.getElementById('send-max-label').textContent = fmtAdaptive(bal); });
  document.getElementById('send-modal').classList.add('open');
}
function closeSendModal(){
  document.getElementById('send-modal').classList.remove('open');
  sendModalKey = null;
}
function fillSendMax(){
  const label = document.getElementById('send-max-label').textContent;
  if(label && label !== '…') document.getElementById('send-amount').value = label;
}
async function submitSend(){
  if(!sendModalKey || !userAddress) return;
  const key = sendModalKey;
  const t = TOKENS[key];
  const recipient = document.getElementById('send-recipient').value.trim();
  const amt = parseFloat(document.getElementById('send-amount').value || '0');
  if(!ethers.isAddress(recipient)){ toast('Enter a valid recipient address','error'); return; }
  if(!amt || amt<=0){ toast('Enter an amount','error'); return; }
  const btn = document.getElementById('send-modal-confirm');
  btn.disabled = true;
  try{
    setTxStatus('send-modal-status', `Sending ${key} (sign in wallet)…`, 'pending', true);
    const amountWei = ethers.parseUnits(amt.toString(), t.decimals);
    let tx;
    if(t.type === 'native'){
      tx = await signer.sendTransaction({ to: recipient, value: amountWei });
    } else {
      const erc20 = new ethers.Contract(t.address, ERC20_ABI, signer);
      tx = await erc20.transfer(recipient, amountWei);
    }
    setTxStatus('send-modal-status', 'Confirming on-chain…', 'pending', true);
    await tx.wait(1);
    setTxStatus('send-modal-status', '✅ Sent!', 'success');
    toast(`Sent ${fmtAdaptive(amt)} ${key} 🎉`, 'success');
    refreshBalances();
    refreshPortfolio();
    setTimeout(closeSendModal, 1200);
  }catch(e){
    setTxStatus('send-modal-status', '❌ '+friendlyError(e), 'error');
  }finally{
    btn.disabled = false;
  }
}

// ==================== ON-CHAIN ACTIVITY (Blockscout API) ====================
const BLOCKSCOUT_API_BASE = 'https://grottoexplorer.xyz/api/v2';
let onchainNextParams = null;
let onchainItems = [];
async function loadOnchainHistory(reset){
  const listEl = document.getElementById('pf-onchain-list');
  const moreBtn = document.getElementById('onchain-loadmore-btn');
  if(!userAddress){
    listEl.innerHTML = '<div class="portfolio-empty">Connect a wallet to load on-chain history.</div>';
    moreBtn.style.display = 'none';
    return;
  }
  if(reset){
    onchainItems = [];
    onchainNextParams = null;
    listEl.innerHTML = '<div class="portfolio-empty">Loading on-chain history…</div>';
  }
  let url = `${BLOCKSCOUT_API_BASE}/addresses/${userAddress}/transactions`;
  if(onchainNextParams){
    const qs = new URLSearchParams(onchainNextParams).toString();
    url += `?${qs}`;
  }
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('explorer API returned ' + res.status);
    const data = await res.json();
    const items = data.items || [];
    onchainItems = reset ? items : onchainItems.concat(items);
    onchainNextParams = data.next_page_params || null;
    renderOnchainHistory();
    moreBtn.style.display = onchainNextParams ? 'block' : 'none';
  }catch(e){
    console.warn('on-chain history load failed', e);
    if(onchainItems.length === 0){
      listEl.innerHTML = `<div class="portfolio-empty">Couldn't load on-chain history from the explorer right now. <span class="clear-link" onclick="loadOnchainHistory(true)">Try again</span>, or view it directly on <a class="addr-link" href="https://grottoexplorer.xyz/address/${userAddress}" target="_blank">grottoexplorer.xyz ↗</a>.</div>`;
    }
    moreBtn.style.display = 'none';
  }
}
function renderOnchainHistory(){
  const listEl = document.getElementById('pf-onchain-list');
  if(onchainItems.length === 0){
    listEl.innerHTML = '<div class="portfolio-empty">No on-chain transactions found for this address yet.</div>';
    return;
  }
  listEl.innerHTML = onchainItems.map(tx=>{
    const hash = tx.hash || '';
    const when = tx.timestamp ? new Date(tx.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const status = tx.status === 'ok' ? 'ok' : (tx.status === 'error' ? 'fail' : '');
    const statusLabel = tx.status === 'ok' ? 'Success' : (tx.status === 'error' ? 'Failed' : (tx.result || 'Pending'));
    const method = tx.method || (tx.tx_types && tx.tx_types[0]) || 'Transfer';
    const toAddr = tx.to && tx.to.hash ? tx.to.hash : (tx.to || '');
    const toLabel = tx.to && tx.to.is_contract ? (tx.to.name || 'Contract') : 'Address';
    const valueEth = tx.value ? (parseFloat(tx.value)/1e18) : 0;
    return `<div class="tx-row">
      <div class="tx-icons"><img src="${iconFor('HERESY')}" alt=""/></div>
      <div class="tx-info">
        <div class="tx-title">${method}${toAddr?` → ${toLabel} ${toAddr.slice(0,6)}…${toAddr.slice(-4)}`:''}</div>
        <div class="tx-sub">${when}${valueEth>0?` · ${fmtAdaptive(valueEth)} HERESY`:''}</div>
      </div>
      <div class="tx-right">
        <span class="tx-badge tx-onchain-badge ${status}">${statusLabel}</span><br/>
        <a class="tx-link" href="https://grottoexplorer.xyz/tx/${hash}" target="_blank">${hash.slice(0,8)}… ↗</a>
      </div>
    </div>`;
  }).join('');
}
function renderTxHistory(){
  const listEl = document.getElementById('pf-tx-list');
  if(!userAddress){ listEl.innerHTML=''; return; }
  const history = loadTxHistory();
  if(history.length === 0){
    listEl.innerHTML = '<div class="portfolio-empty">No swaps or bridges made through HERESY DEX yet in this browser. Once you transact, they\'ll show up here with full details.</div>';
    return;
  }
  listEl.innerHTML = history.map(tx=>{
    const when = new Date(tx.t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const explorerBase = tx.chain === 'avax-warp' ? GROTTO_EXPLORER : GROTTO_EXPLORER;
    const explorerUrl = `${explorerBase}/tx/${tx.hash}`;
    if(tx.type === 'swap'){
      return `<div class="tx-row">
        <div class="tx-icons"><img src="${iconFor(tx.from)}" alt=""/><img src="${iconFor(tx.to)}" alt=""/></div>
        <div class="tx-info">
          <div class="tx-title">${fmtAdaptive(tx.amountIn)} ${tx.from} → ${fmtAdaptive(tx.amountOut)} ${tx.to}</div>
          <div class="tx-sub">${when}</div>
        </div>
        <div class="tx-right">
          <span class="tx-badge swap">Swap</span><br/>
          <a class="tx-link" href="${explorerUrl}" target="_blank">${tx.hash.slice(0,8)}… ↗</a>
        </div>
      </div>`;
    } else {
      return `<div class="tx-row">
        <div class="tx-icons"><img src="${iconFor('BOB')}" alt=""/></div>
        <div class="tx-info">
          <div class="tx-title">Bridged ${fmtAdaptive(tx.amountIn)} BOB → Avalanche</div>
          <div class="tx-sub">${when} · to ${tx.recipient.slice(0,6)}…${tx.recipient.slice(-4)}</div>
        </div>
        <div class="tx-right">
          <span class="tx-badge bridge">Bridge</span><br/>
          <a class="tx-link" href="${explorerUrl}" target="_blank">${tx.hash.slice(0,8)}… ↗</a>
        </div>
      </div>`;
    }
  }).join('');
}

