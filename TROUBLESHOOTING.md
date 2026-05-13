# Troubleshooting Guide - 1xbit Vercel Deployment

## Common Issues & Solutions

### 🔴 Frontend Issues

#### 1. "404 Not Found" on Homepage
**Problem**: Loading `https://your-domain.vercel.app/` returns 404

**Causes & Solutions**:
- [ ] Public folder missing: Run `mkdir -p public` and copy HTML files
- [ ] Wrong routing in `vercel.json`: Verify `"dest": "public/$1"` is present
- [ ] Files not uploaded: Check `vercel.json` build config includes public files
- [ ] Browser cache: Clear cache (Ctrl+Shift+Del)

**Quick Check**:
```bash
ls -la public/index.html
# Should show the file exists
```

---

#### 2. Static Files Not Loading (CSS/JS 404)
**Problem**: Page loads but styles/scripts fail, console shows 404 errors

**Solutions**:
- [ ] Verify file paths in HTML are correct (no "../" paths)
- [ ] Check files exist in `/public` directory
- [ ] Ensure references use forward slashes `/`, not backslashes
- [ ] Clear browser cache

**Fix in HTML**:
```html
<!-- Wrong (relative paths) -->
<link rel="stylesheet" href="../styles.css">
<script src="../script.js"></script>

<!-- Correct (root-relative) -->
<link rel="stylesheet" href="/styles.css">
<script src="/script.js"></script>
```

---

#### 3. Images Not Displaying
**Problem**: Images show 404 or broken image icon

**Solutions**:
- [ ] Verify image files are in `/public/images/`
- [ ] Use absolute paths: `/images/logo.png`
- [ ] Check filename case sensitivity (Linux is case-sensitive)
- [ ] Ensure image format is supported

**Check**:
```bash
ls /vercel/share/v0-project/public/images/
# Verify files exist here
```

---

### 🔴 Backend/API Issues

#### 4. "Cannot POST /api/..." - API Returns 404
**Problem**: API endpoints return 404

**Causes & Solutions**:
- [ ] `api/index.js` missing: Verify file exists at `/vercel/share/v0-project/api/index.js`
- [ ] `vercel.json` misconfigured: Check routes include `/api/(.*)`
- [ ] Express routes not defined: Check `server.js` has the endpoint

**Verify Setup**:
```bash
cat /vercel/share/v0-project/api/index.js
# Should show it requires server.js

grep '/api' /vercel/share/v0-project/vercel.json
# Should show routing rules
```

**Check Vercel Logs**:
1. Go to Vercel dashboard
2. Select your project
3. Click "Deployments"
4. Select latest deployment
5. Click "Logs" → "Function Logs"
6. Look for errors

---

#### 5. "Module not found" or "Cannot find module"
**Problem**: Server crashes with missing module error

**Causes & Solutions**:
- [ ] Dependency not installed: Run `npm install` locally
- [ ] Missing from `package.json`: Add manually and reinstall
- [ ] Typo in require statement: Check spelling

**Local Test**:
```bash
npm install
npm run dev
# Should start without errors
```

**If still fails**:
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run dev
```

---

#### 6. CORS Error - "Access to XMLHttpRequest blocked"
**Problem**: Browser console shows CORS error

**Solutions**:
- [ ] Already enabled in code - CORS is configured for all origins
- [ ] Check if it's really a CORS error (read full message)
- [ ] If custom origin restrictions needed, update `server.js`:

```javascript
app.use(cors({
  origin: ['https://your-domain.com', 'http://localhost:3001'],
  credentials: true
}));
```

**Verify CORS is Enabled**:
```bash
grep -n "cors()" /vercel/share/v0-project/server.js
# Should find the cors() middleware
```

---

### 🔴 Database Issues

#### 7. "Database Connection Failed" Error
**Problem**: `ECONNREFUSED` or connection timeout

**Causes & Solutions**:
- [ ] `DATABASE_URL` not set: Check Vercel env vars → Settings → Environment Variables
- [ ] Wrong connection string: Verify format is `postgresql://user:pass@host/db`
- [ ] Database offline: Check Neon dashboard if DB is active
- [ ] Firewall blocking: For Neon, ensure IP allowlist is configured

