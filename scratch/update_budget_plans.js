require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const plans = [
  { name: 'Starter VPS', price: 6.99, cpu: 2, ram: 4, disk: 60, ryze_id: 'vps-starter' },
  { name: 'Basic VPS', price: 10.99, cpu: 3, ram: 6, disk: 80, ryze_id: 'vps-basic' },
  { name: 'Standard VPS', price: 15.99, cpu: 4, ram: 8, disk: 100, ryze_id: 'vps-standard' },
  { name: 'Pro VPS', price: 39.99, cpu: 8, ram: 16, disk: 200, ryze_id: 'vps-pro' },
  { name: 'Elite VPS', price: 69.99, cpu: 12, ram: 32, disk: 300, ryze_id: 'vps-elite' },
  { name: 'Enterprise VPS', price: 99.99, cpu: 16, ram: 64, disk: 400, ryze_id: 'vps-enterprise' }
];

async function setup() {
  try {
    console.log('Cleaning up old Budget VPS plans...');
    await pool.query("DELETE FROM plans WHERE tier = 'Budget' AND type = 'VPS'");
    
    for (const p of plans) {
      const desc = `RAM: ${p.ram} GB CPU: ${p.cpu} Cores — INTEL XEON 2697v4 Storage: ${p.disk} GB NVMe Network: 10Gb/s`;
      await pool.query(
        'INSERT INTO plans (name, type, price, memory, cpu, disk, billing_cycle, provider, description, tier, ryze_cpu_type, ryze_cores, ryze_plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [p.name, 'VPS', p.price, p.ram * 1024, p.cpu * 100, p.disk * 1024, 'Monthly', 'ryze', desc, 'Budget', 'INTEL XEON 2697v4', p.cpu, p.ryze_id]
      );
      console.log(`Added ${p.name}`);
    }
    console.log('Budget VPS plans updated successfully.');
  } catch (err) {
    console.error('Error updating plans:', err);
  } finally {
    await pool.end();
  }
}

setup();
