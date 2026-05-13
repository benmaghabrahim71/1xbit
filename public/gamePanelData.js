function extractAttributes(payload) {
  return payload?.attributes || payload?.data?.attributes || payload || {};
}

function normalizeAllocation(entry) {
  const attrs = extractAttributes(entry);
  return {
    ip: attrs.ip || attrs.alias || '---',
    ip_alias: attrs.ip_alias || attrs.alias || null,
    port: Number(attrs.port || 0),
    notes: attrs.notes || null,
    is_default: Boolean(attrs.is_default)
  };
}

function getPrimaryAllocation(allocations = []) {
  return allocations.find((entry) => entry.is_default) || allocations[0] || null;
}

function buildPanelInfoPayload({ subscription, metadata = {}, remoteServer = null, userEmail = '' }) {
  const attrs = extractAttributes(remoteServer);
  const limits = attrs.limits || {};
  const allocations = (attrs.relationships?.allocations?.data || []).map(normalizeAllocation);
  const primaryAllocation = getPrimaryAllocation(allocations);

  return {
    attributes: {
      id: Number(attrs.id || subscription?.pterodactyl_server_id || 0) || null,
      uuid: attrs.uuid || subscription?.service_uuid || null,
      identifier: attrs.identifier || null,
      name: attrs.name || subscription?.service_name || subscription?.hostname || 'Game Server',
      node: attrs.relationships?.node?.attributes?.name || null,
      egg: Number(attrs.egg || attrs.relationships?.egg?.attributes?.id || subscription?.pterodactyl_egg_id || 0) || null,
      egg_name: attrs.relationships?.egg?.attributes?.name || metadata.pterodactyl_egg_name || null,
      limits: {
        memory: Number(limits.memory || subscription?.memory || 0),
        cpu: Number(limits.cpu || subscription?.cpu || 0),
        disk: Number(limits.disk || subscription?.disk || 0)
      },
      relationships: {
        allocations: {
          data: allocations.map((allocation) => ({ attributes: allocation }))
        }
      }
    },
    dashboard: {
      panel_url: metadata.pterodactyl_panel_url || null,
      login_email: userEmail || null,
      password_change_link: metadata.password_change_link || null,
      primary_connection: primaryAllocation ? {
        ip: primaryAllocation.ip,
        port: primaryAllocation.port,
        display: `${primaryAllocation.ip}:${primaryAllocation.port}`
      } : null
    }
  };
}

function inferState(remoteServer, resourcePayload) {
  const resourceAttrs = extractAttributes(resourcePayload);
  if (resourceAttrs.current_state) {
    return String(resourceAttrs.current_state).toLowerCase();
  }

  const serverAttrs = extractAttributes(remoteServer);
  if (serverAttrs.suspended) return 'suspended';
  if (serverAttrs.container?.installed === false) return 'installing';
  return 'offline';
}

function buildPanelResourcePayload({ subscription, remoteServer = null, resourcePayload = null, liveError = null }) {
  const serverAttrs = extractAttributes(remoteServer);
  const resourceAttrs = extractAttributes(resourcePayload);
  const resources = resourceAttrs.resources || {};

  return {
    attributes: {
      current_state: inferState(remoteServer, resourcePayload),
      resources: {
        cpu_absolute: Number(resources.cpu_absolute || 0),
        memory_bytes: Number(resources.memory_bytes || 0),
        disk_bytes: Number(resources.disk_bytes || 0),
        network_rx_bytes: Number(resources.network_rx_bytes || 0),
        network_tx_bytes: Number(resources.network_tx_bytes || 0),
        uptime: Number(resources.uptime || 0)
      }
    },
    limits: {
      memory: Number(serverAttrs.limits?.memory || subscription?.memory || 0),
      cpu: Number(serverAttrs.limits?.cpu || subscription?.cpu || 0),
      disk: Number(serverAttrs.limits?.disk || subscription?.disk || 0)
    },
    live: !liveError && Boolean(resourcePayload),
    error: liveError ? { message: liveError.message || 'Live resource data is unavailable' } : null
  };
}

module.exports = {
  buildPanelInfoPayload,
  buildPanelResourcePayload,
  extractAttributes,
  getPrimaryAllocation,
  normalizeAllocation
};
