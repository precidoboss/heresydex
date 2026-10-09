// Docs page behaviour: dynamic tables from config.js, scrollspy, search, copy buttons.
(function(){
  // ---- token table (single source of truth: config.js) ----
  const tb = document.getElementById('docs-token-body');
  if(tb){
    tb.innerHTML = Object.keys(TOKENS).map(key=>{
      const t = TOKENS[key];
      const addr = t.type==='native' ? '<span style="color:var(--faint)">native (gas token)</span>' : `<a href="${GROTTO_ADDR_URL}${t.address}" target="_blank" rel="noopener"><code>${t.address.slice(0,6)}…${t.address.slice(-4)}</code></a>`;
      const pool = t.pool ? `<a href="${GROTTO_ADDR_URL}${t.pool}" target="_blank" rel="noopener"><code>${t.pool.slice(0,6)}…${t.pool.slice(-4)}</code></a>` : '<span style="color:var(--faint)">—</span>';
      const bridge = BRIDGEABLE_KEYS.includes(key) ? '✓ direct' : (t.pool ? 'via swap' : '—');
      return `<tr><td><img src="${iconFor(key)}" alt=""/><b>${key}</b>${t.lowLiq?' <span class="liq-flag">thin</span>':''}</td><td>${t.type}</td><td>${t.decimals}</td><td>${addr}</td><td>${pool}</td><td>${bridge}</td></tr>`;
    }).join('');
  }
  const cl = document.getElementById('docs-contracts');
  renderContractList(cl, true);

  // ---- copy buttons on code blocks ----
  document.querySelectorAll('pre').forEach(pre=>{
    const b = document.createElement('button');
    b.className = 'copy-btn'; b.textContent = 'Copy';
    b.onclick = ()=>{
      navigator.clipboard.writeText(pre.innerText.replace(/^Copy\n?/,'')).then(()=>{ b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1400); });
    };
    pre.appendChild(b);
  });

  // ---- scrollspy ----
  const links = Array.from(document.querySelectorAll('.toc a'));
  const sections = links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        links.forEach(a=>a.classList.toggle('active', a.getAttribute('href')==='#'+e.target.id));
      }
    });
  },{ rootMargin:'-90px 0px -65% 0px' });
  sections.forEach(s=>io.observe(s));

  // ---- sidebar search (filters TOC by title + section text) ----
  const search = document.getElementById('docs-search');
  if(search){
    search.addEventListener('input', ()=>{
      const q = search.value.trim().toLowerCase();
      links.forEach(a=>{
        const sec = document.querySelector(a.getAttribute('href'));
        const hay = ((a.textContent||'') + ' ' + (sec ? sec.innerText : '')).toLowerCase();
        a.classList.toggle('hidden', !!q && !hay.includes(q));
      });
      document.querySelectorAll('.toc-group').forEach(g=>{
        let n = g.nextElementSibling, any = false;
        while(n && !n.classList.contains('toc-group')){ if(!n.classList.contains('hidden')) any = true; n = n.nextElementSibling; }
        g.style.display = any || !q ? '' : 'none';
      });
    });
  }
  // mobile TOC
  const tt = document.getElementById('toc-toggle'), side = document.getElementById('docs-side');
  if(tt) tt.onclick = ()=> side.classList.toggle('open');
  links.forEach(a=>a.addEventListener('click',()=>side.classList.remove('open')));
  window.addEventListener('scroll', ()=>{
    const nav = document.querySelector('nav.topnav'); if(nav) nav.classList.toggle('scrolled', window.scrollY>8);
  },{passive:true});
})();
