const PLAYER_BASELINES = [
  { maxPlayers: 16, ramGb: 4, cpuVcpu: 4, cpuTier: '4 vCPU on a high-clock CPU (4.5 GHz+ boost)' },
  { maxPlayers: 32, ramGb: 6, cpuVcpu: 4, cpuTier: '4-6 vCPU on a high-clock CPU (Ryzen 5 5600 / Intel i5-12600K class)' },
  { maxPlayers: 48, ramGb: 8, cpuVcpu: 6, cpuTier: '6 vCPU with strong single-core speed (Ryzen 5 7600 / Intel i5-13600K class)' },
  { maxPlayers: 64, ramGb: 10, cpuVcpu: 6, cpuTier: '6-8 vCPU with 4.9 GHz+ boost (Ryzen 7 7700 / Intel i7-13700 class)' },
  { maxPlayers: 96, ramGb: 16, cpuVcpu: 8, cpuTier: '8 vCPU or dedicated modern gaming core set (Ryzen 7 7700X / 7800X3D class)' },
  { maxPlayers: Infinity, ramGb: 24, cpuVcpu: 10, cpuTier: 'Dedicated high-frequency CPU with 8-12 strong cores and split workloads' }
];

const SCRIPT_LOAD_MULTIPLIERS = {
  light: 1,
  moderate: 1.2,
  heavy: 1.45,
  extreme: 1.75
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function roundUpToStep(value, step) {
  return Math.ceil(value / step) * step;
}

function extractInteger(pattern, input) {
  const match = input.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function extractRamGb(input) {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'mb' || unit === 'mib') {
    return Math.max(1, Math.round(value / 1024));
  }
  return Math.max(1, Math.round(value));
}

function classifyScriptLoad(text, explicitValue) {
  const normalizedExplicit = typeof explicitValue === 'string' ? explicitValue.trim().toLowerCase() : '';
  if (SCRIPT_LOAD_MULTIPLIERS[normalizedExplicit]) return normalizedExplicit;

  const normalized = String(text || '').toLowerCase();
  if (
    /(200\+?\s*(scripts?|resources?))|(esx\s*legacy)|(qb-core)|(qbcore)|(mlo)|(eup)|(massive\s*inventory)|(heavily\s*modded)|(resource[-\s]*intensive)/i.test(normalized)
  ) {
    return 'extreme';
  }
  if (/(100\+?\s*(scripts?|resources?))|(many\s*scripts?)|(custom\s*cars?)|(streaming\s*assets?)|(heavy\s*scripts?)/i.test(normalized)) {
    return 'heavy';
  }
  if (/(50\+?\s*(scripts?|resources?))|(moderate\s*scripts?)|(framework\s*server)/i.test(normalized)) {
    return 'moderate';
  }
  return 'light';
}

function classifyIssueTags(text) {
  const normalized = String(text || '').toLowerCase();
  const tags = [];
  if (/(desync|rubber[-\s]?band|entity lag|onesync|sync issue)/i.test(normalized)) tags.push('network-sync');
  if (/(hitch|hitches|thread hitch|frame spike|script lag)/i.test(normalized)) tags.push('script-cpu');
  if (/(packet loss|latency|ping|routing|ddos|bandwidth)/i.test(normalized)) tags.push('network');
  if (/(crash|restart loop|timeout|overflow|out of memory)/i.test(normalized)) tags.push('stability');
  if (/(database|mysql|oxmysql|slow query)/i.test(normalized)) tags.push('database');
  return tags;
}

function extractServerProfile(payload = {}) {
  const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
  const textParts = [
    profile.summary,
    profile.issue,
    profile.currentHardware,
    profile.network,
    payload.message,
    ...(Array.isArray(payload.messages) ? payload.messages.map((entry) => entry && entry.content).filter(Boolean) : [])
  ].filter(Boolean);
  const text = textParts.join(' \n ');

  const players = clamp(
    normalizeInteger(profile.playerCount, extractInteger(/(\d+)\s*(?:players?|slots?|concurrent)/i, text) || 32),
    1,
    512
  );
  const ramGb = clamp(
    normalizeInteger(profile.ramGb, extractRamGb(text)),
    1,
    512
  );
  const cpuCores = clamp(
    normalizeInteger(profile.cpuCores, extractInteger(/(\d+)\s*(?:v?cpu|cores?|threads?)/i, text)),
    1,
    64
  );
  const uplinkMbps = clamp(
    normalizeInteger(profile.uplinkMbps, extractInteger(/(\d+)\s*(?:mbps|mb\/s|gbit|gbps)/i, text)),
    10,
    10000
  );
  const scriptLoad = classifyScriptLoad(text, profile.scriptLoad);
  const issueTags = classifyIssueTags(text);

  return {
    players,
    ramGb,
    cpuCores,
    uplinkMbps,
    scriptLoad,
    issueTags,
    text
  };
}

function getPlayerBaseline(players) {
  return PLAYER_BASELINES.find((entry) => players <= entry.maxPlayers) || PLAYER_BASELINES[PLAYER_BASELINES.length - 1];
}

function buildRuleBasedRecommendation(serverProfile) {
  const baseline = getPlayerBaseline(serverProfile.players);
  const loadMultiplier = SCRIPT_LOAD_MULTIPLIERS[serverProfile.scriptLoad] || 1;
  const recommendedRamGb = roundUpToStep(Math.max(baseline.ramGb * loadMultiplier, baseline.ramGb + 2), 2);
  const recommendedCpuVcpu = Math.max(
    baseline.cpuVcpu,
    roundUpToStep(baseline.cpuVcpu * (serverProfile.scriptLoad === 'extreme' ? 1.3 : serverProfile.scriptLoad === 'heavy' ? 1.15 : 1), 2)
  );
  const recommendedUplinkMbps = serverProfile.players > 48 || serverProfile.scriptLoad !== 'light' ? 1000 : 250;
  const recommendedStorage = serverProfile.players > 64 || serverProfile.scriptLoad !== 'light'
    ? 'NVMe SSD with at least 80-120 GB available for cache, txAdmin logs, and streamed assets'
    : 'NVMe SSD with at least 40-60 GB free for artifacts, logs, and resources';
  const hasNetworkRisk = !!serverProfile.uplinkMbps && serverProfile.uplinkMbps < recommendedUplinkMbps;
  const hasRamRisk = !!serverProfile.ramGb && serverProfile.ramGb < recommendedRamGb;
  const hasCpuRisk = !!serverProfile.cpuCores && serverProfile.cpuCores < recommendedCpuVcpu;

  const priorityActions = [];
  if (hasCpuRisk) {
    priorityActions.push(`Move to at least ${recommendedCpuVcpu} vCPU on a high-frequency processor; FiveM performance depends heavily on single-core speed.`);
  }
  if (hasRamRisk) {
    priorityActions.push(`Increase memory to ${recommendedRamGb} GB and keep at least 15-20% free headroom to avoid hitch spikes and swap pressure.`);
  }
  if (hasNetworkRisk) {
    priorityActions.push(`Upgrade the network path to a protected ${recommendedUplinkMbps} Mbps or 1 Gbps uplink with low jitter and a nearby region.`);
  }
  priorityActions.push('Profile the slowest resources with txAdmin profiler or `resmon 1` and remove long loops, uncached exports, and heavy SQL calls.');
  priorityActions.push('Split large packs of vehicles, MLOs, and clothing into on-demand streams instead of loading everything on join.');
  if (serverProfile.issueTags.includes('database')) {
    priorityActions.push('Enable query indexing and batch database writes; slow `oxmysql` calls often cause hitch warnings during peak hours.');
  }

  const tuningChecklist = [
    'Use Linux hosting, current recommended FXServer artifact, and keep txAdmin scheduled restarts outside peak time.',
    'Enable OneSync correctly, set realistic player slots, and avoid overselling `sv_maxclients` beyond tested script capacity.',
    'Keep MySQL on SSD or a nearby private network path; high DB latency amplifies inventory, garage, and identity script lag.',
    'Run a DDoS-protected route and target under 40 ms average latency for your main player region.',
    'Audit scripts for `while true do` loops without waits, excessive `TriggerClientEvent` spam, and broad server-side polling.'
  ];

  if (serverProfile.issueTags.includes('network-sync')) {
    tuningChecklist.push('Reduce entity spam, limit unneeded peds and props, and test OneSync Infinity only after validating each streamed resource.');
  }
  if (serverProfile.issueTags.includes('script-cpu')) {
    tuningChecklist.push('Move expensive calculations off frequent ticks and cache identifiers, job lookups, and permission checks.');
  }
  if (serverProfile.issueTags.includes('stability')) {
    tuningChecklist.push('Check artifact version drift, watchdog restarts, and memory leaks from resources that grow object counts over time.');
  }

  return {
    serverProfile,
    estimatedTier: baseline,
    recommendedRamGb,
    recommendedCpuVcpu,
    recommendedUplinkMbps,
    recommendedStorage,
    hardware: {
      ram: `${recommendedRamGb} GB dual-channel DDR4-3200 or better; DDR5-5600+ is ideal on newer dedicated hardware.`,
      cpu: `${baseline.cpuTier}. Target ${recommendedCpuVcpu} vCPU minimum for this workload.`,
      network: `${recommendedUplinkMbps >= 1000 ? '1 Gbps' : `${recommendedUplinkMbps} Mbps`} protected uplink with low jitter and routing close to players.`,
      storage: recommendedStorage
    },
    priorityActions,
    tuningChecklist,
    assumptions: [
      `Estimated concurrency: ${serverProfile.players} players.`,
      `Detected script intensity: ${serverProfile.scriptLoad}.`,
      serverProfile.ramGb ? `Current RAM appears to be about ${serverProfile.ramGb} GB.` : 'Current RAM was not specified clearly.',
      serverProfile.cpuCores ? `Current CPU appears to expose about ${serverProfile.cpuCores} vCPU/core slots.` : 'Current CPU allocation was not specified clearly.',
      serverProfile.uplinkMbps ? `Current uplink appears to be around ${serverProfile.uplinkMbps} Mbps.` : 'Current network uplink was not specified clearly.'
    ]
  };
}

function formatRuleBasedRecommendation(recommendation) {
  return [
    '## Quick Diagnosis',
    `- Estimated target load: ${recommendation.serverProfile.players} players with ${recommendation.serverProfile.scriptLoad} scripts/resources.`,
    `- Recommended RAM: ${recommendation.hardware.ram}`,
    `- Recommended CPU: ${recommendation.hardware.cpu}`,
    `- Recommended Network: ${recommendation.hardware.network}`,
    `- Recommended Storage: ${recommendation.hardware.storage}`,
    '',
    '## Priority Actions',
    ...recommendation.priorityActions.map((entry) => `- ${entry}`),
    '',
    '## Tuning Checklist',
    ...recommendation.tuningChecklist.map((entry) => `- ${entry}`),
    '',
    '## Assumptions',
    ...recommendation.assumptions.map((entry) => `- ${entry}`)
  ].join('\n');
}

function normalizeChatMessages(messages, latestMessage) {
  const normalized = Array.isArray(messages)
    ? messages
      .filter((entry) => entry && typeof entry.content === 'string' && entry.content.trim())
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: entry.content.trim().slice(0, 4000)
      }))
    : [];

  if (latestMessage && (!normalized.length || normalized[normalized.length - 1].content !== latestMessage.trim())) {
    normalized.push({ role: 'user', content: latestMessage.trim().slice(0, 4000) });
  }

  return normalized.slice(-8);
}

function buildGeminiPromptContext(chatMessages, recommendation) {
  const transcript = chatMessages
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n');

  return [
    'You are HOST1TOP FiveM Performance Copilot.',
    'Your job is to diagnose lag, low tick performance, desync, and hardware sizing issues for FiveM servers.',
    'Use the rule-based recommendations as hard evidence, then enrich them with contextual reasoning.',
    'Be concrete and actionable. Prefer short sections and bullet points.',
    'Do not invent measurements that were not provided. State assumptions clearly.',
    'Always cover hardware, network, script optimization, and the next steps.',
    '',
    'Rule-based recommendation:',
    formatRuleBasedRecommendation(recommendation),
    '',
    'Conversation transcript:',
    transcript || 'User has not provided prior context.'
  ].join('\n');
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .join('\n')
    .trim();
}

module.exports = {
  buildGeminiPromptContext,
  buildRuleBasedRecommendation,
  extractGeminiText,
  extractServerProfile,
  formatRuleBasedRecommendation,
  normalizeChatMessages
};
