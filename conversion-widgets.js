(() => {
  const monthlySpendInput = document.getElementById('roi-current-spend');
  const incidentsInput = document.getElementById('roi-incidents');
  const hoursInput = document.getElementById('roi-hours');
  const savingsNode = document.getElementById('roi-savings');
  const uptimeNode = document.getElementById('roi-uptime');
  const payoffNode = document.getElementById('roi-payoff');

  if (!monthlySpendInput || !incidentsInput || !hoursInput || !savingsNode || !uptimeNode || !payoffNode) {
    return;
  }

  const formatCurrency = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

  function updateRoi() {
    const monthlySpend = Number(monthlySpendInput.value || 0);
    const incidents = Number(incidentsInput.value || 0);
    const hours = Number(hoursInput.value || 0);

    const operationalLoss = incidents * 45 + hours * 30;
    const estimatedSavings = Math.max(0, Math.round(monthlySpend * 0.18 + operationalLoss));
    const uptimeGain = Math.min(99.99, 99.2 + incidents * 0.08 + hours * 0.04);
    const payoffMonths = estimatedSavings > 0 ? Math.max(1, Math.round((monthlySpend * 2) / estimatedSavings)) : 1;

    savingsNode.textContent = formatCurrency(estimatedSavings);
    uptimeNode.textContent = `${uptimeGain.toFixed(2)}%`;
    payoffNode.textContent = `${payoffMonths} mo`;
  }

  [monthlySpendInput, incidentsInput, hoursInput].forEach((input) => {
    input.addEventListener('input', updateRoi);
  });

  updateRoi();
})();
