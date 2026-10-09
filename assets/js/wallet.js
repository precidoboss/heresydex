// ==================== WALLET (EIP-6963 multi-wallet) ====================
// Discovers every injected wallet via EIP-6963 so users with Core + MetaMask
// (or any other combination) can choose one instead of whichever extension
// happened to win the window.ethereum race. Falls back to window.ethereum.
const discoveredWallets = new Map();   // uuid -> { info, provider }
let walletProvider = null;             // the EIP-1193 provider currently in use
let walletInfo = null;

window.addEventListener('eip6963:announceProvider', (ev)=>{
  const d = ev.detail;
  if(!d || !d.info || !d.provider) return;
  discoveredWallets.set(d.info.uuid, d);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

function availableWallets(){
  const list = Array.from(discoveredWallets.values());
  if(list.length === 0 && window.ethereum){
    list.push({ info:{ uuid:'legacy', name:'Browser wallet', icon:'' }, provider: window.ethereum });
  }
  return list;
}

async function connectWallet(){
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const wallets = availableWallets();
  if(wallets.length === 0){ openWalletModal(); return; }
  if(wallets.length === 1){ return connectWith(wallets[0]); }
  openWalletModal();
}

function openWalletModal(){
  const wallets = availableWallets();
  const list = document.getElementById('wallet-list');
  if(wallets.length === 0){
    list.innerHTML = `<div class="portfolio-empty">No browser wallet detected.<br/>Install <a class="addr-link" href="https://core.app" target="_blank" rel="noopener">Core</a> or <a class="addr-link" href="https://metamask.io" target="_blank" rel="noopener">MetaMask</a>, then reload this page.</div>`;
  } else {
    list.innerHTML = '';
    wallets.forEach(w=>{
      const b = document.createElement('button');
      b.className = 'wallet-option';
      const icon = w.info.icon ? `<img src="${w.info.icon}" alt=""/>` : '<span class="wallet-ph">👛</span>';
      b.innerHTML = `${icon}<span>${w.info.name}</span><span class="wallet-go">→</span>`;
      b.onclick = ()=>{ closeWalletModal(); connectWith(w); };
      list.appendChild(b);
    });
  }
  document.getElementById('wallet-modal').classList.add('open');
}
function closeWalletModal(){ document.getElementById('wallet-modal').classList.remove('open'); }

async function connectWith(w){
  try{
    walletProvider = w.provider;
    walletInfo = w.info;
    provider = new ethers.BrowserProvider(walletProvider);
    await provider.send('eth_requestAccounts',[]);
    await switchToGrotto();
    provider = new ethers.BrowserProvider(walletProvider);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    onWalletConnected();
    bindWalletEvents();
    toast('Wallet connected','success');
  }catch(e){ toast(friendlyError(e),'error'); }
}

function onWalletConnected(){
  const short = userAddress.slice(0,6)+'…'+userAddress.slice(-4);
  const addr = document.getElementById('nav-addr');
  addr.style.display = 'inline-flex';
  addr.textContent = short;
  addr.title = 'Click to disconnect';
  const btn = document.getElementById('btn-connect');
  btn.style.display = 'none';
  const bb = document.getElementById('btn-bridge');
  if(bb) bb.textContent = 'Bridge $BOB';
  refreshBalances();
  updateSwapButtonLabel();
  refreshPortfolio();
  refreshSbBalance();
  updateSwapBridgeButtonLabel();
}

function disconnectWallet(){
  provider = null; signer = null; userAddress = null; walletProvider = null;
  document.getElementById('nav-addr').style.display = 'none';
  document.getElementById('btn-connect').style.display = '';
  document.getElementById('btn-connect').textContent = 'Connect Wallet';
  document.getElementById('btn-connect').disabled = false;
  refreshBalances(); updateSwapButtonLabel(); refreshPortfolio();
  refreshSbBalance(); updateSwapBridgeButtonLabel();
  toast('Disconnected (this only clears the session in this tab)','info');
}

let walletEventsBound = false;
function bindWalletEvents(){
  if(walletEventsBound || !walletProvider || !walletProvider.on) return;
  walletEventsBound = true;
  walletProvider.on('accountsChanged', async (accs)=>{
    if(!accs || accs.length === 0){ disconnectWallet(); return; }
    try{
      provider = new ethers.BrowserProvider(walletProvider);
      signer = await provider.getSigner();
      userAddress = await signer.getAddress();
      onWalletConnected();
    }catch(e){ console.warn(e); }
  });
  walletProvider.on('chainChanged', ()=>{
    // ethers v6 BrowserProvider caches the network — rebuild it
    if(userAddress){
      provider = new ethers.BrowserProvider(walletProvider);
      provider.getSigner().then(s=>{ signer = s; }).catch(()=>{});
    }
  });
}

async function switchToGrotto(){
  try{
    await walletProvider.request({method:'wallet_switchEthereumChain',params:[{chainId:GROTTO_CHAIN_ID_HEX}]});
  }catch(switchError){
    if(switchError.code===4902 || /unrecognized chain/i.test(switchError.message||'')){
      await walletProvider.request({
        method:'wallet_addEthereumChain',
        params:[{
          chainId:GROTTO_CHAIN_ID_HEX,
          chainName:'The Grotto',
          nativeCurrency:{name:'Heresy',symbol:'heresy',decimals:18},
          rpcUrls:[GROTTO_RPC],
          blockExplorerUrls:[GROTTO_EXPLORER]
        }]
      });
    } else { throw switchError; }
  }
}

async function addTokenToWallet(){
  if(!walletProvider){ toast('Connect a wallet first.','error'); return; }
  try{
    await walletProvider.request({
      method:'wallet_watchAsset',
      params:{type:'ERC20',options:{address:BOB_REMOTE_AVAX,symbol:'BOB',decimals:18}}
    });
  }catch(e){ toast(friendlyError(e),'error'); }
}
