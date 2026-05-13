const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const RATE_LIMIT_PER_MINUTE = 120;
const DEFAULT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 2500;
const DEFAULT_POLL_TIMEOUT_MS = 120000;

function encryptableEnvValue(plainKey, encryptedKey, ivKey, authTagKey, cipherKey) {
  if (process.env[plainKey]) {
    return process.env[plainKey];
  }

  const encrypted = process.env[encryptedKey];
  const iv = process.env[ivKey];
  const authTag = process.env[authTagKey];
  const secret = process.env[cipherKey];

  if (!encrypted || !iv || !authTag || !secret) {
    return '';
  }

  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function randomPassword(length = 20) {
  return crypto.randomBytes(Math.max(12, length)).toString('base64url').slice(0, length);
}

function pickServerState(server) {
  if (!server) return 'unknown';
  const attrs = server.attributes || server;
  if (attrs.suspended) return 'suspended';
  if (typeof attrs.status === 'string' && attrs.status.trim()) {
    return attrs.status.trim().toLowerCase();
  }
  if (attrs.container?.installed === false || attrs.container?.installed === 0) return 'installing';
  if (attrs.container?.installed === true || attrs.container?.installed === 1) return 'active';
  return 'unknown';
}

function pteroErrorPayload(err) {
  return err?.response?.data?.errors || err?.response?.data || { message: err.message };
}

function normalizeServerAttributes(server) {
  return server?.attributes || server?.data?.attributes || server || {};
}

function validateProvisionedServerSpec(server, expected) {
  const attrs = normalizeServerAttributes(server);
  const actualLimits = attrs.limits || {};
  const actualEggId = Number(attrs.egg || attrs.egg_id || attrs.relationships?.egg?.attributes?.id || 0);
  const actualName = String(attrs.name || '').trim();
  const errors = [];

  if (actualName && actualName !== String(expected.name || '').trim()) {
    errors.push(`name expected "${expected.name}" but received "${actualName}"`);
  }
  if (Number(actualLimits.memory || 0) !== Number(expected.memory || 0)) {
    errors.push(`memory expected ${expected.memory} but received ${actualLimits.memory ?? 'unknown'}`);
  }
  if (Number(actualLimits.disk || 0) !== Number(expected.disk || 0)) {
    errors.push(`disk expected ${expected.disk} but received ${actualLimits.disk ?? 'unknown'}`);
  }
  if (Number(actualLimits.cpu || 0) !== Number(expected.cpu || 0)) {
    errors.push(`cpu expected ${expected.cpu} but received ${actualLimits.cpu ?? 'unknown'}`);
  }
  if (actualEggId && Number(actualEggId) !== Number(expected.eggId || 0)) {
    errors.push(`egg expected ${expected.eggId} but received ${actualEggId}`);
  }

  if (errors.length > 0) {
    const err = new Error(`Provisioned server validation failed: ${errors.join('; ')}`);
    err.validation = {
      expected,
      actual: {
        name: actualName || null,
        memory: Number(actualLimits.memory || 0),
        disk: Number(actualLimits.disk || 0),
        cpu: Number(actualLimits.cpu || 0),
        eggId: actualEggId || null
      }
    };
    throw err;
  }
}

class PterodactylAdminClient {
  constructor(options = {}) {
    this.delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.requestTransport = options.requestTransport || ((config) => axios.request(config));
    this.rateLimit = options.rateLimit || RATE_LIMIT_PER_MINUTE;
    this.requestTimestamps = [];
    this.rateChain = Promise.resolve();
    this.refreshConfig();
  }

  refreshConfig() {
    this.enabled = process.env.ADMIN_PTERODACTYL_ENABLED === 'true';
    this.panelUrl = normalizeBaseUrl(
      encryptableEnvValue(
        'PTERODACTYL_URL',
        'PTERODACTYL_URL_ENCRYPTED',
        'PTERODACTYL_URL_IV',
        'PTERODACTYL_URL_AUTH_TAG',
        'PTERODACTYL_SECRETS_KEY'
      )
    );
    this.applicationKey = encryptableEnvValue(
      'PTERODACTYL_API_KEY',
      'PTERODACTYL_API_KEY_ENCRYPTED',
      'PTERODACTYL_API_KEY_IV',
      'PTERODACTYL_API_KEY_AUTH_TAG',
      'PTERODACTYL_SECRETS_KEY'
    );
    this.clientKey = encryptableEnvValue(
      'PTERODACTYL_CLIENT_KEY',
      'PTERODACTYL_CLIENT_KEY_ENCRYPTED',
      'PTERODACTYL_CLIENT_KEY_IV',
      'PTERODACTYL_CLIENT_KEY_AUTH_TAG',
      'PTERODACTYL_SECRETS_KEY'
    );
    this.signatureSecret = encryptableEnvValue(
      'PTERODACTYL_REQUEST_SIGNING_SECRET',
      'PTERODACTYL_REQUEST_SIGNING_SECRET_ENCRYPTED',
      'PTERODACTYL_REQUEST_SIGNING_SECRET_IV',
      'PTERODACTYL_REQUEST_SIGNING_SECRET_AUTH_TAG',
      'PTERODACTYL_SECRETS_KEY'
    ) || this.applicationKey || this.clientKey || 'host1top-ptero-signing';
  }

  assertEnabled() {
    if (!this.enabled) {
      throw new Error('Pterodactyl admin integration is disabled');
    }
    if (!this.panelUrl || !this.applicationKey) {
      throw new Error('Pterodactyl application configuration is incomplete');
    }
  }

  async waitForRateSlot() {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => now - timestamp < 60000);

    if (this.requestTimestamps.length < this.rateLimit) {
      this.requestTimestamps.push(now);
      return;
    }

    const waitMs = 60000 - (now - this.requestTimestamps[0]) + 5;
    await this.delay(waitMs);
    return this.waitForRateSlot();
  }

  async scheduleRateLimitedRequest() {
    const previous = this.rateChain;
    let release;
    this.rateChain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    await this.waitForRateSlot();
    release();
  }

  buildSignedHeaders(method, requestPath, body) {
    const timestamp = String(Date.now());
    const payload = body ? JSON.stringify(body) : '';
    const signature = crypto
      .createHmac('sha256', this.signatureSecret)
      .update([method.toUpperCase(), requestPath, timestamp, payload].join(':'))
      .digest('hex');

    return {
      'X-Host1Top-Signature': signature,
      'X-Host1Top-Timestamp': timestamp
    };
  }

  async rawRequest({ apiType, method = 'GET', path, data, params, retrying = false }) {
    this.assertEnabled();
    await this.scheduleRateLimitedRequest();

    const token = apiType === 'client' ? this.clientKey : this.applicationKey;
    if (!token) {
      throw new Error(`Missing Pterodactyl ${apiType} API token`);
    }

    const requestPath = apiType === 'client'
      ? `/api/client${path}`
      : `/api/application${path}`;

    try {
      const response = await this.requestTransport({
        method,
        baseURL: this.panelUrl,
        url: requestPath,
        params,
        data,
        timeout: DEFAULT_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
          ...this.buildSignedHeaders(method, requestPath, data)
        }
      });

      return response.data;
    } catch (err) {
      if (!retrying && (err.response?.status === 401 || err.response?.status === 403)) {
        this.refreshConfig();
        return this.rawRequest({ apiType, method, path, data, params, retrying: true });
      }
      throw err;
    }
  }

  applicationRequest(config) {
    return this.rawRequest({ ...config, apiType: 'application' });
  }

  clientRequest(config) {
    return this.rawRequest({ ...config, apiType: 'client' });
  }

  async listPaginatedApplication(path, params = {}) {
    let page = 1;
    const items = [];
    while (true) {
      const data = await this.applicationRequest({ method: 'GET', path, params: { ...params, page } });
      items.push(...(data.data || []));
      if (!data.meta?.pagination || page >= data.meta.pagination.total_pages) break;
      page += 1;
    }
    return items;
  }

  async listNests() {
    return this.listPaginatedApplication('/nests');
  }

  async listEggs(nestId) {
    return this.listPaginatedApplication(`/nests/${nestId}/eggs`);
  }

  async listNodes() {
    return this.listPaginatedApplication('/nodes', { include: 'allocations,location,servers' });
  }

  async getNode(nodeId) {
    return this.applicationRequest({ method: 'GET', path: `/nodes/${nodeId}`, params: { include: 'allocations,location,servers' } });
  }

  async listServers() {
    return this.listPaginatedApplication('/servers', { include: 'node,egg,user,allocations' });
  }

  async getEggDetails(nestId, eggId) {
    return this.applicationRequest({
      method: 'GET',
      path: `/nests/${nestId}/eggs/${eggId}`,
      params: { include: 'variables' }
    });
  }

  async getServer(serverId) {
    return this.applicationRequest({ method: 'GET', path: `/servers/${serverId}`, params: { include: 'node,egg,user,allocations' } });
  }

  async findUserByExternalId(externalId) {
    if (!externalId) return null;
    try {
      const data = await this.applicationRequest({
        method: 'GET',
        path: `/users/external/${encodeURIComponent(externalId)}`
      });
      return data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  async findUserByEmail(email) {
    const data = await this.applicationRequest({
      method: 'GET',
      path: '/users',
      params: { 'filter[email]': email }
    });
    const users = data.data || [];
    return users.find((entry) => entry.attributes?.email === email) || users[0] || null;
  }

  async createUser({ email, username, firstName, lastName, password, externalId }) {
    return this.applicationRequest({
      method: 'POST',
      path: '/users',
      data: {
        email,
        username,
        first_name: firstName,
        last_name: lastName,
        password,
        external_id: externalId ? String(externalId) : undefined
      }
    });
  }

  async ensureUserByEmail({ email, username, firstName, lastName, password, externalId }) {
    const existingByExternalId = await this.findUserByExternalId(externalId);
    if (existingByExternalId?.attributes || existingByExternalId?.data?.attributes) {
      return {
        created: false,
        generatedPassword: null,
        user: { attributes: existingByExternalId.attributes || existingByExternalId.data.attributes }
      };
    }

    const existing = await this.findUserByEmail(email);
    if (existing) {
      return {
        created: false,
        generatedPassword: null,
        user: existing
      };
    }

    const generatedPassword = password || randomPassword();
    const createdUser = await this.createUser({
      email,
      username,
      firstName,
      lastName,
      password: generatedPassword,
      externalId
    });

    return {
      created: true,
      generatedPassword,
      user: { attributes: createdUser.attributes || createdUser.data?.attributes || createdUser }
    };
  }

  async resetUserPassword(pteroUserId, password) {
    return this.applicationRequest({
      method: 'PATCH',
      path: `/users/${pteroUserId}`,
      data: { password }
    });
  }

  async getAvailableAllocation(nodeId) {
    const allocations = await this.listPaginatedApplication(`/nodes/${nodeId}/allocations`, { per_page: 100 });
    const available = allocations.filter((allocation) => {
      const attrs = allocation.attributes || {};
      return !attrs.assigned && (attrs.server_id === null || attrs.server_id === undefined || Number(attrs.server_id) === 0);
    });

    if (available.length > 0) {
      return available[0];
    }

    const fallback = allocations.find((allocation) => {
      const attrs = allocation.attributes || {};
      return !attrs.assigned;
    });

    if (fallback) {
      return fallback;
    }

    const listResponse = await this.applicationRequest({
      method: 'GET',
      path: `/nodes/${nodeId}/allocations`,
      params: { 'filter[server_id]': 0, per_page: 100 }
    });
    const serverFiltered = listResponse.data || [];
    return serverFiltered[0] || allocations[0] || null;
  }

  calculateNodeAvailability(node) {
    const attrs = node.attributes || node;
    const servers = attrs.relationships?.servers?.data || [];
    const allocatedMemory = servers.reduce((sum, server) => sum + Number(server.attributes?.limits?.memory || 0), 0);
    const allocatedDisk = servers.reduce((sum, server) => sum + Number(server.attributes?.limits?.disk || 0), 0);
    return {
      freeMemory: Number(attrs.memory || 0) - allocatedMemory,
      freeDisk: Number(attrs.disk || 0) - allocatedDisk
    };
  }

  async runPreflight({ nodeId, memory, disk }) {
    const node = await this.getNode(nodeId);
    const allocation = await this.getAvailableAllocation(nodeId);
    const capacity = this.calculateNodeAvailability(node);

    if (!allocation) {
      throw new Error(`No free allocation found on node ${nodeId}`);
    }
    if (capacity.freeMemory < Number(memory || 0)) {
      throw new Error(`Node ${nodeId} does not have enough free memory`);
    }
    if (capacity.freeDisk < Number(disk || 0)) {
      throw new Error(`Node ${nodeId} does not have enough free disk`);
    }

    return { node, allocation, capacity };
  }

  async selectProvisionNode({ preferredNodeId, memory, disk }) {
    const candidateIds = [];
    if (Number.isInteger(Number(preferredNodeId)) && Number(preferredNodeId) > 0) {
      candidateIds.push(Number(preferredNodeId));
    }

    const nodes = await this.listNodes();
    for (const node of nodes) {
      const nodeId = Number(node.attributes?.id);
      if (nodeId && !candidateIds.includes(nodeId)) {
        candidateIds.push(nodeId);
      }
    }

    let lastError;
    for (const candidateId of candidateIds) {
      try {
        const preflight = await this.runPreflight({ nodeId: candidateId, memory, disk });
        return { nodeId: candidateId, ...preflight };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('No viable Pterodactyl node found for this server');
  }

  async createServer(payload) {
    return this.applicationRequest({
      method: 'POST',
      path: '/servers',
      data: payload
    });
  }

  async deleteServer(serverId, force = true) {
    return this.applicationRequest({
      method: 'DELETE',
      path: `/servers/${serverId}`,
      params: force ? { force: true } : undefined
    });
  }

  async setServerPower(serverIdentifier, signal) {
    return this.clientRequest({
      method: 'POST',
      path: `/servers/${serverIdentifier}/power`,
      data: { signal }
    });
  }

  async getWebsocketCredentials(serverIdentifier) {
    return this.clientRequest({
      method: 'GET',
      path: `/servers/${serverIdentifier}/websocket`
    });
  }

  async getSftpDetails(serverIdentifier) {
    try {
      return await this.clientRequest({
        method: 'GET',
        path: `/servers/${serverIdentifier}/sftp`
      });
    } catch (err) {
      return {
        data: {
          sftp_details: {
            ip: new URL(this.panelUrl).hostname,
            port: 2022,
            username: serverIdentifier
          }
        }
      };
    }
  }

  async waitForLifecycle(serverId, options = {}) {
    const timeoutMs = Number(options.timeoutMs || DEFAULT_POLL_TIMEOUT_MS);
    const acceptInstalling = options.acceptInstalling === true;
    const start = Date.now();
    let lifecycle = 'unknown';
    let lastServer = null;

    while (Date.now() - start < timeoutMs) {
      const server = await this.getServer(serverId);
      lastServer = server;
      lifecycle = pickServerState(server);
      if (lifecycle === 'active') {
        return { lifecycle, server };
      }
      if (acceptInstalling && lifecycle === 'installing') {
        return { lifecycle, server };
      }
      await this.delay(POLL_INTERVAL_MS);
    }

    if (acceptInstalling && lastServer) {
      return { lifecycle, server: lastServer };
    }

    throw new Error(`Timed out waiting for server ${serverId} to become ready (last state: ${lifecycle})`);
  }

  async provisionGameServer(input) {
    const {
      localUserId,
      email,
      username,
      firstName,
      lastName,
      nodeId,
      eggId,
      nestId,
      name,
      memory,
      disk,
      cpu,
      swap = 0,
      io = 500,
      databases = 1,
      backups = 1,
      allocations = 1,
      userExternalId,
      serverExternalId,
      dockerImage,
      startup,
      environment = {},
      externalId
    } = input;

    const userBinding = await this.ensureUserByEmail({
      email,
      username,
      firstName,
      lastName,
      externalId: userExternalId || `host1top-user-${localUserId}`,
      password: input.password
    });

    const selectedNode = await this.selectProvisionNode({ preferredNodeId: nodeId, memory, disk });
    const { allocation } = selectedNode;
    const eggDetails = await this.getEggDetails(nestId, eggId);
    const eggAttributes = eggDetails.attributes || eggDetails.data?.attributes || {};
    const eggVariables = eggAttributes.relationships?.variables?.data || [];
    const mergedEnvironment = {};
    for (const variable of eggVariables) {
      const attrs = variable.attributes || {};
      mergedEnvironment[attrs.env_variable] = attrs.default_value || '';
    }
    Object.assign(mergedEnvironment, environment || {});

    const payload = {
      name,
      user: Number(userBinding.user.attributes.id),
      egg: Number(eggId),
      nest: Number(nestId),
      allocation: {
        default: Number(allocation.attributes.id)
      },
      limits: {
        memory: Number(memory),
        swap: Number(swap),
        disk: Number(disk),
        io: Number(io),
        cpu: Number(cpu)
      },
      feature_limits: {
        databases: Number(databases),
        backups: Number(backups),
        allocations: Number(allocations)
      },
      environment: mergedEnvironment,
      start_on_completion: true,
      external_id: serverExternalId || (externalId ? String(externalId) : undefined)
    };

    payload.docker_image = dockerImage || eggAttributes.docker_image;
    payload.startup = startup || eggAttributes.startup;

    let createdServer;
    let createdServerAttrs = null;
    try {
      createdServer = await this.createServer(payload);
      const serverAttributes = normalizeServerAttributes(createdServer);
      createdServerAttrs = serverAttributes;
      const lifecycle = await this.waitForLifecycle(serverAttributes.id, {
        timeoutMs: 15000,
        acceptInstalling: true
      });
      const lifecycleServer = normalizeServerAttributes(lifecycle.server);
      validateProvisionedServerSpec(lifecycleServer, {
        name,
        memory,
        disk,
        cpu,
        eggId
      });
      const sftp = await this.getSftpDetails(serverAttributes.identifier || serverAttributes.uuid?.split('-')[0]);

      return {
        created: true,
        lifecycle: lifecycle.lifecycle,
        server: lifecycleServer,
        pterodactylUser: userBinding.user.attributes,
        generatedPassword: userBinding.generatedPassword,
        sftp: sftp.data?.sftp_details || sftp.attributes?.sftp_details || sftp.sftp_details || {},
        allocationId: Number(allocation.attributes.id),
        nodeId: Number(selectedNode.nodeId),
        eggName: String(eggAttributes.name || ''),
        requestedSpec: { name, memory: Number(memory), disk: Number(disk), cpu: Number(cpu), eggId: Number(eggId) }
      };
    } catch (err) {
      if (createdServerAttrs?.id) {
        try {
          await this.deleteServer(createdServerAttrs.id, true);
        } catch (rollbackErr) {
          err.rollbackError = pteroErrorPayload(rollbackErr);
        }
      }
      throw err;
    }
  }
}

module.exports = {
  PterodactylAdminClient,
  pteroErrorPayload,
  pickServerState,
  randomPassword
};
