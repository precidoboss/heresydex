// ==================== ICONS (generated for tokens without a hosted image) ====================
function generatedIcon(symbol){
  const colors=['#E8350A','#FF6B1A','#FF9500','#22C55E','#3B82F6','#A855F7','#EC4899'];
  let hash=0; for(let i=0;i<symbol.length;i++) hash = symbol.charCodeAt(i) + ((hash<<5)-hash);
  const color = colors[Math.abs(hash)%colors.length];
  const letters = symbol.slice(0,2).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='${color}'/><text x='20' y='26' font-family='Barlow,sans-serif' font-size='16' font-weight='800' fill='#0A0A0A' text-anchor='middle'>${letters}</text></svg>`;
  return 'data:image/svg+xml,'+encodeURIComponent(svg);
}
function iconFor(key){
  const t = TOKENS[key];
  if(t.icon) return t.icon;
  if(iconCache[key]) return iconCache[key];
  return (iconCache[key] = generatedIcon(t.symbol));
}

