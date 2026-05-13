const { Pool } = require('pg');
require('dotenv').config();

const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error('DATABASE_URL is required for the Neon PostgreSQL connection.');
}

const withRequiredSslMode = (url) => {
  const hasSslMode = /(?:\?|&)sslmode=/.test(url);
  if (hasSslMode) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}sslmode=verify-full`;
};

const DATABASE_URL = withRequiredSslMode(rawDatabaseUrl);

const toPgPlaceholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

const normalizeSql = (sql) => {
  return toPgPlaceholders(sql)
    .replace(/\bTRUE\b/g, 'true')
    .replace(/\bFALSE\b/g, 'false');
};

const getSqlCommand = (sql) => {
  let s = String(sql ?? '').trim();

  while (s.startsWith('--')) {
    const nextNewline = s.indexOf('\n');
    if (nextNewline === -1) {
      return '';
    }
    s = s.slice(nextNewline + 1).trim();
  }

  if (s.startsWith('/*')) {
    const end = s.indexOf('*/');
    if (end !== -1) {
      s = s.slice(end + 2).trim();
    }
  }

  const firstWord = s.split(/\s+/)[0] ?? '';
  return firstWord.toLowerCase();
};

const formatMySql2Return = (sql, result) => {
  const cmd = getSqlCommand(sql);
  const isRows = cmd === 'select' || cmd === 'with';

  if (isRows) {
    return [result.rows, []];
  }

  const insertId =
    result.rows?.[0]?.id ??
    result.rows?.[0]?.insert_id ??
    result.rows?.[0]?.insertid ??
    null;

  return [
    {
      insertId,
      affectedRows: result.rowCount ?? 0,
      rowCount: result.rowCount ?? 0
    },
    []
  ];
};

const basePool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

basePool.on('error', (err) => {
  console.error('[DB Pool] Idle client error (will reconnect):', err.message);
  // Do NOT exit process — pg-pool will create a new connection automatically
});

const wrapClient = (client) => {
  let released = false;
  return {
  async query(sql, params = []) {
    const result = await client.query(normalizeSql(sql), params);
    return formatMySql2Return(sql, result);
  },
  async beginTransaction() {
    await client.query('BEGIN');
  },
  async commit() {
    await client.query('COMMIT');
  },
  async rollback() {
    await client.query('ROLLBACK');
  },
  release() {
    if (released) return;
    released = true;
    client.release();
  }
};
};

const pool = {
  async query(sql, params = []) {
    const result = await basePool.query(normalizeSql(sql), params);
    return formatMySql2Return(sql, result);
  },
  async getConnection() {
    const client = await basePool.connect();
    return wrapClient(client);
  },
  async end() {
    await basePool.end();
  }
};

module.exports = pool;