**Test Connection**:
```bash
# Locally with env var set
psql $DATABASE_URL -c "SELECT 1"
# Should return: "1"
```

**Fix in Vercel**:
1. Dashboard → Project Settings → Environment Variables
2. Verify `DATABASE_URL` value
3. Copy exact value from Neon dashboard
4. Click "Save"
5. Redeploy project

---

#### 8. "Relation 'users' does not exist"
**Problem**: Table creation failed

**Causes & Solutions**:
- [ ] First request didn't complete: Try again in 30 seconds
- [ ] Database connected but `initDB()` failed: Check Vercel logs
- [ ] Wrong DATABASE_URL: Tables created in wrong DB

**Verify Tables**:
```bash
psql $DATABASE_URL -c "\dt"
# Should list tables (users, plans, invoices, etc.)
```

**Reinitialize**:
```bash
# If needed to reset (WARNING: deletes all data!)
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# Server will recreate on next startup
```

---

#### 9. "Too many connections" Error
**Problem**: Database connection pooling exhausted

**Causes & Solutions**:
- [ ] Using Neon? Enable connection pooling:
  1. Neon Dashboard → Project → Connection pooling
  2. Set to "Enabled"
  3. Update DATABASE_URL to use pooling endpoint (port 6432)

**Connection String with Pooling**:
```
postgresql://user:password@ep-xxx.region.neon.tech/database?sslmode=require
# vs with pooling:
postgresql://user:password@ep-xxx.region.neon.tech:6432/database?sslmode=require
```

---

### 🔴 Deployment Issues

#### 10. Build Fails - "npm ERR! code ENOENT"
**Problem**: Build fails during `npm install`

**Solutions**:
- [ ] `package.json` missing: Verify file exists
- [ ] Syntax error in `package.json`: Validate JSON format
- [ ] Node version mismatch: Check Vercel uses Node 18+ (default)

**Validate Locally**:
```bash
npm install
# Should complete without errors
```

#### 11. Deployment Hangs or Times Out
**Problem**: Deployment stuck, exceeds 15-minute timeout

**Solutions**:
- [ ] Large dependency install: Dependencies are normal (~1-2 min)
- [ ] Database initialization slow: Can take 30-60 seconds on first run
- [ ] Check logs for actual error instead of timeout

**Check Logs**:
1. Go to Vercel Deployments
2. Click deployment
3. Click "Logs"
4. Scroll for actual error message

---

#### 12. "Payment Required" or Build Limit Exceeded
**Problem**: Deployment fails with billing error

**Solutions**:
- [ ] Free tier exhausted: Upgrade to Vercel Pro ($20/month)
- [ ] Function timeout exceeded: Optimize database queries
- [ ] Bandwidth exceeded: Compression and caching help

**Check Usage**:
1. Vercel Dashboard → Settings → Usage
2. Review current limits
3. Upgrade if needed

---

### 🟡 Performance Issues

#### 13. Slow API Response (~5-10 seconds)
**Problem**: First request after inactivity is very slow

**Causes & Solutions**:
- [ ] Cold start (normal): First request loads function (~5s)
- [ ] Vercel free tier: Pro plan has faster cold starts
- [ ] Slow database query: Optimize SQL queries in `server.js`

**Expected Performance**:
- First request (cold start): 5-10 seconds
- Subsequent requests: < 500ms
- After 15 min inactivity: Cold start again

**Optimize**:
1. Add database indexes on frequently queried columns
2. Use Vercel Pro plan for faster cold starts
3. Implement caching layer

---

#### 14. Database Queries Too Slow
**Problem**: API responses slow even after cold start

**Check**:
1. Log query time: Add timestamps in `server.js`
2. Check database indexes exist
3. Monitor from Neon dashboard

**Common Fixes**:
```javascript
// Add indexes to frequently queried columns
await connection.query(`CREATE INDEX idx_user_email ON users(email)`);

// Add LIMIT to large queries
query += " LIMIT 100";

// Use connection pooling (Neon)
```

