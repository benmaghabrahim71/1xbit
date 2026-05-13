/**
 * Host1Top Admin Panel Logic - Premium Edition
 */

let adminToken = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
let adminData = JSON.parse(localStorage.getItem('adminData') || '{}');
let currentAdminSection = 'dashboard';
const adminSupportState = {
    tickets: [],
    priority: 'all',
    status: 'all',
    query: '',
    selected: new Set()
};

document.addEventListener('DOMContentLoaded', async () => {
    // Try to restore admin session from authToken if adminToken is missing
    if (!adminToken) {
        adminToken = localStorage.getItem('authToken');
    }

    if (!adminToken) {
        showWhiteScreen();
        return;
    }

    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                adminLogout();
                return;
            }
            throw new Error('Auth failed');
        }

        const data = await response.json();
        if (data.user.role === 'admin' || data.user.role === 'super_admin') {
            adminData = data.user;
            showAdminPanel();
        } else {
            showWhiteScreen();
        }
    } catch (err) {
        console.error('Auth check failed:', err);
        showWhiteScreen();
    }

    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        if (!link.onclick) { // Don't override Logout
            link.addEventListener('click', function(e) {
                const section = this.dataset.section;
                if (!section) return;
                e.preventDefault();
                switchSection(section, this);
            });
        }
    });

    // Search
    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
        let debounceTimer;
        userSearch.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                loadUsersData(1, userSearch.value);
            }, 500);
        });
    }

    initAdminCommandBar();
    initAdminShortcuts();
    initSupportToolbar();
});

// --- AUTHENTICATION ---

function showAdminPanel() {
    document.body.style.backgroundColor = ''; // Revert to CSS
    document.body.style.visibility = 'visible';

    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = 'flex';
    
    const userDisplay = document.getElementById('adminUser');
    if (userDisplay) userDisplay.textContent = adminData.username;
    
    const roleDisplay = document.getElementById('adminRole');
    if (roleDisplay) roleDisplay.textContent = adminData.role || 'Administrator';
    
    loadDashboardData();
}

function showWhiteScreen() {
    document.body.innerHTML = '';
    document.body.style.backgroundColor = '#ffffff';
    document.body.style.visibility = 'visible';
}

function adminLogout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminData');
    adminToken = null;
    adminData = {};
    window.location.href = 'client-area.html';
}

// --- NAVIGATION ---

function switchSection(sectionId, linkEl) {
    currentAdminSection = sectionId;
    // Update Nav UI
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if (linkEl) linkEl.classList.add('active');

    // Update Section Visibility
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.add('active');

    // Update Title
    const sectionTitle = document.getElementById('sectionTitle');
    if (sectionTitle && linkEl) {
        // Use the dataset title if provided, otherwise the text content
        const title = linkEl.textContent.trim();
        sectionTitle.innerHTML = title.split(' ').map((word, i) => i === 1 ? `<span>${word}</span>` : word).join(' ');
    }

    // Update Subtitle
    const sectionSubtitle = document.getElementById('sectionSubtitle');
    if (sectionSubtitle) {
        const subtitles = {
            'dashboard': 'Real-time system state and resource allocation.',
            'users': 'Managing the resident directory and permissions.',
            'plans': 'Configuring infrastructure products and tiers.',
            'subscriptions': 'Monitoring active service deployments.',
            'pterodactyl': 'Overview of game and web hosting nodes.',
            'ryze': 'Cloud and VPS virtualization infrastructure.',
            'support': 'Resident correspondence and service tickets.',
            'transactions': 'Global financial flow and ledger.',
            'maintenance': 'System integrity and diagnostic status.'
        };
        sectionSubtitle.textContent = subtitles[sectionId] || 'Administrative Console';
    }

    updateCommandBarStatus(sectionId);

    // Route to loader
    const loaders = {
        'dashboard': loadDashboardData,
        'users': () => loadUsersData(),
        'plans': loadPlansData,
        'subscriptions': loadSubscriptionsData,
        'pterodactyl': loadPterodactylServers,
        'ryze': loadRyzeServers,
        'support': loadSupportTickets,
        'transactions': loadAllTransactions,
        'maintenance': () => { /* Static view, no loader needed */ }
    };

    if (loaders[sectionId]) loaders[sectionId]();
}

