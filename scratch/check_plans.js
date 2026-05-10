const pool = require('./db');

async function checkPlans() {
  try {
    const [rows] = await pool.query("SELECT id, name, location_id FROM plans WHERE type = 'GAME'");
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkPlans();
