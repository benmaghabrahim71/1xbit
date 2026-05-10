require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const plans = [
  { name: 'Starter', price: 6.99, cpu: 2, ram: 4, disk: 40 },
  { name: 'Basic', price: 10.99, cpu: 3, ram: 6, disk: 60 },
  { name: 'Standard', price: 15.99, cpu: 4, ram: 8, disk: 80 },
  { name: 'Advanced', price: 22.99, cpu: 6, ram: 12, disk: 120 },
  { name: 'Pro', price: 32.99, cpu: 8, ram: 16, disk: 160 },
  { name: 'Elite', price: 49.99, cpu: 10, ram: 24, disk: 240 },
  { name: 'Extreme', price: 69.99, cpu: 12, ram: 32, disk: 320 },
  { name: 'Ultimate', price: 89.99, cpu: 14, ram: 48, disk: 400 },
  { name: 'Enterprise', price: 119.99, cpu: 16, ram: 64, disk: 500 }
];

async function setup() {
  try {
    for (const p of plans) {
      const desc = `RAM: ${p.ram} GB CPU: ${p.cpu} Cores — Intel Xeon Gold Storage: ${p.disk} GB NVMe Network: 10Gb/s`;
      await pool.query(
        'INSERT INTO plans (name, type, price, memory, cpu, disk, billing_cycle, provider, description, tier, ryze_cpu_type, ryze_cores) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [p.name, 'VPS', p.price, p.ram * 1024, p.cpu * 100, p.disk * 1024, 'Monthly', 'ryze', desc, 'Budget', 'Intel Xeon Gold', p.cpu]
      );
      console.log(`Added ${p.name}`);
    }
    console.log('All plans added successfully.');
  } catch (err) {
    console.error('Error adding plans:', err);
  } finally {
    await pool.end();
  }
}

setup();
