const fs = require('fs');
const path = require('path');
const dir = './plans';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(f => {
  const fp = path.join(dir, f);
  if (f === 'index.html') return; // skip index
  
  let content = fs.readFileSync(fp, 'utf8');
  
  const typeMap = {
    'rdp-budget.html': 'RDP',
    'rdp-extreme.html': 'RDP',
    'vps-budget.html': 'VPS',
    'vps-extreme.html': 'VPS',
    'samp.html': 'GAME',
    'mta.html': 'GAME',
    'minecraft.html': 'GAME',
    'dedicated.html': 'DEDICATED'
  };
  
  const gameMap = {
    'samp.html': 'SA-MP',
    'mta.html': 'MTA:SA',
    'minecraft.html': 'Minecraft'
  };
  
  const pType = typeMap[f] || 'VPS';
  const gType = gameMap[f] ? ` data-plan-game="${gameMap[f]}"` : '';
  
  // Replace from <p class="page-disclaimer"> down to the end of the tier-grid
  content = content.replace(/<p class="page-disclaimer">[\s\S]*?<div class="tier-grid">[\s\S]*?<\/div>\s*<\/div>/, `<div class="tier-grid dynamic-plans" data-plan-type="${pType}"${gType}>\n        <div style="grid-column: 1 / -1; text-align:center; padding: 3rem;">\n          <div class="loader"></div>\n          <p style="margin-top: 1rem; color: #fff;">Loading dynamic plans...</p>\n        </div>\n      </div>\n    </div>`);
  
  fs.writeFileSync(fp, content);
});

console.log('Replaced successfully');
