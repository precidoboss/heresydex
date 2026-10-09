// ==================== BACKGROUND FX + SMALL UI HELPERS ====================
function initEmbers(){
  const layer = document.getElementById('ember-layer');
  if(!layer) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const n = window.innerWidth < 640 ? 10 : 22;
  for(let i=0;i<n;i++){
    const e = document.createElement('div');
    e.className = 'ember';
    const size = 2 + Math.random()*6;
    const dur = 10 + Math.random()*12;
    e.style.width = size+'px';
    e.style.height = size+'px';
    e.style.left = (Math.random()*100)+'%';
    e.style.setProperty('--drift', (Math.random()*140-70).toFixed(0)+'px');
    e.style.animationDuration = dur+'s';
    e.style.animationDelay = '-'+(Math.random()*dur)+'s';
    layer.appendChild(e);
  }
}

// smooth number tween for hero stats
function tweenText(el, text){
  if(!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// nav gains a shadow once the page scrolls
window.addEventListener('scroll', ()=>{
  const nav = document.querySelector('nav.topnav');
  if(nav) nav.classList.toggle('scrolled', window.scrollY > 8);
}, { passive:true });

// press Esc to close any open modal / menu
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'));
  if(typeof closeAllMenus === 'function') closeAllMenus();
});
document.addEventListener('click', (e)=>{
  if(e.target.classList && e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});
