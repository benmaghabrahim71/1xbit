// Mock User ID for demonstration (In production, this would come from a session/cookie)
const CURRENT_USER_ID = 1;

async function clientRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': CURRENT_USER_ID.toString()
    }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(`http://localhost:5000/api${endpoint}`, options);
    return await res.json();
  } catch (err) {
    console.error(`Client request failed: ${endpoint}`, err);
    return { error: 'Request failed' };
  }
}

async function loadClientData() {
  const servicesBody = document.getElementById('active-services-body');
  const vpsControlSection = document.getElementById('vps-control-section');
  const vpsListContainer = document.getElementById('vps-list-container');

  const token = localStorage.getItem('authToken');
  
  if (!token) {
    servicesBody.innerHTML = '<tr><td colspan="4" style="padding:2rem; text-align:center; color:var(--muted);">Please login to view your services.</td></tr>';
    return;
  }

  try {
    const response = await fetch('/api/user/services', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      const services = data.services || [];
      
      if (services.length > 0) {
        servicesBody.innerHTML = services.map(s => {
          const panelUrl = s.service_type === 'GAME' ? 'game-panel.html' : 'vps-panel.html';
          const actionText = s.status === 'Pending' ? 'Wait' : 'Manage';
          const actionDisabled = s.status === 'Pending' ? 'disabled' : '';
          
          return `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:1rem;"><strong>${s.service_name}</strong><br/><small style="color:var(--muted)">${s.hostname}</small></td>
              <td style="padding:1rem;">${s.price.toFixed(2)} USD / ${s.pricing_cycle}</td>
              <td style="padding:1rem;">${s.next_due}</td>
              <td style="padding:1rem;"><span class="${getStatusBadge(s.status)}">${s.status}</span></td>
              <td style="padding:1rem;">
                <button onclick="manageService('${s.service_type}')" class="btn btn--primary btn--compact" ${actionDisabled}>${actionText}</button>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        servicesBody.innerHTML = '<tr><td colspan="5" style="padding:2rem; text-align:center; color:var(--muted);">No active services found.</td></tr>';
      }
    } else {
      servicesBody.innerHTML = '<tr><td colspan="5" style="padding:2rem; text-align:center; color:var(--muted);">Failed to load services.</td></tr>';
    }
  } catch (error) {
    console.error('Error loading services:', error);
    servicesBody.innerHTML = '<tr><td colspan="5" style="padding:2rem; text-align:center; color:var(--muted);">Error loading services. Please try again.</td></tr>';
  }
}

function getStatusBadge(status) {
  switch(status.toLowerCase()) {
    case 'active':
      return 'badge-active';
    case 'pending':
      return 'badge-pending';
    case 'unpaid':
      return 'badge-unpaid';
    default:
      return 'badge-active';
  }
}

function manageService(serviceType) {
  if (serviceType === 'GAME') {
    window.location.href = 'game-panel.html';
  } else {
    window.location.href = 'vps-panel.html';
  }
}

async function updateVpsStatus(uuid) {
  const statusEl = document.getElementById(`status-${uuid}`);
  const result = await clientRequest(`/vps/${uuid}/status`);
  if (result.data) {
    const s = result.data;
    statusEl.innerHTML = `Status: <span style="color:#22c55e">${s.state || 'Online'}</span>`;
  } else {
    statusEl.innerHTML = 'Status: <span style="color:#94a3b8">Offline</span>';
  }
}

async function controlVps(uuid, action) {
  const result = await clientRequest(`/vps/${uuid}/power`, 'POST', { action });
  if (result.response === 'success') {
    alert(`Signal sent: ${action}`);
    setTimeout(() => updateVpsStatus(uuid), 2000);
  } else {
    alert('Error: ' + (result.error || 'Action failed'));
  }
}

document.addEventListener('DOMContentLoaded', loadClientData);
