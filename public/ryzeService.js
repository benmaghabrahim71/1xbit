const axios = require('axios');
require('dotenv').config();

const ryzeUrl = process.env.RYZE_API_URL || 'https://dash.ryzehosting.com/api/v2';
const ryzeKey = process.env.RYZE_API_KEY;

if (!ryzeKey) {
  console.warn('RYZE_API_KEY is not configured. Ryze API calls will fail.');
}

const ryzeApi = axios.create({
  baseURL: ryzeUrl.replace(/\/+$/, ''),
  headers: {
    'Authorization': `Bearer ${ryzeKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

/**
 * Ryze v2 API often expects UUIDs without dashes.
 * @param {string} uuid 
 * @returns {string}
 */
const normalizeUuid = (uuid) => {
  const clean = String(uuid || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (clean.length === 32) {
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
  }
  return String(uuid || '');
};

const ryzeService = {
  async listServers() {
    const response = await ryzeApi.get('/server/list');
    return response.data;
  },

  async getServerStatus(uuid) {
    const cleanUuid = normalizeUuid(uuid);
    const response = await ryzeApi.get('/server/status', { data: { uuid: cleanUuid }, params: { uuid: cleanUuid } });
    return response.data;
  },

  async getServerIpAddresses(uuid) {
    const cleanUuid = normalizeUuid(uuid);
    const response = await ryzeApi.get('/server/ipaddresses', { data: { uuid: cleanUuid }, params: { uuid: cleanUuid } });
    return response.data;
  },

  async setPowerState(uuid, action) {
    const cleanUuid = normalizeUuid(uuid);
    // action: start, stop, restart, kill
    const response = await ryzeApi.post('/server/power', { uuid: cleanUuid, action });
    return response.data;
  },

  async reinstall(uuid, osId) {
    const cleanUuid = normalizeUuid(uuid);
    const response = await ryzeApi.post('/server/reinstall', { uuid: cleanUuid, os_id: osId });
    return response.data;
  },

  async changePassword(uuid, password) {
    const cleanUuid = normalizeUuid(uuid);
    const response = await ryzeApi.post('/server/password', { uuid: cleanUuid, password });
    return response.data;
  },

  async listOperatingSystems() {
    const response = await ryzeApi.get('/server/os');
    return response.data;
  },

  async orderServer(planData) {
    const response = await ryzeApi.post('/server/order', planData);
    return response.data;
  }
};

module.exports = ryzeService;