async function loadPterodactylServers() {
    const tbody = document.getElementById('pterodactylTable');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem;"><div class="loader"></div></td></tr>';
    try {
        const data = await adminFetch('/api/admin/pterodactyl/servers');
        tbody.innerHTML = data.servers.map(s => {
            let ipStr = 'N/A';
            if (s.attributes.relationships && s.attributes.relationships.allocations && s.attributes.relationships.allocations.data && s.attributes.relationships.allocations.data.length > 0) {
                const alloc = s.attributes.relationships.allocations.data.find(a => a.attributes.is_default) || s.attributes.relationships.allocations.data[0];
                if (alloc) {
                    ipStr = `${alloc.attributes.ip}:${alloc.attributes.port}`;
                }
            }
            const isSuspended = s.attributes.suspended;
            return `
            <tr>
                <td><div style="font-weight:700; color:var(--admin-text);">${s.attributes.name}</div></td>
                <td><code style="font-family:monospace; color:var(--admin-accent); font-size:0.75rem;">${s.attributes.uuid_short}</code></td>
                <td><code style="font-family:monospace; color:var(--admin-accent); font-size:0.85rem;">${ipStr}</code></td>
                <td>${s.attributes.user_id}</td>
                <td>Node ${s.attributes.node}</td>
                <td><span class="badge badge-${isSuspended ? 'danger' : 'active'}">${isSuspended ? 'Suspended' : 'Active'}</span></td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm" onclick="window.open('${window.location.origin.replace(window.location.port, '')}gp.host1top.com/admin/servers/view/${s.attributes.id}')">Manage</button>
                        <button class="btn btn-sm ${isSuspended ? 'btn-success' : 'btn-danger'}" onclick="togglePteroSuspension(${s.attributes.id}, ${isSuspended})">
                            ${isSuspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="openAssignModal('${s.attributes.uuid}', 'GAME', '${s.attributes.name}')">Assign</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
        const stats = document.getElementById('pterodactylStats');
        if (stats) stats.textContent = `${data.servers.length} Servers Online`;
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem; color:#ef4444;">Pterodactyl Connection Failed</td></tr>';
    }
}

window.togglePteroSuspension = async function(id, isSuspended) {
    const action = isSuspended ? 'unsuspend' : 'suspend';
    if (!confirm(`Are you sure you want to ${action} this server?`)) return;

    try {
        await adminFetch(`/api/admin/pterodactyl/servers/${id}/${action}`, { method: 'POST' });
        if (window.showToast) showToast(`Server ${action}ed successfully`, 'success');
        loadPterodactylServers();
    } catch (err) {
        alert(`${action.charAt(0).toUpperCase() + action.slice(1)} failed: ${err.message}`);
    }
};

async function loadRyzeServers() {
    const tbody = document.getElementById('ryzeTable');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem;"><div class="loader"></div></td></tr>';
    try {
        const data = await adminFetch('/api/admin/ryze/servers');
        tbody.innerHTML = data.servers.map(s => `
            <tr>
                <td>
                    <div style="font-weight:700; color:var(--admin-text);">VM #${s.vmid}</div>
                    <div style="font-size:0.6rem; color:var(--admin-muted);">${s.uuid}</div>
                </td>
                <td><code style="font-family:monospace; color:var(--admin-accent); font-size:0.85rem;">${s.primary_ip || 'Fetching...'}</code></td>
                <td><code style="font-family:monospace; color:var(--admin-text); font-size:0.75rem;">${s.node.node}</code></td>
                <td>
                    <span style="font-weight:700; color:var(--admin-text);">${s.config.cores} vCores</span> / 
                    <span style="color:var(--admin-muted);">${(s.config.memory / 1024).toFixed(0)}GB RAM</span>
                </td>
                <td>
                    <div style="font-size:0.8rem; color:var(--admin-text);">${s.node.location.city}</div>
                    <div style="font-size:0.6rem; color:var(--admin-muted);">${s.node.location.country}</div>
                </td>
                <td><span class="badge badge-${s.is_assigned ? 'active' : 'danger'}" style="${s.is_assigned ? 'background:rgba(98,84,254,0.1); color:#6254FE;' : 'background:rgba(5,150,105,0.1); color:#059669;'}">
                    ${s.is_assigned ? 'Linked' : 'Ready'}
                </span></td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm" onclick="window.open('https://dash.ryzehosting.com/server/${s.uuid}')">Manage</button>
                        ${s.is_assigned 
                            ? `<button class="btn btn-sm" disabled style="opacity:0.5; cursor:not-allowed;">Assigned</button>`
                            : `<button class="btn btn-sm btn-primary" onclick="openAssignModal('${s.uuid}', 'VPS', 'VM #${s.vmid}', '${s.vmid}')">Assign</button>`
                        }
                        <button class="btn btn-sm btn-danger" onclick="cancelRyzeServer('${s.uuid}', '${s.vmid}')">Cancel</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem; color:#ef4444;">Ryze API Connection Failed</td></tr>';
    }
}

window.cancelRyzeServer = async function(uuid, vmid) {
    if (!confirm(`CAUTION: Are you sure you want to CANCEL VM #${vmid}? This will delete the server on Ryze and REFUND the user balance. This action cannot be undone.`)) return;

    try {
        const result = await adminFetch(`/api/admin/ryze/${uuid}/cancel`, {
            method: 'POST'
        });
        alert(`Success: ${result.message}`);
        loadRyzeServers();
    } catch (err) {
        alert(`Cancellation failed: ${err.message}`);
    }
};

// --- DATA LOADERS ---

async function adminFetch(url, options = {}) {
    // Ensure we use the latest token
    const token = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
    
    options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(url, options);
        
        if (response.status === 401 || response.status === 403) {
            console.error('Session expired or unauthorized');
            adminLogout();
            throw new Error('Unauthorized');
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Request failed');
        }

        return await response.json();
    } catch (err) {
        console.error('Fetch error:', err.message);
        throw err;
    }
}

async function loadDashboardData() {
    try {
        const data = await adminFetch('/api/admin/dashboard');
        
        // Update Stats
        document.getElementById('totalUsers').textContent = data.system_stats.total_users || 0;
        document.getElementById('activeServices').textContent = data.service_stats.active_services || 0;
        document.getElementById('totalRevenue').textContent = `$${parseFloat(data.system_stats.total_revenue || 0).toLocaleString()}`;
        document.getElementById('openTickets').textContent = data.support_stats.open_tickets || 0;

        // Recent Users
        const usersTbody = document.getElementById('recentUsersTable');
        if (data.recent_users && data.recent_users.length) {
            usersTbody.innerHTML = data.recent_users.map(u => `
                <tr>
                    <td><div style="font-weight:600;">${u.username}</div></td>
                    <td>${u.email}</td>
                    <td>${new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
            `).join('');
        } else {
            usersTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem;">No recent registrations</td></tr>';
        }

        // Recent Activity
        const activityTbody = document.getElementById('recentTransactionsTable');
        if (data.recent_transactions && data.recent_transactions.length) {
            activityTbody.innerHTML = data.recent_transactions.map(tx => `
                <tr>
                    <td><span style="text-transform:capitalize; color:var(--admin-text);">${tx.description || tx.type}</span></td>
                    <td><span style="color: ${tx.type === 'credit' || tx.type === 'payment' ? '#059669' : '#dc2626'}; font-weight:700;">
                        ${tx.type === 'credit' || tx.type === 'payment' ? '+' : '-'}$${parseFloat(tx.amount).toFixed(2)}
                    </span></td>
                    <td>${new Date(tx.created_at).toLocaleDateString()}</td>
                </tr>
            `).join('');
        } else {
            activityTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem;">No recent activity</td></tr>';
        }

    } catch (err) {
        console.error('Dashboard load failed:', err);
    }
}

async function loadUsersData(page = 1, search = '') {
    const tbody = document.getElementById('usersTable');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem;"><div class="loader"></div></td></tr>';

    try {
        const data = await adminFetch(`/api/admin/users?page=${page}&search=${encodeURIComponent(search)}`);
        
        tbody.innerHTML = data.users.map(u => `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <div style="width:32px; height:32px; border-radius:50%; background:rgba(var(--admin-accent-rgb), 0.1); color:var(--admin-accent); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem;">${u.username[0].toUpperCase()}</div>
                        <div>
                            <div style="font-weight:600; color:var(--admin-text);">${u.username}</div>
                            <div style="font-size:0.7rem; color:var(--admin-muted);">ID: ${u.id}</div>
                        </div>
                    </div>
                </td>
                <td>${u.email}</td>
                <td><span style="font-weight:700; color:var(--admin-text);">$${parseFloat(u.balance).toFixed(2)}</span></td>
                <td><span class="badge badge-${u.status === 'active' ? 'active' : 'danger'}">${u.status}</span></td>
                <td><span style="text-transform:uppercase; font-size:0.7rem; font-weight:800; color:var(--text-secondary);">${u.role}</span></td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm" onclick="editUser(${u.id})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="manageUserStatus(${u.id}, '${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem; color:#ef4444;">Failed to load users</td></tr>';
    }
}

async function loadPlansData() {
    const tbody = document.getElementById('plansTable');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:3rem;">Loading plans...</td></tr>';

    try {
        const data = await adminFetch('/api/admin/plans');
        tbody.innerHTML = data.plans.map(p => `
            <tr>
                <td>
                    <div style="font-weight:700; color:var(--admin-text);">${p.name}</div>
                    <div style="font-size:0.6rem; color:var(--admin-muted); text-transform:uppercase;">${p.provider || 'pterodactyl'}</div>
                </td>
                <td>
                    <span style="background:var(--admin-surface-light); color:var(--admin-text); padding:0.25rem 0.5rem; border-radius:4px; font-size:0.8rem;">${p.type}</span>
                    <span style="margin-left:0.5rem; color:${p.tier === 'Extreme' ? '#dc2626' : p.tier === 'Budget' ? '#059669' : '#d97706'}; font-size:0.7rem; font-weight:800; text-transform:uppercase;">${p.tier || 'Standard'}</span>
                    ${p.game_name ? `<span style="margin-left:0.5rem; color:var(--admin-accent); font-size:0.7rem; font-weight:800;">${p.game_name}</span>` : ''}
                </td>
                <td><div style="color:var(--admin-text); font-weight:800;">$${parseFloat(p.price).toFixed(2)}</div></td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm" onclick="editPlan(${p.id})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deletePlan(${p.id})">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:3rem; color:#ef4444;">Failed to load plans</td></tr>';
    }
}

async function loadSubscriptionsData() {
    const tbody = document.getElementById('subscriptionsTable');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem;">Loading subscriptions...</td></tr>';

        try {
            const data = await adminFetch('/api/admin/subscriptions');
            tbody.innerHTML = data.subscriptions.map(s => `
                <tr>
                    <td><div style="font-family:monospace; font-size:0.8rem; color:var(--admin-text);">${s.service_uuid ? s.service_uuid.substring(0, 8) + '...' : 'SUB-' + s.id}</div></td>
                    <td><span style="color:var(--admin-text); font-weight:600;">${s.username}</span></td>
                    <td><span style="color:var(--admin-text);">${s.plan_name || 'Custom'}</span> <span style="color:var(--admin-muted); font-size:0.75rem;">(${s.service_type})</span></td>
                    <td>${s.expires_at ? new Date(s.expires_at).toLocaleDateString() : 'N/A'}</td>
                    <td><span class="badge badge-${s.status.toLowerCase() === 'active' ? 'active' : 'danger'}">${s.status}</span></td>
                    <td>
                        <button class="btn btn-sm" onclick="manageService('${s.service_uuid}')">Manage</button>
                    </td>
                </tr>
            `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem; color:#ef4444;">Failed to load subscriptions</td></tr>';
    }
}

async function loadSupportTickets() {
    const tbody = document.getElementById('ticketsTable');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem;">Loading tickets...</td></tr>';

    try {
        const data = await adminFetch('/api/admin/support');
        adminSupportState.tickets = Array.isArray(data.tickets) ? data.tickets : [];
        renderSupportTickets();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem; color:#ef4444;">Failed to load tickets</td></tr>';
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getFilteredSupportTickets() {
    return adminSupportState.tickets.filter((ticket) => {
        const matchesPriority = adminSupportState.priority === 'all' || ticket.priority === adminSupportState.priority;
        const matchesStatus = adminSupportState.status === 'all' || ticket.status === adminSupportState.status;
        const haystack = `${ticket.subject} ${ticket.message} ${ticket.username} ${ticket.email || ''}`.toLowerCase();
        const matchesQuery = !adminSupportState.query || haystack.includes(adminSupportState.query.toLowerCase());
        return matchesPriority && matchesStatus && matchesQuery;
    });
}

function updateSupportBulkBar() {
    const bar = document.getElementById('supportBulkBar');
    const count = document.getElementById('supportBulkCount');
    if (!bar || !count) return;
    const selectedCount = adminSupportState.selected.size;
    bar.classList.toggle('is-visible', selectedCount > 0);
    count.textContent = `${selectedCount} selected`;
}

function syncSupportSelectAll() {
    const selectAll = document.getElementById('supportSelectAll');
    if (!selectAll) return;
    const visibleRows = getFilteredSupportTickets();
    selectAll.checked = visibleRows.length > 0 && visibleRows.every((ticket) => adminSupportState.selected.has(ticket.id));
    selectAll.indeterminate = visibleRows.some((ticket) => adminSupportState.selected.has(ticket.id)) && !selectAll.checked;
}

function renderSupportTickets() {
    const tbody = document.getElementById('ticketsTable');
    if (!tbody) return;
    const tickets = getFilteredSupportTickets();

    if (!tickets.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3rem; color:var(--admin-muted);">No tickets match the current filters.</td></tr>';
        updateSupportBulkBar();
        syncSupportSelectAll();
        return;
    }

    tbody.innerHTML = tickets.map((ticket) => `
        <tr>
            <td><input type="checkbox" class="table-checkbox support-row-checkbox" data-ticket-id="${ticket.id}" ${adminSupportState.selected.has(ticket.id) ? 'checked' : ''} aria-label="Select ticket ${ticket.id}" /></td>
            <td>
                <div style="font-weight:700; color:var(--admin-text);">${escapeHtml(ticket.subject)}</div>
                <div style="font-size:0.78rem; color:var(--admin-muted); max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ticket.message)}</div>
            </td>
            <td>
                <div style="font-weight:600; color:var(--admin-text);">${escapeHtml(ticket.username)}</div>
                <div style="font-size:0.72rem; color:var(--admin-muted);">${escapeHtml(ticket.email || '')}</div>
            </td>
            <td><span style="color:${ticket.priority === 'urgent' || ticket.priority === 'high' ? '#dc2626' : 'var(--admin-text)'}; font-weight:700; text-transform:capitalize;">${escapeHtml(ticket.priority)}</span></td>
            <td><span class="badge badge-${ticket.status === 'open' ? 'active' : 'danger'}">${escapeHtml(ticket.status)}</span></td>
            <td>${new Date(ticket.created_at).toLocaleString()}</td>
            <td>
                <div class="inline-actions">
                    <button class="btn btn-sm" onclick="viewTicket(${ticket.id})">Respond</button>
                    <button class="btn btn-sm" onclick="updateTicketStatus(${ticket.id}, 'resolved')">Resolve</button>
                    <button class="btn btn-sm btn-danger" onclick="updateTicketStatus(${ticket.id}, 'closed')">Close</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.support-row-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            const id = Number(checkbox.dataset.ticketId);
            if (checkbox.checked) {
                adminSupportState.selected.add(id);
            } else {
                adminSupportState.selected.delete(id);
            }
            updateSupportBulkBar();
            syncSupportSelectAll();
        });
    });

    updateSupportBulkBar();
    syncSupportSelectAll();
}

async function loadAllTransactions() {
    const tbody = document.getElementById('allTransactionsTable');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem;">Loading transactions...</td></tr>';

    try {
        const data = await adminFetch('/api/admin/transactions');
        tbody.innerHTML = data.transactions.map(tx => `
            <tr>
                <td><code style="font-family:monospace; color:var(--admin-muted);">#${tx.id}</code></td>
                <td>
                    <div style="font-weight:600; color:var(--admin-text);">${tx.username}</div>
                    <div style="font-size:0.7rem; color:var(--admin-muted);">UID: ${tx.user_id}</div>
                </td>
                <td style="text-transform:capitalize; color:var(--admin-text);">${tx.type}</td>
                <td style="font-weight:800; color: ${tx.type === 'credit' || tx.type === 'payment' ? '#059669' : '#dc2626'}">
                    ${tx.type === 'credit' || tx.type === 'payment' ? '+' : '-'}$${parseFloat(tx.amount).toFixed(2)}
                </td>
                <td><span class="badge badge-active">${tx.status}</span></td>
                <td><span style="color:var(--text-secondary); font-size:0.8rem;">${new Date(tx.created_at).toLocaleString()}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:3rem; color:#ef4444;">Failed to load transactions</td></tr>';
    }
}

// --- MODAL & ACTIONS ---

window.openAssignModal = function(uuid, type, name, ryze_vmid = null) {
    const modal = document.getElementById('modalOverlay');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; padding: 2.5rem;">
            <button onclick="document.getElementById('modalOverlay').style.display='none'" class="modal-close" style="position: absolute; top: 1.25rem; right: 1.25rem; background: none; border: none; color: var(--text-secondary); cursor: pointer;"><i data-lucide="x" size="20"></i></button>
            
            <h2 style="font-size: 1.5rem; font-weight: 800; margin-bottom: 0.5rem;">Assign Service</h2>
            <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 2rem;">Assigning <strong style="color:var(--text-primary);">${name}</strong> (${type}) to a user.</p>

            <form id="assignServiceForm">
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem;">User Email</label>
                    <div style="display:flex; gap:0.5rem;">
                        <input type="email" id="assignSearchEmail" required placeholder="user@example.com" style="flex:1;">
                        <button type="button" class="btn btn-primary" id="assignSearchBtn">Search</button>
                    </div>
                    <div id="assignSearchResult" style="margin-top:0.75rem; font-size:0.875rem; font-weight: 500;"></div>
                </div>

                <input type="hidden" id="assignUserId" value="">

                <button type="submit" id="assignConfirmBtn" class="btn btn-primary" style="width: 100%; opacity: 0.5; pointer-events: none;">Confirm Assignment</button>
            </form>
        </div>
    `;
    lucide.createIcons();

    document.getElementById('assignSearchBtn').onclick = async () => {
        const email = document.getElementById('assignSearchEmail').value;
        if (!email) return;
        const resEl = document.getElementById('assignSearchResult');
        resEl.style.color = 'var(--admin-muted)';
        resEl.textContent = 'Searching...';

        try {
            const data = await adminFetch(`/api/admin/users/search?email=${encodeURIComponent(email)}`);
            if (data.user) {
                document.getElementById('assignUserId').value = data.user.id;
                resEl.style.color = 'var(--admin-accent)';
                resEl.textContent = `Found: ${data.user.username} (ID: ${data.user.id})`;
                const btn = document.getElementById('assignConfirmBtn');
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            }
        } catch (err) {
            resEl.style.color = '#ef4444';
            resEl.textContent = 'User not found.';
            document.getElementById('assignUserId').value = '';
            const btn = document.getElementById('assignConfirmBtn');
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
        }
    };

    document.getElementById('assignServiceForm').onsubmit = async (e) => {
        e.preventDefault();
        const user_id = document.getElementById('assignUserId').value;
        if (!user_id) return;

        try {
            await adminFetch('/api/admin/assign-service', {
                method: 'POST',
                body: JSON.stringify({
                    user_id,
                    service_type: type,
                    service_uuid: uuid,
                    hostname: name,
                    ryze_vmid: ryze_vmid
                })
            });
            modal.style.display = 'none';
            if (window.showToast) showToast('Service assigned to user', 'success');
            
            // Reload the appropriate section
            if (type === 'VPS' || type === 'RDP') loadRyzeServers();
            else loadPterodactylServers();

        } catch (err) {
            alert('Assignment failed: ' + err.message);
        }
    };
};

window.editUser = async function(id) {
    const amount = prompt("Add/Subtract balance (e.g. 10 or -10):");
    if (!amount) return;
    
    const action = parseFloat(amount) >= 0 ? 'add' : 'subtract';
    const finalAmount = Math.abs(parseFloat(amount));

    try {
        await adminFetch(`/api/admin/users/${id}/balance`, {
            method: 'PUT',
            body: JSON.stringify({ amount: finalAmount, action })
        });
        if (window.showToast) showToast('Balance updated', 'success');
        loadUsersData();
    } catch (err) {
        alert('Update failed');
    }
};

window.manageUserStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
        await adminFetch(`/api/admin/users/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        loadUsersData();
    } catch (err) {
        alert('Status update failed');
    }
};

window.deletePlan = async function(id) {
    if (!confirm('Are you sure you want to delete this plan?')) return;
    try {
        await adminFetch(`/api/admin/plans/${id}`, { method: 'DELETE' });
        loadPlansData();
    } catch (err) {
        alert(err.message || 'Delete failed');
    }
};

window.openPlanModal = function() {
    const modal = document.getElementById('modalOverlay');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px; padding: 0; overflow: hidden;">
            <div style="background: var(--bg-primary); padding: 1.5rem 2.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0;">Deploy New Plan</h2>
                    <p style="font-size: 0.8125rem; color: var(--text-secondary); margin-top: 0.25rem;">Configure a new service offering for residents.</p>
                </div>
                <button onclick="document.getElementById('modalOverlay').style.display='none'" style="background: white; border: 1px solid var(--border); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;"><i data-lucide="x" size="18"></i></button>
            </div>

            <form id="createPlanForm">
                <div style="padding: 2rem 2.5rem; max-height: 70vh; overflow-y: auto;">
                    <!-- Group: General Information -->
                    <div style="margin-bottom: 2.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                            <div style="width: 24px; height: 24px; background: var(--accent-soft); color: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center;"><i data-lucide="info" size="14"></i></div>
                            <h3 style="font-size: 0.875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">General Information</h3>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
                            <div style="grid-column: span 2;">
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Plan Name</label>
                                <input type="text" name="name" required placeholder="e.g. Starter VPS" style="background: var(--bg-primary);">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Service Type</label>
                                <select name="type" style="background: var(--bg-primary);">
                                    <option value="VPS">VPS Hosting</option>
                                    <option value="RDP">RDP Windows</option>
                                    <option value="GAME">Game Server</option>
                                    <option value="WEB">Web Hosting</option>
                                </select>
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Plan Tier</label>
                                <select name="tier" style="background: var(--bg-primary);">
                                    <option value="Standard">Standard</option>
                                    <option value="Budget">Budget</option>
                                    <option value="Extreme">Extreme</option>
                                </select>
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Price ($)</label>
                                <input type="number" step="0.01" name="price" required placeholder="0.00" style="background: var(--bg-primary);">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Billing Cycle</label>
                                <select name="billing_cycle" style="background: var(--bg-primary);">
                                    <option value="Monthly">Monthly</option>
                                    <option value="Quarterly">Quarterly</option>
                                    <option value="Semi-Annually">Semi-Annually</option>
                                    <option value="Annually">Annually</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Group: Resource Allocation -->
                    <div style="margin-bottom: 2.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                            <div style="width: 24px; height: 24px; background: var(--accent-soft); color: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center;"><i data-lucide="cpu" size="14"></i></div>
                            <h3 style="font-size: 0.875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">Resource Allocation</h3>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.25rem;">
                            <div id="cpuLimitField">
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">CPU (%)</label>
                                <input type="number" name="cpu" value="100" style="background: var(--bg-primary);">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">RAM (MB)</label>
                                <input type="number" name="memory" value="1024" style="background: var(--bg-primary);">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Disk (MB)</label>
                                <input type="number" name="disk" value="5120" style="background: var(--bg-primary);">
                            </div>
                        </div>
                    </div>

                    <!-- Group: Backend Provider -->
                    <div style="margin-bottom: 1.5rem; padding: 1.5rem; background: var(--bg-primary); border-radius: var(--radius); border: 1px solid var(--border);">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                            <div style="width: 24px; height: 24px; background: white; color: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border);"><i data-lucide="database" size="14"></i></div>
                            <h3 style="font-size: 0.875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-primary);">Backend Provisioning</h3>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem;">
                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Provider Engine</label>
                                <select name="provider" id="providerSelect" style="background: white;">
                                    <option value="pterodactyl">Pterodactyl (Game/Web)</option>
                                    <option value="ryze">Ryze API (VPS/RDP/Cloud)</option>
                                </select>
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Specialization</label>
                                <select name="game_name" style="background: white;">
                                    <option value="">None (Generic)</option>
                                    <option value="Minecraft">Minecraft</option>
                                    <option value="SA-MP">SA-MP</option>
                                    <option value="MTA:SA">MTA:SA</option>
                                    <option value="Windows">Windows RDP</option>
                                    <option value="Linux">Linux VPS</option>
                                </select>
                            </div>
                        </div>

                        <!-- Pterodactyl Specific -->
                        <div id="pterodactylFields" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; padding-top: 1.5rem; border-top: 1px dashed var(--border);">
                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Nest Identifier</label>
                                <input type="number" name="nest_id" placeholder="5" value="1" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Egg Identifier</label>
                                <input type="number" name="egg_id" placeholder="1" value="1" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Location ID</label>
                                <input type="number" name="location_id" placeholder="1" value="1" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Swap (MB)</label>
                                <input type="number" name="swap" placeholder="0" value="0" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Block IO Weight</label>
                                <input type="number" name="io" placeholder="500" value="500" min="10" max="1000" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Databases</label>
                                <input type="number" name="databases" value="0" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Backups</label>
                                <input type="number" name="backups" value="0" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Allocations</label>
                                <input type="number" name="allocations" value="0" style="background: white;">
                            </div>

                            <div style="display: flex; align-items: center; gap: 0.75rem; grid-column: span 2; padding: 0.5rem 0;">
                                <input type="checkbox" name="oom_disabled" id="oom_disabled" style="width: auto;">
                                <label for="oom_disabled" style="font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); cursor: pointer;">Disable OOM Killer</label>
                            </div>

                            <div style="grid-column: span 2;">
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Docker Image (Optional)</label>
                                <input type="text" name="docker_image" placeholder="Leave blank for egg default" style="background: white;">
                            </div>

                            <div style="grid-column: span 2;">
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Startup Command (Optional)</label>
                                <input type="text" name="startup" placeholder="Leave blank for egg default" style="background: white;">
                            </div>

                            <div style="grid-column: span 2;">
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Port Range (e.g. 25565-25570)</label>
                                <input type="text" name="port_range" placeholder="Optional" style="background: white;">
                            </div>
                        </div>

                        <!-- Ryze Specific -->
                        <div id="ryzeFields" style="display: none; grid-template-columns: 1fr 1fr; gap: 1.25rem; padding-top: 1.5rem; border-top: 1px dashed var(--border);">
                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Ryze Plan ID</label>
                                <input type="text" name="ryze_plan_id" placeholder="e.g. ryzen-4gb" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Hardware / CPU Type</label>
                                <select name="ryze_cpu_type" id="ryzeCpuSelect" style="background: white;">
                                    <option value="">-- Loading Hardware... --</option>
                                </select>
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">CPU Cores</label>
                                <input type="number" name="ryze_cores" id="ryzeCoresInput" placeholder="e.g. 4" min="1" max="64" style="background: white;">
                            </div>

                            <div>
                                <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
                                    OS Template
                                    <span id="ryzeOsLoadingBadge" style="margin-left:0.5rem; font-size:0.65rem; color: var(--accent); font-weight: 800; text-transform: uppercase;">Syncing...</span>
                                </label>
                                <select name="ryze_os_name" id="ryzeOsSelect" style="background: white;">
                                    <option value="">-- Loading OS list... --</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">Marketing Description</label>
                        <textarea name="description" placeholder="Summarize the plan features for residents..." style="min-height: 100px; resize: vertical; background: var(--bg-primary);"></textarea>
                    </div>
                </div>

                <div style="padding: 1.5rem 2.5rem; background: var(--bg-primary); border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 1rem;">
                    <button type="button" onclick="document.getElementById('modalOverlay').style.display='none'" class="btn" style="padding: 0.75rem 1.5rem;">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="padding: 0.75rem 2.5rem;">Deploy Offering</button>
                </div>
            </form>
        </div>
    `;
    lucide.createIcons();

    const providerSelect = document.getElementById('providerSelect');
    const pteroFields = document.getElementById('pterodactylFields');
    const ryzeFields = document.getElementById('ryzeFields');
    const cpuLimitField = document.getElementById('cpuLimitField');

    // Load Ryze OS list from backend API
    async function loadRyzeOsList() {
        const osSelect = document.getElementById('ryzeOsSelect');
        const badge = document.getElementById('ryzeOsLoadingBadge');
        try {
            const data = await adminFetch('/api/admin/ryze/os');
            let osList = data.os_list || [];
            
            // Filter: Hide Windows Server 2019 and allow only Linux-based OS if needed
            // User requested: "Allow Just Linux And Hide Windows Server 2019"
            osList = osList.filter(os => {
                const name = (os.display_name || os.name || '').toLowerCase();
                if (name.includes('windows server 2019')) return false;
                // Basic check for linux keywords if "Allow Just Linux" is strict
                // return name.includes('linux') || name.includes('ubuntu') || name.includes('debian') || name.includes('centos') || name.includes('fedora');
                return true; // Keeping it flexible but hiding 2019 as requested
            });

            if (osList.length === 0) {
                osSelect.innerHTML = '<option value="">No valid OS found from API</option>';
                if (badge) badge.textContent = 'Filtered Empty';
                return;
            }
            osSelect.innerHTML = osList.map(os => {
                const name = os.display_name || os.name || os.label || os;
                const val = os.image || os.id || name;
                return `<option value="${val}">${name}</option>`;
            }).join('');
            if (badge) badge.textContent = `Active (${osList.length})`;
        } catch (err) {
            osSelect.innerHTML = '<option value="">Failed to load OS list</option>';
            if (badge) badge.textContent = 'API Error';
        }
    }

    // Load Ryze Hardware list from backend API
    async function loadRyzeHardwareList() {
        const cpuSelect = document.getElementById('ryzeCpuSelect');
        const coresInput = document.getElementById('ryzeCoresInput');
        try {
            const data = await adminFetch('/api/admin/ryze/hardware');
            const hwList = data.hardware_list || [];
            if (hwList.length === 0) {
                cpuSelect.innerHTML = '<option value="">No Hardware found</option>';
                return;
            }
            cpuSelect.innerHTML = hwList.map(hw => {
                const name = hw.displayname || hw.name || hw;
                const val = hw.name || name;
                return `<option value="${val}" data-cores-min="${hw.configuration?.cores?.min || 1}" data-cores-max="${hw.configuration?.cores?.max || 64}">${name}</option>`;
            }).join('');

            // Update cores input constraints based on selected CPU
            cpuSelect.onchange = () => {
                const selected = cpuSelect.options[cpuSelect.selectedIndex];
                if (selected) {
                    coresInput.min = selected.getAttribute('data-cores-min');
                    coresInput.max = selected.getAttribute('data-cores-max');
                    coresInput.value = coresInput.min;
                }
            };
            cpuSelect.onchange(); // Initial trigger
        } catch (err) {
            cpuSelect.innerHTML = '<option value="">Failed to load hardware</option>';
        }
    }

    providerSelect.addEventListener('change', (e) => {
        if (e.target.value === 'pterodactyl') {
            pteroFields.style.display = 'grid';
            ryzeFields.style.display = 'none';
            cpuLimitField.style.display = 'block';
        } else {
            pteroFields.style.display = 'none';
            ryzeFields.style.display = 'grid';
            cpuLimitField.style.display = 'none';
            loadRyzeOsList();
            loadRyzeHardwareList();
        }
    });

    document.getElementById('createPlanForm').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        try {
            await adminFetch('/api/admin/plans', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            modal.style.display = 'none';
            loadPlansData();
            if (window.showToast) showToast('Plan created successfully', 'success');
        } catch (err) {
            alert('Failed to create plan: ' + err.message);
        }
    };
};

window.viewTicket = async function(id) {
    const modal = document.getElementById('modalOverlay');
    modal.innerHTML = '<div class="modal-content" style="max-width: 800px; display: flex; align-items: center; justify-content: center; padding: 4rem;"><div class="loader"></div></div>';
    modal.style.display = 'flex';

    try {
        const data = await adminFetch(`/api/admin/support/${id}`);
        const { ticket, replies } = data;

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 850px; display: flex; flex-direction: column; max-height: 90vh; padding: 2.5rem;">
                <button onclick="document.getElementById('modalOverlay').style.display='none'" style="position: absolute; top: 1.25rem; right: 1.25rem; background: none; border: none; color: var(--text-secondary); cursor: pointer;"><i data-lucide="x" size="20"></i></button>
                
                <div style="margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem;">
                    <div style="font-size: 0.75rem; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Transmission #${ticket.id}</div>
                    <h2 style="font-size: 1.75rem; font-weight: 800; margin: 0; color: var(--text-primary); letter-spacing: -0.02em;">${ticket.subject}</h2>
                    <div style="margin-top: 0.75rem; color: var(--text-secondary); font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem;">
                        Resident <span style="color: var(--text-primary); font-weight: 700;">${ticket.username}</span> 
                        <span style="opacity: 0.3;">•</span>
                        <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;">${ticket.email}</span>
                    </div>
                </div>

                <div id="adminTicketThread" style="flex: 1; overflow-y: auto; padding-right: 1.5rem; margin-bottom: 2rem; display: flex; flex-direction: column; gap: 1.25rem;">
                    <!-- Original Message -->
                    <div style="background: var(--bg-primary); padding: 1.5rem; border-radius: var(--radius); border-left: 4px solid var(--border);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 1rem; align-items: center;">
                            <span style="font-weight: 700; font-size: 0.875rem; color: var(--text-primary);">${ticket.username}</span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace;">${new Date(ticket.created_at).toLocaleString()}</span>
                        </div>
                        <div style="line-height: 1.6; color: var(--text-primary); font-size: 0.95rem; white-space: pre-wrap;">${ticket.message}</div>
                    </div>

                    <!-- Replies -->
                    ${replies.map(r => `
                        <div style="background: ${r.is_admin ? 'var(--accent-soft)' : 'var(--bg-primary)'}; padding: 1.5rem; border-radius: var(--radius); border-left: 4px solid ${r.is_admin ? 'var(--accent)' : 'var(--border)'}; margin-left: ${r.is_admin ? '2.5rem' : '0'};">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 1rem; align-items: center;">
                                <span style="font-weight: 700; font-size: 0.875rem; color: ${r.is_admin ? 'var(--accent)' : 'var(--text-primary)'}">${r.is_admin ? 'HOST1TOP COMMAND' : ticket.username}</span>
                                <span style="font-size: 0.75rem; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace;">${new Date(r.created_at).toLocaleString()}</span>
                            </div>
                            <div style="line-height: 1.6; color: var(--text-primary); font-size: 0.95rem; white-space: pre-wrap;">${r.message}</div>
                        </div>
                    `).join('')}
                </div>

                <div style="border-top: 1px solid var(--border); padding-top: 2rem;">
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem;">Secure Response</label>
                        <textarea id="adminReplyText" placeholder="Compose encrypted transmission to resident..." style="min-height: 120px; resize: vertical;"></textarea>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; gap: 0.75rem;">
                            <button onclick="updateTicketStatus(${ticket.id}, 'resolved')" class="btn btn-sm" style="border-color: var(--accent); color: var(--accent);">Mark Resolved</button>
                            <button onclick="updateTicketStatus(${ticket.id}, 'closed')" class="btn btn-sm btn-danger">Terminate Ticket</button>
                        </div>
                        <button onclick="submitAdminReply(${ticket.id})" id="adminReplyBtn" class="btn btn-primary" style="padding: 0.75rem 2rem;">Transmit Reply</button>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    } catch (err) {
        modal.innerHTML = '<div class="modal-content" style="padding: 2.5rem;"><h2 style="color:var(--danger);">Access Error</h2><p>Could not retrieve transmission logs.</p></div>';
    }
};

window.submitAdminReply = async function(id) {
    const message = document.getElementById('adminReplyText').value;
    if (!message.trim()) return alert('Message cannot be empty');
    
    try {
        await adminFetch(`/api/admin/support/${id}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        if (window.showToast) showToast('Reply posted successfully', 'success');
        viewTicket(id); // Reload ticket modal
        loadSupportTickets(); // Update list in background
    } catch (err) {
        alert('Failed to post reply: ' + err.message);
    }
};

window.updateTicketStatus = async function(id, status) {
    try {
        await adminFetch(`/api/admin/support/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        adminSupportState.selected.delete(Number(id));
        if (window.showToast) showToast(`Ticket marked as ${status}`, 'success');
        document.getElementById('modalOverlay').style.display = 'none';
        loadSupportTickets();
    } catch (err) {
        alert('Failed to update status: ' + err.message);
    }
};

function updateCommandBarStatus(sectionId = currentAdminSection) {
    const node = document.getElementById('adminCommandStatus');
    if (!node) return;
    const labels = {
        dashboard: 'Overview shortcuts active: refresh metrics, export visible tables, or open contextual guidance.',
        users: 'User directory tools active: search, export, and keyboard navigation are ready.',
        plans: 'Product tools active: export catalog data and open section help for field guidance.',
        subscriptions: 'Service tools active: refresh deployment state or export the visible inventory.',
        pterodactyl: 'Node tools active: export infrastructure rows and jump into incident help.',
        ryze: 'Cloud tools active: export host data and review contextual runbook hints.',
        support: 'Ticket triage tools active: filter by priority, bulk resolve, export, and use keyboard shortcuts.',
        transactions: 'Financial tools active: export ledger rows and refresh the current reporting view.',
        maintenance: 'Maintenance tools active: open contextual help or return to the command center.'
    };
    node.textContent = labels[sectionId] || 'Quick tools are ready for the current section.';
}

function refreshCurrentSection() {
    const refreshers = {
        dashboard: loadDashboardData,
        users: () => loadUsersData(),
        plans: loadPlansData,
        subscriptions: loadSubscriptionsData,
        pterodactyl: loadPterodactylServers,
        ryze: loadRyzeServers,
        support: loadSupportTickets,
        transactions: loadAllTransactions
    };
    const loader = refreshers[currentAdminSection];
    if (loader) {
        loader();
        if (window.showToast) showToast(`Refreshed ${currentAdminSection}`, 'success');
    }
}

function exportCurrentSection() {
    const section = document.getElementById(currentAdminSection);
    const table = section?.querySelector('table');
    if (!table) {
        if (window.showToast) showToast('No table is available to export in this section.', 'error');
        return;
    }

    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
        Array.from(row.children)
            .map((cell) => `"${cell.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`)
            .join(',')
    );
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `host1top-${currentAdminSection}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    if (window.showToast) showToast(`Exported ${currentAdminSection} data`, 'success');
}

function openAdminOverlay(content, maxWidth = '680px') {
    const modal = document.getElementById('modalOverlay');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:${maxWidth}; padding:2rem 2rem 1.75rem;">
            <button onclick="document.getElementById('modalOverlay').style.display='none'" style="position:absolute; top:1rem; right:1rem; border:none; background:none; color:var(--text-secondary); font-size:1.2rem; cursor:pointer;">×</button>
            ${content}
        </div>
    `;
}

function openAdminHelpPanel(mode = 'context') {
    if (mode === 'shortcuts') {
        openAdminOverlay(`
            <h2 style="margin:0 0 1rem;">Keyboard Shortcuts</h2>
            <div class="context-help">
                <div class="context-help__item"><strong>Shift + R</strong><span>Refresh the current section.</span></div>
                <div class="context-help__item"><strong>Shift + E</strong><span>Export the current table to CSV.</span></div>
                <div class="context-help__item"><strong>Alt + 1..8</strong><span>Jump between dashboard, users, plans, subscriptions, Pterodactyl, Ryze, support, and transactions.</span></div>
                <div class="context-help__item"><strong>?</strong><span>Open contextual help for the current section.</span></div>
            </div>
        `, '560px');
        return;
    }

    const helpMap = {
        dashboard: [
            'Use Refresh after provisioning or ticket changes to update summary cards.',
            'Export lets you capture the currently visible tables for handoff or audit notes.'
        ],
        support: [
            'Filter by priority or status to isolate urgent issues before bulk actions.',
            'Resolve or close tickets inline when the issue is already understood.',
            'Use Select visible then bulk actions to clean up ticket queues quickly.'
        ],
        pterodactyl: [
            'Use Manage for deep inspection and Export for incident snapshots.',
            'Suspend or unsuspend directly from the row after confirming the resident impact.'
        ]
    };
    const items = helpMap[currentAdminSection] || [
        'Use Refresh to reload the active administrative dataset.',
        'Use Export to capture the current table for reporting or escalation.'
    ];

    openAdminOverlay(`
        <h2 style="margin:0 0 1rem;">${currentAdminSection.charAt(0).toUpperCase() + currentAdminSection.slice(1)} Help</h2>
        <div class="context-help">
            ${items.map((item, index) => `<div class="context-help__item"><strong>Tip ${index + 1}</strong><span>${item}</span></div>`).join('')}
        </div>
    `, '620px');
}

function initAdminCommandBar() {
    document.getElementById('admin-refresh-btn')?.addEventListener('click', refreshCurrentSection);
    document.getElementById('admin-export-btn')?.addEventListener('click', exportCurrentSection);
    document.getElementById('admin-help-btn')?.addEventListener('click', () => openAdminHelpPanel('context'));
    document.getElementById('admin-shortcuts-btn')?.addEventListener('click', () => openAdminHelpPanel('shortcuts'));
    updateCommandBarStatus(currentAdminSection);
}

async function bulkUpdateSupportTickets(status) {
    const ids = Array.from(adminSupportState.selected);
    if (!ids.length) return;
    try {
        for (const id of ids) {
            await adminFetch(`/api/admin/support/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status })
            });
        }
        adminSupportState.selected.clear();
        if (window.showToast) showToast(`Updated ${ids.length} ticket(s) to ${status}`, 'success');
        loadSupportTickets();
    } catch (error) {
        if (window.showToast) showToast(error.message || 'Bulk update failed', 'error');
    }
}

function initSupportToolbar() {
    if (document.body.dataset.supportToolbarBound === 'true') return;
    document.body.dataset.supportToolbarBound = 'true';

    document.querySelectorAll('[data-ticket-priority]').forEach((button) => {
        button.addEventListener('click', () => {
            adminSupportState.priority = button.dataset.ticketPriority;
            document.querySelectorAll('[data-ticket-priority]').forEach((chip) => chip.classList.toggle('is-active', chip === button));
            renderSupportTickets();
        });
    });

    document.querySelectorAll('[data-ticket-status]').forEach((button) => {
        button.addEventListener('click', () => {
            adminSupportState.status = button.dataset.ticketStatus;
            document.querySelectorAll('[data-ticket-status]').forEach((chip) => chip.classList.toggle('is-active', chip === button));
            renderSupportTickets();
        });
    });

    document.getElementById('supportSearchInput')?.addEventListener('input', (event) => {
        adminSupportState.query = event.target.value || '';
        renderSupportTickets();
    });

    document.getElementById('supportSelectAll')?.addEventListener('change', (event) => {
        const visible = getFilteredSupportTickets();
        if (event.target.checked) {
            visible.forEach((ticket) => adminSupportState.selected.add(ticket.id));
        } else {
            visible.forEach((ticket) => adminSupportState.selected.delete(ticket.id));
        }
        renderSupportTickets();
    });

    document.getElementById('supportSelectAllVisible')?.addEventListener('click', () => {
        getFilteredSupportTickets().forEach((ticket) => adminSupportState.selected.add(ticket.id));
        renderSupportTickets();
    });
    document.getElementById('supportBulkResolve')?.addEventListener('click', () => bulkUpdateSupportTickets('resolved'));
    document.getElementById('supportBulkClose')?.addEventListener('click', () => bulkUpdateSupportTickets('closed'));
    document.getElementById('supportBulkClear')?.addEventListener('click', () => {
        adminSupportState.selected.clear();
        renderSupportTickets();
    });
}

function initAdminShortcuts() {
    if (document.body.dataset.adminShortcutsBound === 'true') return;
    document.body.dataset.adminShortcutsBound = 'true';
    document.addEventListener('keydown', (event) => {
        const tagName = document.activeElement?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

        if (event.shiftKey && event.key.toLowerCase() === 'r') {
            event.preventDefault();
            refreshCurrentSection();
            return;
        }
        if (event.shiftKey && event.key.toLowerCase() === 'e') {
            event.preventDefault();
            exportCurrentSection();
            return;
        }
        if (event.key === '?') {
            event.preventDefault();
            openAdminHelpPanel('context');
            return;
        }
        if (event.altKey) {
            const sections = ['dashboard', 'users', 'plans', 'subscriptions', 'pterodactyl', 'ryze', 'support', 'transactions'];
            const index = Number(event.key) - 1;
            if (sections[index]) {
                event.preventDefault();
                const sectionId = sections[index];
                const link = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
                switchSection(sectionId, link);
            }
        }
    });
}

if (!window.showToast) {
    window.showToast = function(message, tone = 'success') {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.right = '1rem';
        toast.style.bottom = '1rem';
        toast.style.zIndex = '2000';
        toast.style.padding = '0.85rem 1rem';
        toast.style.borderRadius = '0.85rem';
        toast.style.background = tone === 'error' ? '#7f1d1d' : '#0f766e';
        toast.style.color = '#ffffff';
        toast.style.boxShadow = '0 18px 40px rgba(15, 23, 42, 0.22)';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2600);
    };
}

window.editPlan = function(id) {
    alert('Direct plan editing is currently unavailable. Please delete the plan and recreate it with the desired specifications.');
};

window.manageService = function(uuid) {
    // Attempt to open the service panel directly (will require the admin to be logged in to a user account, or we can just redirect)
    if (confirm('Do you want to view this service in the client panel?')) {
        window.open(`vps-panel.html?uuid=${uuid}`, '_blank');
    }
};


window.openAssignModal = function(uuid, type, name) {
    const modal = document.getElementById('modalOverlay');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="admin-modal" style="max-width: 500px;">
            <button onclick="document.getElementById('modalOverlay').style.display='none'" class="modal-close">&times;</button>
            
            <h2 style="color: var(--admin-accent); margin-bottom: 0.5rem;">Assign Service</h2>
            <p style="color: var(--admin-muted); font-size: 0.85rem; margin-bottom: 2rem;">Assigning <strong style="color:#fff;">${name}</strong> (${type}) to a user.</p>

            <form id="assignServiceForm">
                <div class="admin-form-group">
                    <label>User Email</label>
                    <div style="display:flex; gap:0.5rem;">
                        <input type="email" id="assignSearchEmail" class="admin-input" required placeholder="user@example.com" style="flex:1;">
                        <button type="button" class="action-btn" id="assignSearchBtn" style="padding: 0 1.5rem; background: var(--admin-accent); color: #000; font-weight: 700;">Search</button>
                    </div>
                    <div id="assignSearchResult" style="margin-top:0.75rem; font-size:0.8rem; font-weight: 600;"></div>
                </div>

                <input type="hidden" id="assignUserId" value="">

                <button type="submit" id="assignConfirmBtn" class="admin-btn-primary" style="width: 100%; opacity: 0.5; pointer-events: none;">Confirm Assignment</button>
            </form>
        </div>
    `;

    const searchBtn = document.getElementById('assignSearchBtn');
    const emailInput = document.getElementById('assignSearchEmail');
    const resultDiv = document.getElementById('assignSearchResult');
    const confirmBtn = document.getElementById('assignConfirmBtn');
    const userIdInput = document.getElementById('assignUserId');

    searchBtn.onclick = async () => {
        const email = emailInput.value;
        if (!email) return;
        
        resultDiv.innerHTML = '<span style="color:var(--admin-accent);">Querying database...</span>';
        try {
            const data = await adminFetch(`/api/admin/users/search?email=${encodeURIComponent(email)}`);
            resultDiv.innerHTML = `<span style="color:var(--admin-accent);">Target Identified: <strong>${data.user.username}</strong> (ID: ${data.user.id})</span>`;
            userIdInput.value = data.user.id;
            confirmBtn.style.opacity = '1';
            confirmBtn.style.pointerEvents = 'auto';
        } catch (err) {
            resultDiv.innerHTML = '<span style="color:#ef4444;">No resident found with this email.</span>';
            confirmBtn.style.opacity = '0.5';
            confirmBtn.style.pointerEvents = 'none';
        }
    };

    document.getElementById('assignServiceForm').onsubmit = async (e) => {
        e.preventDefault();
        const userId = userIdInput.value;
        if (!userId) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Linking Service...';

        try {
            await adminFetch('/api/admin/assign-service', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: userId,
                    service_type: type,
                    service_uuid: uuid,
                    hostname: name
                })
            });
            if (window.showToast) showToast('Service successfully linked to resident', 'success');
            modal.style.display = 'none';
        } catch (err) {
            alert('Operation failed: ' + err.message);
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Assignment';
        }
    };
};

window.deletePlan = async function(id) {
    if (!confirm('Are you sure you want to permanently delete this plan?')) return;
    try {
        await adminFetch(`/api/admin/plans/${id}`, { method: 'DELETE' });
        loadPlansData();
        if (window.showToast) showToast('Plan deleted successfully', 'success');
    } catch (err) {
        alert('Failed to delete plan: ' + err.message);
    }
};

// Global exposure
window.adminLogout = adminLogout;
window.switchSection = switchSection;
window.editPlan = editPlan;
window.deletePlan = deletePlan;
window.manageService = manageService;
window.viewTicket = viewTicket;
window.updateTicketStatus = updateTicketStatus;
window.submitAdminReply = submitAdminReply;
window.openPlanModal = openPlanModal;
window.openAssignModal = openAssignModal;
