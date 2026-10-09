// ==================== INIT ====================
function showPage(p){
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active', el.dataset.page===p));
  document.getElementById('page-'+p).classList.add('active');
  if(location.hash.replace('#','') !== p) history.replaceState(null,'','#'+p);
  window.scrollTo({ top:0, behavior:'smooth' });
  if(p==='bridge'){ refreshBridgeBalances(); refreshSbBalance(); updateSwapBridgeButtonLabel(); }
  if(p==='portfolio') refreshPortfolio();
}

initEmbers();
renderContractList(document.getElementById('contract-list'), false);
buildTokenMenu('from');
buildTokenMenu('to');
setPickerUI('from', fromKey);
setPickerUI('to', toKey);
updateRouteLine();
buildSbTokenMenu();
setPickerUI('sb-from', sbFromKey);
updateSbViaVisibility();
updateSbRouteLine();
resetSbFinalToken();
loadPriceHistory();
loadHist();
buildChartTabs();
renderChart();
renderMarkets();
refreshPrices();
setInterval(refreshPrices, 20000);
backfillHistory();
setInterval(backfillHistory, 10 * 60 * 1000); // top up with new Sync events every 10 min

document.getElementById('nav-addr').addEventListener('click', ()=>{ if(userAddress && confirm('Disconnect this wallet from HERESY DEX?')) disconnectWallet(); });
const initialPage = (location.hash||'').replace('#','');
if(['swap','bridge','portfolio'].includes(initialPage)) showPage(initialPage);
