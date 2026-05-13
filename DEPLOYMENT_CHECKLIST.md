# Vercel Deployment Checklist

Use this checklist to ensure your 1xbit backend is properly deployed to Vercel.

## Pre-Deployment (Local)

- [ ] Clone/pull latest code from GitHub
- [ ] Run `npm install` to ensure all dependencies are installed
- [ ] Create `.env.local` from `.env.example`
- [ ] Fill in all environment variables (see below for required ones)
- [ ] Run `npm run dev` and test locally
- [ ] Verify frontend loads at `http://localhost:3001/`
- [ ] Test key API endpoints:
  - [ ] `GET /api/config`
  - [ ] `POST /api/auth/register` (create test account)
  - [ ] `POST /api/auth/login` (verify login works)
- [ ] Run `npm test` if tests exist
- [ ] Commit and push changes to GitHub

## Required Environment Variables

Before deploying to Vercel, gather these values:

### Database
- [ ] `DATABASE_URL` - Neon PostgreSQL connection string (postgresql://...)

### Authentication
- [ ] `JWT_SECRET` - Random 32+ character string for JWT tokens
- [ ] `APP_API_KEY` - Random API key for internal endpoints

### AI Services
- [ ] `DEEPSEEK_API_KEY` - From DeepSeek API dashboard (or leave empty for testing)
- [ ] `GEMINI_API_KEY` - From Google Gemini API (optional)

### reCAPTCHA (Optional)
- [ ] `RECAPTCHA_ENABLED` - Set to `true` or `false`
- [ ] `RECAPTCHA_SECRET_KEY` - From Google reCAPTCHA console
- [ ] `RECAPTCHA_SITE_KEY` - From Google reCAPTCHA console

### Pterodactyl Integration
- [ ] `PTERODACTYL_URL` - Your Pterodactyl panel URL (e.g., https://panel.example.com)
- [ ] `PTERODACTYL_API_KEY` - Admin API key from Pterodactyl panel
- [ ] `ADMIN_USER` - Pterodactyl admin username
- [ ] `ADMIN_PASSWORD` - Pterodactyl admin password

### Email (Gmail/Nodemailer)
- [ ] `GMAIL_USER` - Gmail address
- [ ] `GMAIL_PASSWORD` - Gmail app-specific password (NOT your regular password)

### Ryze Integration (Optional)
- [ ] `RYZE_API_KEY` - From Ryze API (if using Ryze servers)

## Vercel Setup

### 1. Create Vercel Account
- [ ] Go to [vercel.com](https://vercel.com)
- [ ] Sign up / Log in
- [ ] Connect your GitHub account

### 2. Create New Project
- [ ] Click "New Project"
- [ ] Select your `benmaghabrahim71/1xbit` repository
- [ ] Click "Import"
- [ ] Framework: Select "Other" (it's Node.js/Express)
- [ ] Root Directory: Leave as `.` (root)

### 3. Configure Build Settings
- [ ] Build Command: `npm install` (or leave empty, Vercel handles this)
- [ ] Output Directory: Leave blank
- [ ] Install Command: `npm install`
- [ ] Development Command: `npm run dev`

### 4. Add Environment Variables
In the "Environment Variables" section, add each variable:

```
DATABASE_URL              = [your-neon-connection-string]
JWT_SECRET               = [32+ random characters]
DEEPSEEK_API_KEY         = [your-deepseek-key]
RECAPTCHA_ENABLED        = [true/false]
RECAPTCHA_SECRET_KEY     = [your-recaptcha-secret]
RECAPTCHA_SITE_KEY       = [your-recaptcha-site-key]
PTERODACTYL_URL          = [https://your-panel.com]
PTERODACTYL_API_KEY      = [your-pterodactyl-key]
ADMIN_USER               = [pterodactyl-admin-user]
ADMIN_PASSWORD           = [pterodactyl-admin-password]
GEMINI_API_KEY           = [optional-gemini-key]
GMAIL_USER               = [your-email@gmail.com]
GMAIL_PASSWORD           = [gmail-app-password]
RYZE_API_KEY             = [optional-ryze-key]
APP_API_KEY              = [your-app-api-key]
```

### 5. Deploy
- [ ] Review settings
- [ ] Click "Deploy"
- [ ] Wait for deployment to complete (usually 2-5 minutes)
- [ ] Note your domain: `https://your-project.vercel.app`

## Post-Deployment Verification

### 1. Test Frontend
- [ ] Open `https://your-project.vercel.app/` in browser
- [ ] Verify homepage loads
- [ ] Check browser console for errors (F12)
- [ ] Test navigation to other pages

### 2. Test API Endpoints

```bash
# Get configuration
curl https://your-project.vercel.app/api/config

# Get metrics
curl https://your-project.vercel.app/metrics

# Test auth (adjust email/password)
curl -X POST https://your-project.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "TestPass123!"
  }'
```

### 3. Database Verification
- [ ] Verify database tables were created (first request initializes DB)
- [ ] Check Neon dashboard for connection activity
- [ ] Verify no connection errors in Vercel logs

### 4. Check Logs
- [ ] Open your Vercel project dashboard
- [ ] Go to "Deployments"
- [ ] Click the latest deployment
- [ ] Click "Logs" and verify no errors
- [ ] Expand runtime logs to see initialization messages

### 5. Security Check
- [ ] Verify `.env` is NOT in your GitHub repo
- [ ] Confirm `.gitignore` includes `.env*`
- [ ] Check that environment variables are hidden in Vercel dashboard
- [ ] Verify JWT_SECRET is not in any public files

## Monitoring

### Set Up Alerts
- [ ] In Vercel dashboard, go to "Settings"
- [ ] Enable email alerts for build failures
- [ ] Enable alerts for excessive function execution time

### Monitor Metrics
- [ ] Check Vercel Analytics tab regularly
- [ ] Monitor database connection counts
- [ ] Track API response times

### Set Up Logs
- [ ] Enable runtime logs in Vercel
- [ ] Review logs after each deployment
- [ ] Set up external monitoring (e.g., Sentry) for production errors

## Common Post-Deployment Issues

### 404 Errors
- [ ] Verify `vercel.json` routes are correct
- [ ] Check that `/public` directory exists
- [ ] Verify static files are in `/public` (not root)
- [ ] Clear browser cache (Ctrl+Shift+Delete)

### Database Connection Errors
- [ ] Verify `DATABASE_URL` is set in Vercel
- [ ] Check Neon dashboard for active connections
- [ ] Verify firewall allows Vercel IPs
- [ ] Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### CORS Errors
- [ ] Frontend and backend are same domain (both on Vercel)
- [ ] CORS is enabled in server.js
- [ ] Check browser console for specific error

### Performance Issues
- [ ] Check function execution time in Vercel logs
- [ ] Verify database queries are optimized
- [ ] Consider upgrading to Vercel Pro for better cold start performance

### Secret/API Key Issues
- [ ] Verify each key is set in Vercel environment variables
- [ ] Check for typos in variable names
- [ ] Ensure values don't have extra spaces
- [ ] Test API calls with curl to debug

## Production Optimization

After initial deployment:

- [ ] Configure custom domain in Vercel
- [ ] Enable automatic deployments on GitHub push
- [ ] Set up branch preview deployments
- [ ] Configure custom analytics
- [ ] Set up error tracking (Sentry/Rollbar)
- [ ] Implement request logging
- [ ] Configure rate limiting for APIs
- [ ] Set up database backup schedule
- [ ] Create monitoring dashboard
- [ ] Document runbook for common issues

## Rollback Plan

If deployment causes issues:

1. [ ] Go to Vercel Deployments
2. [ ] Find previous stable deployment
3. [ ] Click "Promote to Production"
4. [ ] Investigate logs to find issue
5. [ ] Fix code locally, test, then redeploy

## Support & Resources

- Vercel Docs: https://vercel.com/docs
- Express.js Docs: https://expressjs.com
- Neon Docs: https://neon.tech/docs
- PostgreSQL Docs: https://www.postgresql.org/docs

## Completion

- [ ] All checks passed
- [ ] Frontend loads correctly
- [ ] APIs responding properly
- [ ] Database connected
- [ ] Monitoring set up
- [ ] Team notified of new deployment

**Deployment Date:** _______________  
**Deployed By:** _______________  
**Notes:** _______________
