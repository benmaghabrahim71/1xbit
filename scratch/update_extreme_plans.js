require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const plans = [
  { name: 'VPS STARTER', price: 9.99, cpu: 1, ram: 4, disk: 50, ryze_id: 'extreme-starter' },
  { name: 'VPS BASIC', price: 14.99, cpu: 2, ram: 6, disk: 80, ryze_id: 'extreme-basic' },
  { name: 'VPS STANDARD', price: 19.99, cpu: 3, ram: 8, disk: 100, ryze_id: 'extreme-standard' },
  { name: 'VPS PRO', price: 34.99, cpu: 4, ram: 16, disk: 160, ryze_id: 'extreme-pro' },
  { name: 'VPS ULTRA', price: 59.99, cpu: 6, ram: 32, disk: 240, ryze_id: 'extreme-ultra' },
  { name: 'VPS ELITE', price: 99.99, cpu: 8, ram: 64, disk: 320, ryze_id: 'extreme-elite' }
];

async function setup() {
  try {
    console.log('Migrating old Extreme VPS plans to Legacy tier...');
    await pool.query("UPDATE plans SET tier = 'Legacy' WHERE tier = 'Extreme' AND type = 'VPS'");
    
    for (const p of plans) {
      const desc = `RAM: ${p.ram} GB CPU: x${p.cpu} Ryzen 9 9950X (3D) Storage: ${p.disk} GB NVMe Network: 10Gb/s`;
      await pool.query(
        'INSERT INTO plans (name, type, price, memory, cpu, disk, billing_cycle, provider, description, tier, ryze_cpu_type, ryze_cores, ryze_plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [p.name, 'VPS', p.price, p.ram * 1024, p.cpu * 100, p.disk * 1024, 'Monthly', 'ryze', desc, 'Extreme', 'Ryzen 9 9950X (3D)', p.cpu, p.ryze_id]
      );
      console.log(`Added ${p.name}`);
    }
    console.log('Extreme VPS plans updated successfully.');
  } catch (err) {
    console.error('Error updating plans:', err);
  } finally {
    await pool.end();
  }
}

setup();
