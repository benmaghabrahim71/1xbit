const axios = require('axios');
require('dotenv').config();

const panelUrl = (process.env.PTERODACTYL_URL || '').replace(/\/$/, '');
const appKey  = process.env.PTERODACTYL_API_KEY;    // Application API Key
const clientKey = process.env.PTERODACTYL_CLIENT_KEY; // Client API Key

console.log(`[Ptero:Config] URL: ${panelUrl || 'MISSING'}`);
if (!panelUrl || !panelUrl.startsWith('http')) {
  console.warn('[Ptero:Config] PTERODACTYL_URL is invalid or missing. Requests will likely fail.');
}

// ── Axios instances ──────────────────────────────────────────────────────────

const appApi = axios.create({
  baseURL: `${panelUrl}/api/application`,
  headers: {
    'Authorization': `Bearer ${appKey}`,
    'Content-Type': 'application/json',
    'Accept': 'Application/vnd.pterodactyl.v1+json'
  },
  timeout: 15000
});

const clientApi = axios.create({
  baseURL: `${panelUrl}/api/client`,
  headers: {
    'Authorization': `Bearer ${clientKey}`,
    'Content-Type': 'application/json',
    'Accept': 'Application/vnd.pterodactyl.v1+json'
  },
  timeout: 15000
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function logError(context, err) {
  if (err.response) {
    console.error(`[Ptero:${context}] HTTP ${err.response.status}:`, JSON.stringify(err.response.data));
  } else {
    console.error(`[Ptero:${context}]`, err.message);
  }
}

/**
 * Find a Pterodactyl user by their external ID (host1top user ID).
 * Falls back to searching by email if not found externally.
 * Creates the user if they don't exist at all.
 */
async function findOrCreatePteroUser(userId, userEmail, firstName = 'User', lastName = 'Client') {
  // 1. Try external ID lookup (fastest)
  try {
    const extRes = await appApi.get(`/users/external/${userId}`);
    if (extRes.status === 200) {
      console.log(`[Ptero:user] Found by external ID ${userId} → ptero uid ${extRes.data.attributes.id}`);
      return extRes.data.attributes.id;
    }
  } catch (e) {
    if (e.response?.status !== 404) throw e;
  }

  // 2. Search by email
  try {
    const searchRes = await appApi.get(`/users?filter[email]=${encodeURIComponent(userEmail)}`);
    const users = searchRes.data?.data || [];
    if (users.length > 0) {
      const match = users.find(u => u.attributes.email === userEmail) || users[0];
      console.log(`[Ptero:user] Found by email ${userEmail} → ptero uid ${match.attributes.id}`);
      return match.attributes.id;
    }
  } catch (e) {
    logError('findUser/email', e);
  }

  // 3. Create new user
  const username = `h1t_${userId}_${Math.random().toString(36).slice(2, 6)}`;
  const createRes = await appApi.post('/users', {
    username,
    email: userEmail,
    first_name: firstName || 'User',
    last_name: lastName || 'Client',
    external_id: String(userId)
  });

  if (createRes.status !== 201) {
    throw new Error(`Failed to create Pterodactyl user, status: ${createRes.status}`);
  }
  console.log(`[Ptero:user] Created new user ${username} → ptero uid ${createRes.data.attributes.id}`);
  return createRes.data.attributes.id;
}

/**
 * Fetch egg data including variables from the panel.
 * Returns { dockerImage, startup, environment }
 */
async function fetchEggData(nestId, eggId) {
  const res = await appApi.get(`/nests/${nestId}/eggs/${eggId}?include=variables`);
  if (res.status !== 200) {
    throw new Error(`Failed to fetch egg ${eggId} from nest ${nestId}, status: ${res.status}`);
  }
  const attrs = res.data.attributes;
  const variables = attrs.relationships?.variables?.data || [];

  const environment = {};
  for (const varData of variables) {
    const v = varData.attributes;
    environment[v.env_variable] = v.default_value || '';
  }

  return {
    dockerImage: attrs.docker_image,
    startup: attrs.startup,
    environment
  };
}

// ── Main Service ─────────────────────────────────────────────────────────────

const pterodactylService = {
  async clientRequest(config) {
    try {
      const res = await clientApi.request(config);
      return res.data;
    } catch (err) { logError('clientRequest', err); throw err; }
  },


  /**
   * Full server creation flow — mirrors the WHMCS module logic:
   *  1. Find or create the Pterodactyl user by host1top userId + email.
   *  2. Fetch egg variables to build the environment.
   *  3. POST /servers with nest+egg+environment+deploy.
   *
   * @param {object} opts
   *   userId        – host1top user ID (used as external_id)
   *   userEmail     – user's email (used to look up / create ptero user)
   *   firstName     – (optional)
   *   lastName      – (optional)
   *   name          – server display name
   *   nestId        – Pterodactyl nest ID (required)
   *   eggId         – Pterodactyl egg ID (required)
   *   locationId    – deploy location ID (default 1)
   *   memory        – MB (default 1024)
   *   swap          – MB (default 0)
   *   io            – block IO (default 500)
   *   cpu           – % limit (default 100)
   *   disk          – MB (default 2048)
   *   databases     – feature limit (default 1)
   *   backups       – feature limit (default 1)
   *   allocations   – feature limit (default 1)
   *   dedicatedIp   – bool (default false)
   *   portRange     – string e.g. "25565-25570" (optional)
   *   dockerImage   – override egg default (optional)
   *   startup       – override egg default (optional)
   *   environment   – key:value overrides merged on top of egg defaults (optional)
   *   serviceId     – host1top subscription ID (used as external_id on server)
   *   startOnCompletion – bool (default true)
   */
  async createServer(opts) {
    const {
      userId,
      userEmail,
      firstName,
      lastName,
      name,
      nestId,
      eggId,
      locationId    = 1,
      nodeId,         // Optional: Direct node selection
      memory        = 1024,
      swap          = 0,
      io            = 500,
      cpu           = 100,
      disk          = 2048,
      databases     = 1,
      backups       = 1,
      allocations   = 1,
      additionalPorts = 0, // Request extra ports after creation
      dedicatedIp   = false,
      portRange     = '',
      environment   = {},
      serviceId,
      startOnCompletion = true,
    } = opts;

    if (!nestId || !eggId) throw new Error('nestId and eggId are required for Pterodactyl server creation');

    // 1. Resolve user
    const pteroUserId = await findOrCreatePteroUser(userId, userEmail, firstName, lastName);

    // 2. Resolve egg data
    const eggData = await fetchEggData(nestId, eggId);

    // 3. Merge environment: egg defaults < caller overrides
    const finalEnv = { ...eggData.environment };
    for (const key in environment) {
      if (environment[key] !== undefined && environment[key] !== '') {
        finalEnv[key] = environment[key];
      }
    }

    // 4. Parse port range
    const portRangeArr = portRange
      ? portRange.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    // 5. Build payload
    const payload = {
      name:         name || `server-${serviceId || userId}`,
      user:         parseInt(pteroUserId),
      nest:         parseInt(nestId),
      egg:          parseInt(eggId),
      docker_image: opts.dockerImage || eggData.dockerImage,
      startup:      opts.startup     || eggData.startup,
      oom_disabled: false,
      node_id:      nodeId === 0 ? 0 : (nodeId || 0), // User requested node idd 0
      limits: {
        memory:  parseInt(memory),
        swap:    parseInt(swap),
        io:      parseInt(io),
        cpu:     parseInt(cpu),
        disk:    parseInt(disk),
      },
      feature_limits: {
        databases:   parseInt(databases),
        backups:     parseInt(backups),
        allocations: parseInt(allocations) + parseInt(additionalPorts),
      },
      deploy: {
        locations:    (nodeId || locationId === 0) ? [] : [parseInt(locationId)],
        nodes:        (nodeId && nodeId !== 0) ? [parseInt(nodeId)] : [],
        dedicated_ip: Boolean(dedicatedIp),
        port_range:   portRangeArr,
      },
      environment:         finalEnv,
      start_on_completion: Boolean(startOnCompletion),
      external_id:         serviceId ? String(serviceId) : undefined,
    };

    console.log('[Ptero:createServer] Payload:', JSON.stringify(payload, null, 2));

    try {
      const res = await appApi.post('/servers?include=allocations', payload);
      
      const serverId = res.data.attributes.id;
      const serverUuid = res.data.attributes.uuid;

      // 6. Assign additional ports if requested
      if (additionalPorts > 0) {
        console.log(`[Ptero:createServer] Assigning ${additionalPorts} additional ports to server ${serverId}...`);
        try {
          await this.assignAdditionalAllocations(serverId, additionalPorts);
        } catch (allocErr) {
          console.warn(`[Ptero:createServer] Failed to assign additional ports: ${allocErr.message}`);
        }
      }

      // 7. Auto-create database if requested
      if (databases > 0) {
        console.log(`[Ptero:createServer] Auto-creating initial database for server ${serverId}...`);
        try {
          await appApi.post(`/servers/${serverId}/databases`, {
            database: 'db_1',
            remote: '%',
            host: 1 
          }).catch(e => console.warn('Database auto-create warning:', e.message));
        } catch (dbErr) {
          console.warn(`[Ptero:createServer] Failed to create database: ${dbErr.message}`);
        }
      }

      console.log(`[Ptero:createServer] Created → UUID ${serverUuid}`);
      return res.data;
    } catch (err) {
      const errorData = err.response?.data;
      const errorString = JSON.stringify(errorData || {});
      
      console.error('[Ptero:createServer] API Error:', errorString);

      if (err.response?.status === 400 && errorString.includes('NoViableNodeException')) {
        // If it failed with auto-deploy and we haven't tried a specific node yet
        if (!nodeId || nodeId === 0) {
          console.log('[Ptero:createServer] Auto-deploy failed. Retrying with explicit Node ID 1...');
          return this.createServer({ ...opts, nodeId: 1 });
        }
      }
      throw err;
    }
  },

  async assignAdditionalAllocations(serverId, count) {
    try {
      const serverRes = await appApi.get(`/servers/${serverId}`);
      const nodeId = serverRes.data.attributes.node;
      
      const nodeAllocRes = await appApi.get(`/nodes/${nodeId}/allocations?filter[server_id]=0`);
      const available = nodeAllocRes.data.data;
      
      if (available.length < count) {
        console.warn(`[Ptero] Only ${available.length} allocations available on node ${nodeId}, but ${count} requested.`);
      }
      
      const toAssign = available.slice(0, count);
      for (const alloc of toAssign) {
        console.log(`[Ptero] Assigning allocation ${alloc.attributes.id} to server ${serverId}...`);
        await appApi.put(`/servers/${serverId}/build/network`, {
          allocation: serverRes.data.attributes.allocation,
          add_allocations: [alloc.attributes.id]
        });
      }
    } catch (e) {
      const errData = e.response?.data;
      console.warn('[Ptero] Additional allocation assignment failed:', JSON.stringify(errData || e.message));
    }
  },

  /** List all servers (Application API) */
  async listServers() {
    try {
      const res = await appApi.get('/servers');
      return res.data;
    } catch (err) { logError('listServers', err); throw err; }
  },

  /** Get server by external ID (host1top serviceId) */
  async getServerByExternalId(serviceId) {
    try {
      const res = await appApi.get(`/servers/external/${serviceId}`);
      return res.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      logError('getServerByExternalId', err); throw err;
    }
  },

  /** Suspend server */
  async suspendServer(serverId) {
    try {
      await appApi.post(`/servers/${serverId}/suspend`);
    } catch (err) { logError('suspendServer', err); throw err; }
  },

  /** Unsuspend server */
  async unsuspendServer(serverId) {
    try {
      await appApi.post(`/servers/${serverId}/unsuspend`);
    } catch (err) { logError('unsuspendServer', err); throw err; }
  },

  /** Delete server */
  async deleteServer(serverId) {
    try {
      await appApi.delete(`/servers/${serverId}`);
    } catch (err) { logError('deleteServer', err); throw err; }
  },

  // ── Client API ──────────────────────────────────────────────────────────────

  async setPowerState(serverIdentifier, signal) {
    try {
      const res = await clientApi.post(`/servers/${serverIdentifier}/power`, { signal });
      return res.data;
    } catch (err) { logError('setPowerState', err); throw err; }
  },

  async getServerStatus(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/resources`);
      return res.data;
    } catch (err) { logError('getServerStatus', err); throw err; }
  },

  async sendCommand(serverIdentifier, command) {
    try {
      const res = await clientApi.post(`/servers/${serverIdentifier}/command`, { command });
      return res.data;
    } catch (err) { logError('sendCommand', err); throw err; }
  },

  async getFiles(serverIdentifier, directory = '/') {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/files/list`, {
        params: { directory }
      });
      return res.data;
    } catch (err) { logError('getFiles', err); throw err; }
  },

  async getFileContents(serverIdentifier, filePath) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/files/contents`, {
        params: { file: filePath }
      });
      return res.data;
    } catch (err) { logError('getFileContents', err); throw err; }
  },

  async writeFile(serverIdentifier, filePath, contents) {
    try {
      const res = await clientApi.post(`/servers/${serverIdentifier}/files/write`, contents, {
        params: { file: filePath },
        headers: { 'Content-Type': 'text/plain' }
      });
      return res.data;
    } catch (err) { logError('writeFile', err); throw err; }
  },

  async getDatabases(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/databases`);
      return res.data;
    } catch (err) { logError('getDatabases', err); throw err; }
  },

  async createDatabase(serverIdentifier, payload) {
    try {
      const res = await clientApi.post(`/servers/${serverIdentifier}/databases`, payload);
      return res.data;
    } catch (err) { logError('createDatabase', err); throw err; }
  },

  async deleteDatabase(serverIdentifier, databaseId) {
    try {
      const res = await clientApi.delete(`/servers/${serverIdentifier}/databases/${databaseId}`);
      return res.data;
    } catch (err) { logError('deleteDatabase', err); throw err; }
  },

  async getBackups(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/backups`);
      return res.data;
    } catch (err) { logError('getBackups', err); throw err; }
  },

  async createBackup(serverIdentifier, payload = {}) {
    try {
      const res = await clientApi.post(`/servers/${serverIdentifier}/backups`, payload);
      return res.data;
    } catch (err) { logError('createBackup', err); throw err; }
  },

  async deleteBackup(serverIdentifier, backupId) {
    try {
      const res = await clientApi.delete(`/servers/${serverIdentifier}/backups/${backupId}`);
      return res.data;
    } catch (err) { logError('deleteBackup', err); throw err; }
  },

  async getBackupDownload(serverIdentifier, backupId) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/backups/${backupId}/download`);
      return res.data;
    } catch (err) { logError('getBackupDownload', err); throw err; }
  },

  async getNetworkAllocations(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/network/allocations`);
      return res.data;
    } catch (err) { logError('getNetworkAllocations', err); throw err; }
  },

  async getStartupVariables(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/startup`);
      return res.data;
    } catch (err) { logError('getStartupVariables', err); throw err; }
  },

  async getWebsocketCredentials(serverIdentifier) {
    try {
      const res = await clientApi.get(`/servers/${serverIdentifier}/websocket`);
      return res.data;
    } catch (err) { logError('getWebsocketCredentials', err); throw err; }
  },

  async renameFiles(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/rename`,
      data: payload
    });
  },

  async copyFile(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/copy`,
      data: payload
    });
  },

  async deleteFiles(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/delete`,
      data: payload
    });
  },

  async compressFiles(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/compress`,
      data: payload
    });
  },

  async decompressFile(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/decompress`,
      data: payload
    });
  },

  async chmodFiles(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/chmod`,
      data: payload
    });
  },

  async createFolder(serverIdentifier, payload) {
    return this.clientRequest({
      method: 'POST',
      url: `/servers/${serverIdentifier}/files/create-folder`,
      data: payload
    });
  },

  async getUploadUrl(serverIdentifier) {
    return this.clientRequest({
      method: 'GET',
      url: `/servers/${serverIdentifier}/files/upload`
    });
  },

  async getDownloadUrl(serverIdentifier, filePath) {
    return this.clientRequest({
      method: 'GET',
      url: `/servers/${serverIdentifier}/files/download`,
      params: { file: filePath }
    });
  }
};

module.exports = pterodactylService;
