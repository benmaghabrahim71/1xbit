#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║         Vercel Setup Verification                              ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

let allGood = true;

// Check essential files
const files = [
  'server.js',
  'api/index.js',
  'vercel.json',
  'index.html',
  'package.json',
  '.env.example'
];

console.log('📋 Checking Essential Files:\n');

files.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  const status = exists ? '✅' : '❌';
  console.log(`  ${status} ${file}`);
  if (!exists) allGood = false;
});

// Check HTML files
console.log('\n📄 Checking HTML Files:\n');

const htmlFiles = [
  'index.html',
  'admin.html',
  'client-area.html',
  'about.html'
];

htmlFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  const status = exists ? '✅' : '❌';
  console.log(`  ${status} ${file}`);
  if (!exists) allGood = false;
});

// Check vercel.json structure
console.log('\n⚙️  Checking vercel.json Configuration:\n');

try {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  
  if (vercelConfig.routes && Array.isArray(vercelConfig.routes)) {
    console.log(`  ✅ Routes defined: ${vercelConfig.routes.length} routes`);
    
    // Check for API route
    const hasApiRoute = vercelConfig.routes.some(r => r.src && r.src.includes('api'));
    console.log(`  ${hasApiRoute ? '✅' : '❌'} API route configured`);
    
    // Check for catch-all route
    const hasCatchAll = vercelConfig.routes.some(r => r.src && r.dest && r.dest.includes('index.html'));
    console.log(`  ${hasCatchAll ? '✅' : '❌'} Catch-all route for SPA configured`);
  } else {
    console.log('  ❌ Routes not properly configured');
    allGood = false;
  }
} catch (err) {
  console.log(`  ❌ Error reading vercel.json: ${err.message}`);
  allGood = false;
}

// Check server.js has catch-all route
console.log('\n🔧 Checking server.js Configuration:\n');

try {
  const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  
  const hasCatchAll = serverContent.includes("app.get('*'");
  console.log(`  ${hasCatchAll ? '✅' : '❌'} Catch-all route in server.js`);
  
  const hasStatic = serverContent.includes('express.static');
  console.log(`  ${hasStatic ? '✅' : '❌'} Static file serving configured`);
  
  const hasExport = serverContent.includes('module.exports = app');
  console.log(`  ${hasExport ? '✅' : '❌'} Express app exported`);
} catch (err) {
  console.log(`  ❌ Error reading server.js: ${err.message}`);
  allGood = false;
}

// Check package.json has required scripts
console.log('\n📦 Checking package.json Scripts:\n');

try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  
  if (packageJson.scripts) {
    const hasStart = 'start' in packageJson.scripts;
    console.log(`  ${hasStart ? '✅' : '❌'} start script defined`);
    
    const hasDev = 'dev' in packageJson.scripts;
    console.log(`  ${hasDev ? '✅' : '❌'} dev script defined`);
    
    const hasBuild = 'build' in packageJson.scripts;
    console.log(`  ${hasBuild ? '✅' : '❌'} build script defined`);
  }
} catch (err) {
  console.log(`  ❌ Error reading package.json: ${err.message}`);
  allGood = false;
}

// Final status
console.log('\n' + '═'.repeat(64));
if (allGood) {
  console.log('✅ All checks passed! Setup is ready for deployment.\n');
  console.log('Next steps:');
  console.log('  1. npm install (if not already done)');
  console.log('  2. npm run dev (to test locally)');
  console.log('  3. git push (to deploy to Vercel)');
} else {
  console.log('⚠️  Some checks failed. Please review the issues above.\n');
  console.log('Read FIX_404.md for more information.');
}
console.log('═'.repeat(64) + '\n');

process.exit(allGood ? 0 : 1);
