# Quick Start - Deploy 1xbit to Vercel in 15 Minutes

## ⚡ Super Quick (15 minutes)

### 1. Local Test (5 min)
```bash
# Copy env template
cp .env.example .env.local

# Edit with your values (at minimum: DATABASE_URL and JWT_SECRET)
nano .env.local

# Start dev server
npm install && npm run dev

# Test: Open http://localhost:3001
```

### 2. Deploy to Vercel (5 min)
```bash
# Option A: Via GitHub (recommended)
# Push code to GitHub, go to vercel.com, click "New Project", import repo

# Option B: Via Vercel CLI
npm install -g vercel
vercel
```

### 3. Configure Environment (5 min)
In Vercel dashboard:
1. Go to Settings → Environment Variables
2. Add these required variables:
   - `DATABASE_URL` = your Neon connection string
   - `JWT_SECRET` = any random 32+ char string
3. Add any other API keys you have
4. Redeploy

**Done!** Your app is live at `https://your-project.vercel.app`

---

## 🔍 Verify It Works

Test these URLs after deployment:
```bash
# Frontend loads
https://your-project.vercel.app/

# API endpoint
https://your-project.vercel.app/api/config

# Create account (test it)
curl -X POST https://your-project.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"Test123!"}'
```

---

## 📋 What Was Set Up

| Component | What | Where |
|-----------|------|-------|
| **Frontend** | HTML, CSS, JS files | `/public/` directory |
| **Backend** | Express API | `/api/index.js` → `server.js` |
| **Config** | Deployment settings | `vercel.json` |
| **Guides** | Documentation | `DEPLOYMENT.md`, `LOCAL_SETUP.md` |

---

## 🎯 Minimal Environment Variables

**Absolutely Required:**
```
DATABASE_URL=postgresql://...   # From Neon.tech
JWT_SECRET=any-random-32-chars
```

**Recommended (for full features):**
```
DEEPSEEK_API_KEY=...           # For AI features
PTERODACTYL_URL=...            # For game servers
PTERODACTYL_API_KEY=...
RECAPTCHA_ENABLED=false        # Or true if you have keys
```

See `.env.example` for all options.

---

## ✅ Pre-Deployment Checklist

- [ ] Have `DATABASE_URL` from Neon
- [ ] Generated random `JWT_SECRET`
- [ ] `npm run dev` works locally
- [ ] Frontend loads at `http://localhost:3001`
- [ ] Code pushed to GitHub

---

## 🚀 Deployment Checklist

- [ ] Project imported in Vercel
- [ ] Environment variables added
- [ ] Deployment started
- [ ] Build succeeded (check logs)
- [ ] Frontend loads at Vercel URL
- [ ] API endpoint responds to `/api/config`

---

## 🆘 If Something Goes Wrong

| Problem | Solution |
|---------|----------|
| Database error | Check `DATABASE_URL` is correct in Vercel env vars |
| 404 on pages | Verify `/public` folder exists with HTML files |
| API returns 404 | Check `vercel.json` routes, verify `/api/index.js` exists |
| Static files broken | Clear browser cache, check `/public/` has files |
| CORS error | Already enabled in code, check browser console error |

---

## 📚 Detailed Guides

- **Local development**: See `LOCAL_SETUP.md`
- **Full deployment guide**: See `DEPLOYMENT.md`
- **Step-by-step checklist**: See `DEPLOYMENT_CHECKLIST.md`
- **Architecture overview**: See `SETUP_SUMMARY.md`

---

## 🎓 How It Works

```
User Request → Vercel Router
              ├─ /api/* → Serverless Function (Node.js)
              │           → Express server
              │           → Database query
              └─ /* → Static files from /public
```

- **Frontend**: Static HTML/CSS/JS served from Vercel CDN
- **Backend**: Express.js running as serverless functions
- **Database**: PostgreSQL hosted on Neon

---

## 💡 Key Points

1. **No ongoing fees** - Both Vercel and Neon have generous free tiers
2. **Auto-scaling** - Handles traffic spikes automatically
3. **Global CDN** - Your site is fast worldwide
4. **Database auto-init** - Tables created on first request
5. **Easy rollback** - One-click revert to previous version

---

## 🔄 Keep It Updated

After deploying:

```bash
# Make code changes
git add .
git commit -m "Updated something"
git push

# Vercel auto-deploys from GitHub
# Check progress at vercel.com dashboard
```

---

**That's it!** Your 1xbit backend is now live on Vercel. 🎉

Questions? Check the detailed guides or Vercel docs: https://vercel.com/docs
