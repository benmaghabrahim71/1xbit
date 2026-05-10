function buildPasswordStrengthError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters long';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, number, and special character';
  }
  return null;
}

function buildAllocatorRequirements(requirements = {}) {
  const requestedCpu = Number(requirements.cpu || 0);
  const requestedMemory = Number(requirements.memory || 0);
  const requestedDisk = Number(requirements.disk || 0);
  return {
    cpu: requestedCpu,
    requestedCpu,
    requestedMemory,
    requestedDisk,
    memoryWithOverhead: Math.ceil(requestedMemory * 1.1),
    diskWithOverhead: Math.ceil(requestedDisk * 1.05),
    location: requirements.location || null
  };
}

function calculateNodeAvailabilityWithCpu(calculateNodeAvailability, node) {
  const availability = calculateNodeAvailability(node);
  const attrs = node.attributes || node;
  const servers = attrs.relationships?.servers?.data || [];
  const allocatedCpu = servers.reduce((sum, server) => sum + Number(server.attributes?.limits?.cpu || 0), 0);
  const totalCpu = Number(attrs.cpu || attrs.max_cpu || attrs.cpu_limit || 100000);
  return {
    ...availability,
    freeCpu: Math.max(totalCpu - allocatedCpu, 0)
  };
}

function pickClosestNode(nodes, requirements, calculateAvailabilityWithCpu) {
  const ranked = nodes.map((node) => {
    const attrs = node.attributes || {};
    const availability = calculateAvailabilityWithCpu(node);
    const cpuGap = Math.max(0, requirements.cpu - availability.freeCpu);
    const memoryGap = Math.max(0, requirements.memoryWithOverhead - availability.freeMemory);
    const diskGap = Math.max(0, requirements.diskWithOverhead - availability.freeDisk);
    return {
      nodeId: Number(attrs.id),
      name: attrs.name,
      cpuGap,
      memoryGap,
      diskGap,
      score: cpuGap + memoryGap + diskGap
    };
  }).sort((a, b) => a.score - b.score);

  return ranked[0] || null;
}

function chooseSmallestQualifiedNode(nodes, requirements, calculateAvailabilityWithCpu) {
  const qualified = nodes
    .map((node) => ({ node, availability: calculateAvailabilityWithCpu(node) }))
    .filter((entry) =>
      entry.availability.freeCpu >= requirements.cpu &&
      entry.availability.freeMemory >= requirements.memoryWithOverhead &&
      entry.availability.freeDisk >= requirements.diskWithOverhead
    )
    .sort((a, b) => {
      const aWaste = a.availability.freeCpu + a.availability.freeMemory + a.availability.freeDisk;
      const bWaste = b.availability.freeCpu + b.availability.freeMemory + b.availability.freeDisk;
      return aWaste - bWaste;
    });

  return qualified[0] || null;
}

function applyRemediationToProvisionInput(input, remediation) {
  if (!remediation || typeof remediation !== 'object') return { ...input };
  const next = { ...input };
  const action = String(remediation.action || remediation.type || '').toLowerCase();

  if (action.includes('different node') || action.includes('select_node') || remediation.node_id) {
    next.nodeId = Number(remediation.node_id || remediation.nodeId || next.nodeId || 0);
  }
  if (action.includes('upgrade egg') || remediation.egg_id) {
    next.eggId = Number(remediation.egg_id || remediation.eggId || next.eggId || 0);
  }
  if (action.includes('increase allocation') || remediation.allocations) {
    next.allocations = Number(remediation.allocations || next.allocations || 1);
  }

  return next;
}

function isGameHostingMetadata(metadata) {
  return String(metadata?.service_category || '').toLowerCase() === 'game-hosting';
}

module.exports = {
  applyRemediationToProvisionInput,
  buildAllocatorRequirements,
  buildPasswordStrengthError,
  calculateNodeAvailabilityWithCpu,
  chooseSmallestQualifiedNode,
  isGameHostingMetadata,
  pickClosestNode
};
