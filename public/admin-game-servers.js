let adminGameToken = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
let gameServersCache = [];
let nodeCache = [];
let nestCache = [];
let activeLogSocket = null;

function showStatus(message, type = 'success') {
  const banner = document.getElementById('status-banner');
  banner.textContent = message;
  banner.className = `status-banner visible ${type}`;
}

function closeModal() {
  if (activeLogSocket) {
    activeLogSocket.close();
    activeLogSocket = null;
  }
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'none';
  overlay.innerHTML = '';
}

async function adminFetch(url, options = {}) {
  adminGameToken = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminGameToken}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.pterodactyl?.message || 'Request failed');
  }
  return data;
}

function statusBadge(status) {
  if (status === 'active') return '<span class="badge badge-active">Active</span>';
  if (status === 'suspended') return '<span class="badge badge-danger">Suspended</span>';
  return '<span class="badge badge-warning">Pending</span>';
}

function selectedIdentifiers() {
  return Array.from(document.querySelectorAll('.server-select:checked')).map((checkbox) => checkbox.dataset.identifier);
}

function selectedServerIds() {
  return Array.from(document.querySelectorAll('.server-select:checked')).map((checkbox) => Number(checkbox.dataset.serverId));
}

function renderStats(enabled, servers) {
  const active = servers.filter((server) => server.status === 'active').length;
  const pending = servers.length - active;
  document.getElementById('stat-enabled').textContent = enabled ? 'On' : 'Off';
  document.getElementById('stat-total').textContent = String(servers.length);
  document.getElementById('stat-active').textContent = String(active);
  document.getElementById('stat-pending').textContent = String(pending);
}

