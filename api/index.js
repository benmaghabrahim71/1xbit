// Vercel Serverless Function - API Handler
// This file serves as the entry point for all requests
require('dotenv').config();
const app = require('../server');

// Handle both API and static file serving
module.exports = app;
