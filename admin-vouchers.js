let adminVoucherToken = localStorage.getItem('adminToken') || localStorage.getItem('authToken');

function formatMoney(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function showPageStatus(message, type = 'success') {
  const banner = document.getElementById('page-status');
  banner.textContent = message;
  banner.className = `status-banner visible ${type}`;
}

function closeModal() {
  const modalOverlay = document.getElementById('modal-overlay');
  modalOverlay.style.display = 'none';
  modalOverlay.innerHTML = '';
}

async function adminVoucherFetch(url, options = {}) {
  adminVoucherToken = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
  if (!adminVoucherToken) {
    window.location.href = 'my-account.html';
    throw new Error('Unauthorized');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminVoucherToken}`,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('adminToken');
      throw new Error(data.error || 'Unauthorized');
    }
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

async function verifyAdminAccess() {
  const data = await adminVoucherFetch('/api/auth/me');
  const role = data.user?.role;
  if (role !== 'admin' && role !== 'super_admin') {
    throw new Error('Admin access required');
  }
}

function renderStats(stats) {
  document.getElementById('stat-total-vouchers').textContent = String(stats.total_vouchers || 0);
  document.getElementById('stat-active-vouchers').textContent = String(stats.active_vouchers || 0);
  document.getElementById('stat-expired-vouchers').textContent = String(stats.expired_vouchers || 0);
  document.getElementById('stat-total-redemptions').textContent = String(stats.total_redemptions || 0);
  document.getElementById('stat-utilization-rate').textContent = `${Number(stats.utilization_rate || 0).toFixed(2)}%`;
  document.getElementById('stat-redeemed-value').textContent = formatMoney(stats.redeemed_value || 0);
}

function getVoucherState(voucher) {
  if (!voucher.is_active) return { text: 'Inactive', className: 'badge badge-paused' };
  if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) return { text: 'Expired', className: 'badge badge-warning' };
  if (Number(voucher.redeemed_count || 0) >= Number(voucher.max_redemptions || 0)) return { text: 'Exhausted', className: 'badge badge-warning' };
  return { text: 'Active', className: 'badge badge-active' };
}

function renderVoucherTable(vouchers) {
  const tbody = document.getElementById('voucher-table-body');
  if (!vouchers.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;">No vouchers have been created yet.</td></tr>';
    return;
  }

  tbody.innerHTML = vouchers.map((voucher) => {
    const state = getVoucherState(voucher);
    const usage = `${voucher.redeemed_count}/${voucher.max_redemptions}`;
    const remaining = Math.max(0, Number(voucher.max_redemptions || 0) - Number(voucher.redeemed_count || 0));
    const expiry = voucher.expires_at ? new Date(voucher.expires_at).toLocaleString() : 'No expiry';
    const canToggle = !(voucher.expires_at && new Date(voucher.expires_at) < new Date());

    return `
      <tr>
        <td>
          <div class="code">${voucher.code}</div>
          <div class="muted">Created ${new Date(voucher.created_at).toLocaleDateString()}</div>
        </td>
        <td>
          <div style="font-weight:800;">${formatMoney(voucher.amount)}</div>
          <div class="muted">${voucher.created_by_username || 'System generated'}</div>
        </td>
        <td>
          <div style="font-weight:800;">${usage}</div>
          <div class="muted">${remaining} remaining</div>
        </td>
        <td>${expiry}</td>
        <td>
          <div style="font-weight:800;">${formatMoney(voucher.redeemed_value || 0)}</div>
          <div class="muted">${voucher.unique_users || 0} unique users</div>
        </td>
        <td><span class="${state.className}">${state.text}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn" onclick="openVoucherLogModal(${voucher.id})">Usage Log</button>
            ${canToggle ? `<button class="btn" onclick="toggleVoucherState(${voucher.id}, ${voucher.is_active ? 'false' : 'true'})">${voucher.is_active ? 'Deactivate' : 'Activate'}</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadVoucherDashboard() {
  const [statsData, vouchersData] = await Promise.all([
    adminVoucherFetch('/api/admin/vouchers/stats'),
    adminVoucherFetch('/api/admin/vouchers')
  ]);

  renderStats(statsData.stats || {});
  renderVoucherTable(vouchersData.vouchers || []);
}

function openCreateVoucherModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;">Create Voucher Batch</h2>
          <div class="muted">Create a single code or a bulk batch with shared settings.</div>
        </div>
        <button class="btn" onclick="closeModal()">Close</button>
      </div>
      <form id="create-voucher-form">
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-field">
              <label for="voucher-code-input">Custom Code</label>
              <input id="voucher-code-input" name="code" type="text" maxlength="64" placeholder="Optional for single voucher" />
            </div>
            <div class="form-field">
              <label for="voucher-amount-input">Value</label>
              <input id="voucher-amount-input" name="amount" type="number" min="0.01" step="0.01" required />
            </div>
            <div class="form-field">
              <label for="voucher-max-redemptions">Max Uses</label>
              <input id="voucher-max-redemptions" name="max_redemptions" type="number" min="1" step="1" value="1" required />
            </div>
            <div class="form-field">
              <label for="voucher-expiration">Expiration</label>
              <input id="voucher-expiration" name="expires_at" type="datetime-local" />
            </div>
            <div class="form-field">
              <label for="voucher-quantity">Bulk Quantity</label>
              <input id="voucher-quantity" name="quantity" type="number" min="1" max="250" value="1" required />
            </div>
            <div class="form-field">
              <label for="voucher-prefix">Auto Prefix</label>
              <input id="voucher-prefix" name="prefix" type="text" maxlength="12" value="H1T" />
            </div>
            <div class="form-field">
              <label for="voucher-length">Code Length</label>
              <input id="voucher-length" name="code_length" type="number" min="4" max="16" value="8" required />
            </div>
          </div>
          <div class="form-field">
            <label for="voucher-notes">Notes</label>
            <textarea id="voucher-notes" name="notes" placeholder="Campaign source, team owner, or audit notes"></textarea>
          </div>
          <div id="voucher-create-result" class="muted"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  `;
  lucide.createIcons();

  document.getElementById('create-voucher-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
    const resultBox = document.getElementById('voucher-create-result');
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const response = await adminVoucherFetch('/api/admin/vouchers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      resultBox.innerHTML = `<strong>${response.vouchers.length}</strong> voucher(s) created.<br>${response.vouchers.map((voucher) => voucher.code).join('<br>')}`;
      showPageStatus(response.message || 'Vouchers created successfully.');
      await loadVoucherDashboard();
    } catch (err) {
      resultBox.textContent = err.message || 'Failed to create vouchers.';
      showPageStatus(err.message || 'Failed to create vouchers.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create';
    }
  });
}

async function toggleVoucherState(voucherId, nextState) {
  try {
    await adminVoucherFetch(`/api/admin/vouchers/${voucherId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: nextState })
    });
    showPageStatus(`Voucher ${nextState ? 'activated' : 'deactivated'} successfully.`);
    await loadVoucherDashboard();
  } catch (err) {
    showPageStatus(err.message || 'Failed to update voucher.', 'error');
  }
}

async function openVoucherLogModal(voucherId) {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;">Voucher Usage Log</h2>
          <div class="muted">Loading redemption activity...</div>
        </div>
        <button class="btn" onclick="closeModal()">Close</button>
      </div>
      <div class="modal-body" id="voucher-log-body">
        <div class="muted">Loading redemption log...</div>
      </div>
    </div>
  `;

  try {
    const data = await adminVoucherFetch(`/api/admin/vouchers/${voucherId}/redemptions`);
    const voucher = data.voucher;
    const redemptions = data.redemptions || [];
    document.getElementById('voucher-log-body').innerHTML = `
      <div style="display:grid; gap:0.45rem;">
        <div><strong>Code:</strong> <span class="code">${voucher.code}</span></div>
        <div><strong>Value:</strong> ${formatMoney(voucher.amount)}</div>
        <div><strong>Usage:</strong> ${voucher.redeemed_count}/${voucher.max_redemptions}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Amount</th>
              <th>Redeemed At</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            ${redemptions.length ? redemptions.map((redemption) => `
              <tr>
                <td>${redemption.username}</td>
                <td>${redemption.email}</td>
                <td>${formatMoney(redemption.amount)}</td>
                <td>${new Date(redemption.redeemed_at).toLocaleString()}</td>
                <td>${redemption.transaction_id ? `#${redemption.transaction_id}` : 'N/A'}</td>
              </tr>
            `).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;">No redemptions recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('voucher-log-body').innerHTML = `<div class="status-banner visible error">${err.message || 'Failed to load usage log.'}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await verifyAdminAccess();
    await loadVoucherDashboard();
  } catch (err) {
    document.body.innerHTML = '';
    document.body.style.background = '#fff';
    return;
  }

  document.getElementById('open-create-modal').addEventListener('click', openCreateVoucherModal);
  document.getElementById('refresh-vouchers').addEventListener('click', async () => {
    try {
      await loadVoucherDashboard();
      showPageStatus('Voucher dashboard refreshed.');
    } catch (err) {
      showPageStatus(err.message || 'Failed to refresh vouchers.', 'error');
    }
  });

  document.getElementById('modal-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'modal-overlay') {
      closeModal();
    }
  });

  lucide.createIcons();
});

window.closeModal = closeModal;
window.toggleVoucherState = toggleVoucherState;
window.openVoucherLogModal = openVoucherLogModal;