function renderServers(servers) {
  const tbody = document.getElementById('servers-body');
  gameServersCache = servers;

  if (!servers.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;">No game servers found.</td></tr>';
    return;
  }

  tbody.innerHTML = servers.map((server) => `
    <tr>
      <td><input class="server-select" type="checkbox" data-identifier="${server.identifier}" data-server-id="${server.id}" /></td>
      <td>
        <div class="mono">#${server.id}</div>
        <div class="muted">${server.uuid}</div>
      </td>
      <td>
        <div style="font-weight:800;">${server.name}</div>
        <div class="muted mono">${server.identifier}</div>
      </td>
      <td>${server.node || 'Unknown'}</td>
      <td>${server.egg || 'Unknown'}</td>
      <td>
        <div>${server.owner || 'Unknown'}</div>
        <div class="muted">User ID: ${server.linked_user_id || 'N/A'}</div>
      </td>
      <td>${statusBadge(server.status)}</td>
      <td>
        <div class="row-actions">
          <button class="btn" onclick="sendPowerAction('${server.identifier}', 'start')">Start</button>
          <button class="btn" onclick="sendPowerAction('${server.identifier}', 'stop')">Stop</button>
          <button class="btn" onclick="sendPowerAction('${server.identifier}', 'restart')">Restart</button>
          <button class="btn" onclick="openLogsModal('${server.identifier}', '${server.name.replace(/'/g, "\\'")}')">Logs</button>
          ${server.linked_user_id ? `<button class="btn" onclick="resetPanelPassword(${server.linked_user_id})">Reset Password</button>` : ''}
          <button class="btn btn-danger" onclick="deleteServer(${server.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadDashboard() {
  const [configData, serversData, nestsData, nodesData] = await Promise.all([
    adminFetch('/api/admin/game-servers/config'),
    adminFetch('/api/admin/game-servers/servers'),
    adminFetch('/api/admin/game-servers/nests'),
    adminFetch('/api/admin/game-servers/nodes')
  ]);

  nestCache = nestsData.nests || [];
  nodeCache = nodesData.nodes || [];
  renderStats(configData.enabled, serversData.servers || []);
  renderServers(serversData.servers || []);
}

async function sendPowerAction(identifier, signal) {
  try {
    await adminFetch(`/api/admin/game-servers/servers/${identifier}/power`, {
      method: 'POST',
      body: JSON.stringify({ signal })
    });
    showStatus(`Power signal ${signal} sent to ${identifier}.`);
    await loadDashboard();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function deleteServer(serverId) {
  if (!window.confirm(`Delete server #${serverId}? This cannot be undone.`)) return;
  try {
    await adminFetch(`/api/admin/game-servers/servers/${serverId}`, { method: 'DELETE' });
    showStatus(`Server #${serverId} deleted successfully.`);
    await loadDashboard();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function resetPanelPassword(localUserId) {
  if (!window.confirm(`Reset the linked Pterodactyl password for local user #${localUserId}?`)) return;
  try {
    await adminFetch(`/api/admin/game-servers/users/${localUserId}/reset-password`, { method: 'POST' });
    showStatus('A new panel password was generated and emailed to the user.');
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function runBulk(signalOrDelete) {
  if (signalOrDelete === 'delete') {
    const serverIds = selectedServerIds();
    if (!serverIds.length) {
      showStatus('Select at least one server first.', 'error');
      return;
    }
    if (!window.confirm(`Delete ${serverIds.length} selected server(s)?`)) return;
    try {
      await adminFetch('/api/admin/game-servers/servers/bulk/delete', {
        method: 'POST',
        body: JSON.stringify({ server_ids: serverIds })
      });
      showStatus(`Deleted ${serverIds.length} server(s).`);
      await loadDashboard();
    } catch (err) {
      showStatus(err.message, 'error');
    }
    return;
  }

  const identifiers = selectedIdentifiers();
  if (!identifiers.length) {
    showStatus('Select at least one server first.', 'error');
    return;
  }
  if (!window.confirm(`${signalOrDelete} ${identifiers.length} selected server(s)?`)) return;
  try {
    await adminFetch('/api/admin/game-servers/servers/bulk/power', {
      method: 'POST',
      body: JSON.stringify({ identifiers, signal: signalOrDelete })
    });
    showStatus(`Bulk ${signalOrDelete} completed for ${identifiers.length} server(s).`);
    await loadDashboard();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

function appendConsoleLine(message) {
  const consoleEl = document.getElementById('log-console');
  if (!consoleEl) return;
  consoleEl.textContent += `${message}\n`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function openLogsModal(identifier, name) {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;">Live Logs</h2>
          <div class="muted">${name} (${identifier})</div>
        </div>
        <button class="btn" onclick="closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div class="console" id="log-console">Connecting to websocket...</div>
      </div>
    </div>
  `;

  try {
    const payload = await adminFetch(`/api/admin/game-servers/servers/${identifier}/websocket`);
    const socketUrl = payload.data?.socket || payload.socket;
    const authToken = payload.data?.token || payload.token;

    if (!socketUrl || !authToken) {
      throw new Error('Websocket credentials are incomplete');
    }

    activeLogSocket = new WebSocket(socketUrl);
    activeLogSocket.addEventListener('open', () => {
      appendConsoleLine('[socket] connected');
      activeLogSocket.send(JSON.stringify({ event: 'auth', args: [authToken] }));
    });
    activeLogSocket.addEventListener('message', (event) => {
      appendConsoleLine(event.data);
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.event === 'auth success') {
          activeLogSocket.send(JSON.stringify({ event: 'send logs', args: [null] }));
        }
      } catch (_) {
        // Keep raw log frames visible
      }
    });
    activeLogSocket.addEventListener('close', () => appendConsoleLine('[socket] closed'));
    activeLogSocket.addEventListener('error', () => appendConsoleLine('[socket] error'));
  } catch (err) {
    document.getElementById('log-console').textContent = err.message;
  }
}

function buildNodeOptions() {
  return nodeCache.map((node) => {
    const attrs = node.attributes || {};
    const capacity = node.capacity || {};
    return `<option value="${attrs.id}">${attrs.name} | Free RAM: ${capacity.freeMemory || 0} MB | Free Disk: ${capacity.freeDisk || 0} MB</option>`;
  }).join('');
}

function buildNestOptions() {
  return nestCache.map((nest) => {
    const attrs = nest.attributes || {};
    return `<option value="${attrs.id}">${attrs.name}</option>`;
  }).join('');
}

async function loadEggOptions(nestId, targetSelectId) {
  const data = await adminFetch(`/api/admin/game-servers/nests/${nestId}/eggs`);
  const select = document.getElementById(targetSelectId);
  select.innerHTML = (data.eggs || []).map((egg) => {
    const attrs = egg.attributes || {};
    return `<option value="${attrs.id}">${attrs.name}</option>`;
  }).join('');
}

function openProvisionModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;">Provision Game Server</h2>
          <div class="muted">Creates a Pterodactyl user if needed, checks node capacity, allocates a free port, and provisions the server.</div>
        </div>
        <button class="btn" onclick="closeModal()">Close</button>
      </div>
      <form id="provision-form">
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label for="user-id">Local User ID</label>
              <input id="user-id" name="user_id" type="number" min="1" required />
            </div>
            <div class="field">
              <label for="server-name">Server Name</label>
              <input id="server-name" name="server_name" type="text" required />
            </div>
            <div class="field">
              <label for="node-id">Node</label>
              <select id="node-id" name="node_id" required>${buildNodeOptions()}</select>
            </div>
            <div class="field">
              <label for="nest-id">Nest</label>
              <select id="nest-id" name="nest_id" required>${buildNestOptions()}</select>
            </div>
            <div class="field">
              <label for="egg-id">Egg</label>
              <select id="egg-id" name="egg_id" required></select>
            </div>
            <div class="field">
              <label for="hostname">Hostname</label>
              <input id="hostname" name="hostname" type="text" placeholder="optional.host1top.com" />
            </div>
            <div class="field">
              <label for="memory">Memory (MB)</label>
              <input id="memory" name="memory" type="number" min="128" step="128" value="2048" required />
            </div>
            <div class="field">
              <label for="cpu">CPU (%)</label>
              <input id="cpu" name="cpu" type="number" min="10" step="10" value="100" required />
            </div>
            <div class="field">
              <label for="disk">Disk (MB)</label>
              <input id="disk" name="disk" type="number" min="1024" step="512" value="5120" required />
            </div>
          </div>
          <div class="field">
            <label for="environment">Environment JSON</label>
            <textarea id="environment" name="environment" placeholder='{"SERVER_NAME":"Example","MYSQL_DB":"db_example"}'></textarea>
          </div>
          <div id="provision-result" class="muted"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Provision</button>
        </div>
      </form>
    </div>
  `;

  const nestSelect = document.getElementById('nest-id');
  nestSelect.addEventListener('change', async () => {
    await loadEggOptions(nestSelect.value, 'egg-id');
  });

  loadEggOptions(nestSelect.value, 'egg-id').catch((err) => showStatus(err.message, 'error'));

  document.getElementById('provision-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const resultBox = document.getElementById('provision-result');
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    if (payload.environment) {
      try {
        payload.environment = JSON.parse(payload.environment);
      } catch (err) {
        resultBox.textContent = 'Environment JSON is invalid.';
        return;
      }
    } else {
      payload.environment = {};
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Provisioning...';

    try {
      const response = await adminFetch('/api/admin/game-servers/servers/provision', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      resultBox.innerHTML = `Server UUID: <span class="mono">${response.server_uuid}</span><br>SFTP: ${response.sftp.username}@${response.sftp.host}:${response.sftp.port}`;
      showStatus(response.message || 'Game server provisioned successfully.');
      await loadDashboard();
    } catch (err) {
      resultBox.textContent = err.message;
      showStatus(err.message, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Provision';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadDashboard();
  } catch (err) {
    showStatus(err.message, 'error');
  }

  document.getElementById('refresh-page').addEventListener('click', async () => {
    try {
      await loadDashboard();
      showStatus('Game server dashboard refreshed.');
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });
  document.getElementById('open-provision-modal').addEventListener('click', openProvisionModal);
  document.getElementById('bulk-start').addEventListener('click', () => runBulk('start'));
  document.getElementById('bulk-stop').addEventListener('click', () => runBulk('stop'));
  document.getElementById('bulk-delete').addEventListener('click', () => runBulk('delete'));
  document.getElementById('select-all-servers').addEventListener('change', (event) => {
    document.querySelectorAll('.server-select').forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  });
  document.getElementById('modal-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'modal-overlay') closeModal();
  });

  lucide.createIcons();
});

window.closeModal = closeModal;
window.sendPowerAction = sendPowerAction;
window.deleteServer = deleteServer;
window.resetPanelPassword = resetPanelPassword;
window.openLogsModal = openLogsModal;
