require('dotenv').config();
const app = require('./server');

// For local development only - Vercel serverless functions don't use this
if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== 'true') {
  const PORT = process.env.PORT || 3001;
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}
