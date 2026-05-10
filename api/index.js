// Vercel Serverless Function - API Handler
// This file serves as the entry point for all API requests
require('dotenv').config();
const app = require('../server');

// Export for Vercel
module.exports = app;
