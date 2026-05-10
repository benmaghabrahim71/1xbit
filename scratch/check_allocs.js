const axios = require('axios');
require('dotenv').config();

async function checkAllocations() {
  try {
    const url = process.env.PTERODACTYL_URL;
    const key = process.env.PTERODACTYL_API_KEY;
    
    const res = await axios.get(`${url.replace(/\/$/, '')}/api/application/nodes/2/allocations`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'Application/vnd.pterodactyl.v1+json'
      }
    });

    const free = res.data.data.filter(a => !a.attributes.assigned);
    console.log(`Node 2 has ${free.length} free allocations.`);
    if (free.length > 0) {
        console.log('First free allocation:', free[0].attributes.id, 'Port:', free[0].attributes.port);
    }
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

checkAllocations();
