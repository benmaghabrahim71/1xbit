const http = require('http');

const json = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

let lastCreatedServerPayload = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const key = `${req.method} ${url.pathname}`;

  if (key === 'GET /api/application/nests') {
    return json(res, 200, {
      data: [{ attributes: { id: 5, name: 'Games' } }],
      meta: { pagination: { total_pages: 1 } }
    });
  }

  if (key === 'GET /api/application/nests/5/eggs') {
    return json(res, 200, {
      data: [{ attributes: { id: 18, name: 'SA-MP' } }],
      meta: { pagination: { total_pages: 1 } }
    });
  }

  if (key === 'GET /api/application/users') {
    return json(res, 200, { data: [] });
  }

  if (key === 'POST /api/application/users') {
    return json(res, 200, { attributes: { id: 101, email: 'docker@example.com' } });
  }

  if (key === 'GET /api/application/nodes/1') {
    return json(res, 200, {
      attributes: {
        id: 1,
        name: 'Docker Node',
        memory: 8192,
        disk: 20480,
        relationships: { servers: { data: [] } }
      }
    });
  }

  if (key === 'GET /api/application/nodes/1/allocations') {
    return json(res, 200, { data: [{ attributes: { id: 5001 } }] });
  }

  if (key === 'POST /api/application/servers') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      lastCreatedServerPayload = body ? JSON.parse(body) : null;
      json(res, 200, { attributes: { id: 201, uuid: 'docker-uuid-201', identifier: 'docker201' } });
    });
    return;
  }

  if (key === 'GET /api/application/servers/201') {
    return json(res, 200, {
      attributes: {
        id: 201,
        uuid: 'docker-uuid-201',
        identifier: 'docker201',
        name: lastCreatedServerPayload?.name || 'Docker Suite Server',
        egg: lastCreatedServerPayload?.egg || 18,
        limits: lastCreatedServerPayload?.limits || { memory: 2048, disk: 4096, cpu: 100 },
        container: { installed: true }
      }
    });
  }

  if (key === 'GET /api/client/servers/docker201/sftp') {
    return json(res, 200, {
      data: { sftp_details: { ip: 'mock-pterodactyl', port: 2022, username: 'docker201' } }
    });
  }

  if (key === 'POST /api/client/servers/docker201/power') {
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Not found', path: url.pathname });
});

server.listen(8099, '0.0.0.0', () => {
  console.log('Mock Pterodactyl listening on 8099');
});
