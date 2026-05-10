const { Pool } = require('pg');
require('dotenv').config();

async function check() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
  
  try {
    const { rows } = await pool.query('SELECT id, service_uuid, hostname, service_type FROM subscriptions');
    console.table(rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

check();
