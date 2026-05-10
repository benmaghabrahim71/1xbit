const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { PterodactylAdminClient } = require('../../pterodactylAdminClient');

const composeFile = path.join(__dirname, 'docker-compose.pterodactyl.yml');

function runDocker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: __dirname, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `docker ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

test('docker-backed provisioning flow', { skip: !process.env.RUN_PTERO_DOCKER_TESTS }, async () => {
  process.env.ADMIN_PTERODACTYL_ENABLED = 'true';
  process.env.PTERODACTYL_URL = 'http://127.0.0.1:8099';
  process.env.PTERODACTYL_API_KEY = 'ptla_docker_test';
  process.env.PTERODACTYL_CLIENT_KEY = 'ptlc_docker_test';

  await runDocker(['compose', '-f', composeFile, 'up', '-d']);

  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const client = new PterodactylAdminClient();
    const provisioned = await client.provisionGameServer({
      localUserId: 1,
      email: 'docker@example.com',
      username: 'docker',
      firstName: 'Docker',
      lastName: 'Suite',
      nodeId: 1,
      nestId: 5,
      eggId: 18,
      name: 'Docker Suite Server',
      memory: 2048,
      disk: 4096,
      cpu: 100,
      environment: { SERVER_NAME: 'Docker Suite Server' },
      externalId: 500
    });

    assert.equal(provisioned.server.identifier, 'docker201');
    assert.equal(provisioned.server.name, 'Docker Suite Server');
    assert.equal(provisioned.server.egg, 18);
    assert.equal(provisioned.server.limits.memory, 2048);
    assert.equal(provisioned.server.limits.cpu, 100);
    assert.equal(provisioned.sftp.username, 'docker201');
    assert.equal(provisioned.lifecycle, 'active');
  } finally {
    await runDocker(['compose', '-f', composeFile, 'down', '-v']);
  }
});
