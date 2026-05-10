const fs = require('fs');
['vps-extreme.html','vps-budget.html','rdp-extreme.html','rdp-budget.html'].forEach(f => {
  let p = './plans/' + f;
  let t = f.includes('extreme') ? 'Extreme' : 'Budget';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('class="tier-grid dynamic-plans" data-plan-type="', 'class="tier-grid dynamic-plans" data-plan-tier="' + t + '" data-plan-type="');
  fs.writeFileSync(p, c);
});
console.log("Done");
