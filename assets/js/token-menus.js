// ==================== TOKEN PICKER ====================
function buildTokenMenu(side){
  const menu = document.getElementById(side+'-menu');
  menu.innerHTML = '';
  Object.keys(TOKENS).forEach(key=>{
    const t = TOKENS[key];
    const item = document.createElement('div');
    item.className = 'token-menu-item';
    item.innerHTML = `<img src="${iconFor(key)}" alt=""/><span>${key}</span>${t.lowLiq?'<span class="liq-flag">⚠ thin</span>':''}`;
    item.onclick = (ev)=>{ ev.stopPropagation(); selectToken(side, key); closeAllMenus(); };
    menu.appendChild(item);
  });
}
function toggleTokenMenu(side){
  event.stopPropagation();
  const isOpen = document.getElementById(side+'-menu').classList.contains('open');
  closeAllMenus();
  if(!isOpen) document.getElementById(side+'-menu').classList.add('open');
}
function closeAllMenus(){
  document.getElementById('from-menu').classList.remove('open');
  document.getElementById('to-menu').classList.remove('open');
  const sbMenu = document.getElementById('sb-from-menu');
  if(sbMenu) sbMenu.classList.remove('open');
  const sbFinalMenu = document.getElementById('sb-final-menu');
  if(sbFinalMenu) sbFinalMenu.classList.remove('open');
}
document.addEventListener('click', closeAllMenus);
function selectToken(side, key){
  if(side==='from'){
    if(key===toKey){ toKey = fromKey; setPickerUI('to', toKey); }
    fromKey = key;
    setPickerUI('from', fromKey);
  } else {
    if(key===fromKey){ fromKey = toKey; setPickerUI('from', fromKey); }
    toKey = key;
    setPickerUI('to', toKey);
  }
  updateRouteLine();
  updatePriceGrid();
  updateEstimate();
  refreshBalances();
  updateSwapButtonLabel();
}
function setPickerUI(side, key){
  document.getElementById(side+'-picker-label').textContent = key;
  document.getElementById(side+'-picker-icon').src = iconFor(key);
}

