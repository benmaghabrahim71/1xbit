const pool = require('../db');
async function check() {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.service_uuid, s.service_type, s.hostname, s.status, s.expires_at, 
              CASE 
                WHEN s.ryze_vmid IS NOT NULL THEN CONCAT('VM #', s.ryze_vmid)
                ELSE p.name 
              END as plan_name 
       FROM subscriptions s 
       LEFT JOIN plans p ON s.plan_id = p.id 
       WHERE s.user_id = 1 AND s.status = 'ACTIVE' 
    `);
    console.log('Query successful, rows:', rows.length);
  } catch (e) {
    console.error('Query failed:', e.message);
  } finally {
    process.exit();
  }
}
check();
