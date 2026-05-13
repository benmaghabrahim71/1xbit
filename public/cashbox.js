function formatCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function showCashboxStatus(message, type) {
  const statusEl = document.getElementById('cashbox-status');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = `cashbox-status is-visible ${type === 'success' ? 'is-success' : 'is-error'}`;
}

function updateStoredBalance(balance) {
  const numericBalance = Number(balance || 0);
  const sidebarBalance = document.getElementById('sidebar-balance-amount');
  const cashboxBalance = document.getElementById('cashbox-balance');
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const updatedUser = { ...storedUser, balance: numericBalance.toFixed(2) };

  localStorage.setItem('user', JSON.stringify(updatedUser));
  if (sidebarBalance) sidebarBalance.textContent = `${formatCurrency(numericBalance)} USD`;
  if (cashboxBalance) cashboxBalance.textContent = formatCurrency(numericBalance);
}

function renderRedemptionHistory(redemptions) {
  const tbody = document.getElementById('cashbox-history-body');
  const totalCredits = redemptions.reduce((sum, redemption) => sum + Number(redemption.amount || 0), 0);

  document.getElementById('cashbox-total-credits').textContent = formatCurrency(totalCredits);
  document.getElementById('cashbox-redeemed-count').textContent = String(redemptions.length);

  if (!redemptions.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--muted);">No voucher redemptions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = redemptions.map((redemption) => `
    <tr>
      <td class="cashbox-code">${redemption.code}</td>
      <td class="cashbox-amount">${formatCurrency(redemption.amount)}</td>
      <td>${new Date(redemption.redeemed_at).toLocaleString()}</td>
      <td>${redemption.transaction_id ? `#${redemption.transaction_id}` : 'Pending'}</td>
    </tr>
  `).join('');
}

async function fetchCashboxData() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    window.location.href = 'my-account.html';
    return;
  }

  const response = await fetch('/api/user/cashbox', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logout();
      return;
    }
    throw new Error('Failed to load cashbox data');
  }

  const data = await response.json();
  updateStoredBalance(data.user?.balance || 0);
  renderRedemptionHistory(data.redemptions || []);
}

async function redeemVoucher(event) {
  event.preventDefault();

  const token = localStorage.getItem('authToken');
  if (!token) {
    window.location.href = 'my-account.html';
    return;
  }

  const form = event.currentTarget;
  const button = document.getElementById('redeem-button');
  const input = document.getElementById('voucher-code');
  const code = String(input.value || '').trim().toUpperCase();

  if (!code) {
    showCashboxStatus('Please enter a voucher code.', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = 'Redeeming...';

  try {
    const response = await fetch('/api/user/vouchers/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ code })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Voucher redemption failed');
    }

    updateStoredBalance(data.balance || 0);
    showCashboxStatus(`Voucher ${data.voucher.code} redeemed successfully. ${formatCurrency(data.voucher.amount)} was added to your balance.`, 'success');
    form.reset();
    await fetchCashboxData();
  } catch (err) {
    showCashboxStatus(err.message || 'Voucher redemption failed.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Redeem Voucher';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetchCashboxData();
  } catch (err) {
    console.error('Cashbox error:', err);
    showCashboxStatus('Unable to load cashbox details right now. Please try again shortly.', 'error');
    document.getElementById('cashbox-history-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444;">Failed to load voucher history.</td></tr>';
  }

  const form = document.getElementById('cashbox-form');
  if (form) {
    form.addEventListener('submit', redeemVoucher);
  }
});