---

### 🟡 Authentication Issues

#### 15. "Invalid Token" or "Token Expired"
**Problem**: JWT errors on protected endpoints

**Causes & Solutions**:
- [ ] `JWT_SECRET` changed: Use same value consistently
- [ ] Token expired: User needs to re-login
- [ ] Token format wrong: Should be `Authorization: Bearer <token>`

**Verify Env Var**:
```bash
# In Vercel dashboard
Settings → Environment Variables → JWT_SECRET
# Must be same value everywhere
```

**Test Token**:
```javascript
// In a test file
const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '24h' });
console.log('Token:', token);
```

---

#### 16. "Unauthorized" on Admin Endpoints
**Problem**: Admin endpoints return 401/403

**Causes & Solutions**:
- [ ] User not admin in database: Check user `role` column
- [ ] Token not passed: Include `Authorization: Bearer <token>`
- [ ] Role not set: Admin role must be 'admin' or 'super_admin'

**Check User Role**:
```bash
psql $DATABASE_URL -c "SELECT id, username, role FROM users LIMIT 5;"
```

**Update User Role**:
```bash
psql $DATABASE_URL -c "UPDATE users SET role='admin' WHERE id=1;"
```

---

## 🧪 Diagnostic Steps

### Test Local First
```bash
npm install
npm run dev
# All working? Deploy to Vercel
# Not working? Fix locally before deploying
```

### Verify Environment Variables
```bash
# Locally
cat .env.local | grep -E "DATABASE_URL|JWT_SECRET|DEEPSEEK"

# On Vercel (dashboard)
Settings → Environment Variables → Review each
```

### Check Logs
```bash
# Local (terminal output)
npm run dev
# Look for errors/warnings

# Vercel (web dashboard)
Deployments → Select → Logs
# Search for ERROR or WARN
```

### Test API Endpoints
```bash
# Get config (no auth needed)
curl https://your-domain.vercel.app/api/config

# Test auth (with payload)
curl -X POST https://your-domain.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user","password":"pass"}'

# Test protected endpoint (with token)
curl https://your-domain.vercel.app/api/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Enable Debug Mode
Add to `server.js`:
```javascript
if (process.env.DEBUG === 'true') {
  console.log('[DEBUG]', 'message', variable);
}
```

Set in Vercel: `DEBUG=true`

---

## 🆘 Still Stuck?

### Get Help

1. **Check Vercel Logs**:
   - Dashboard → Deployments → Latest → Logs
   - Look for actual error message

2. **Check GitHub Issues**:
   - Search existing issues for your error
   - Create detailed issue with logs

3. **Test Locally First**:
   - Run `npm run dev`
   - If works locally → Vercel config issue
   - If fails locally → Code issue

4. **Vercel Community**:
   - https://github.com/vercel/vercel/discussions
   - https://twitter.com/vercel

5. **This Project**:
   - Check `DEPLOYMENT.md` for full guide
   - Check `LOCAL_SETUP.md` for dev setup
   - Review `vercel.json` configuration

---

## 📋 Support Info to Gather

When reporting issues:

```bash
# Gather info
echo "=== Environment ===" && \
node --version && npm --version && \
echo "=== Dependencies ===" && \
npm list express pg && \
echo "=== Vercel Config ===" && \
cat vercel.json | head -20 && \
echo "=== Error Message ===" && \
# Copy exact error from logs
```

---

## ✅ Troubleshooting Checklist

- [ ] Verified `api/index.js` exists
- [ ] Verified `/public` folder with HTML files
- [ ] Checked `vercel.json` has correct routes
- [ ] Confirmed environment variables in Vercel
- [ ] Tested locally with `npm run dev`
- [ ] Checked Vercel deployment logs
- [ ] Verified database connection works
- [ ] Tested API endpoints with curl
- [ ] Cleared browser cache
- [ ] Tried redeploying project

---

**Still need help?** Check the other guides: `DEPLOYMENT.md`, `LOCAL_SETUP.md`, `QUICK_START.md`
