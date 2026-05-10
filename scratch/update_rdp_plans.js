require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const extremeRdp = [
  { name: 'WINDOWS STARTER', price: 11.99, cpu: 2, ram: 4, disk: 100, ryze_id: 'rdp-ext-starter' },
  { name: 'WINDOWS ADVANCED', price: 21.99, cpu: 4, ram: 8, disk: 150, ryze_id: 'rdp-ext-advanced' },
  { name: 'WINDOWS PRO', price: 34.99, cpu: 6, ram: 12, disk: 200, ryze_id: 'rdp-ext-pro' },
  { name: 'WINDOWS BUSINESS', price: 49.99, cpu: 8, ram: 16, disk: 250, ryze_id: 'rdp-ext-business' },
  { name: 'WINDOWS ENTERPRISE', price: 64.99, cpu: 12, ram: 32, disk: 300, ryze_id: 'rdp-ext-enterprise' },
  { name: 'WINDOWS ULTRA', price: 120.00, cpu: 16, ram: 64, disk: 500, ryze_id: 'rdp-ext-ultra' }
];

const budgetRdp = [
  { name: 'STARTER RDP', price: 9.99, cpu: 2, ram: 4, disk: 100, ryze_id: 'rdp-bud-starter' },
  { name: 'BASIC RDP', price: 14.99, cpu: 3, ram: 6, disk: 150, ryze_id: 'rdp-bud-basic' },
  { name: 'STANDARD RDP', price: 24.99, cpu: 4, ram: 8, disk: 200, ryze_id: 'rdp-bud-standard' },
  { name: 'PRO RDP', price: 39.99, cpu: 8, ram: 16, disk: 300, ryze_id: 'rdp-bud-pro' },
  { name: 'ELITE RDP', price: 69.99, cpu: 12, ram: 32, disk: 400, ryze_id: 'rdp-bud-elite' },
  { name: 'ENTERPRISE RDP', price: 110.00, cpu: 16, ram: 64, disk: 500, ryze_id: 'rdp-bud-enterprise' }
];

async function setup() {
  try {
    console.log('Migrating old RDP plans to Legacy tier...');
    await pool.query("UPDATE plans SET tier = 'Legacy' WHERE type = 'RDP'");
    
    // Add Extreme RDP
    for (const p of extremeRdp) {
      const desc = `RAM: ${p.ram} GB CPU: x${p.cpu} Ryzen High Performance Storage: ${p.disk} GB NVMe Network: 10Gb/s — Suitable for hosting, game servers, bots, and heavy workloads.`;
      await pool.query(
        'INSERT INTO plans (name, type, price, memory, cpu, disk, billing_cycle, provider, description, tier, ryze_cpu_type, ryze_cores, ryze_plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [p.name, 'RDP', p.price, p.ram * 1024, p.cpu * 100, p.disk * 1024, 'Monthly', 'ryze', desc, 'Extreme', 'Ryzen High Performance', p.cpu, p.ryze_id]
      );
      console.log(`Added Extreme ${p.name}`);
    }

    // Add Budget RDP
    for (const p of budgetRdp) {
      const desc = `RAM: ${p.ram} GB CPU: ${p.cpu} Cores — INTEL XEON 2697v4 Storage: ${p.disk} GB SSD Network: 10Gb/s — Suitable for bots, automation, and development.`;
      await pool.query(
        'INSERT INTO plans (name, type, price, memory, cpu, disk, billing_cycle, provider, description, tier, ryze_cpu_type, ryze_cores, ryze_plan_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [p.name, 'RDP', p.price, p.ram * 1024, p.cpu * 100, p.disk * 1024, 'Monthly', 'ryze', desc, 'Budget', 'INTEL XEON 2697v4', p.cpu, p.ryze_id]
      );
      console.log(`Added Budget ${p.name}`);
    }
    
    console.log('RDP plans updated successfully.');
  } catch (err) {
    console.error('Error updating plans:', err);
  } finally {
    await pool.end();
  }
}

setup();
