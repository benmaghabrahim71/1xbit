# Local Development Setup

## Prerequisites

- Node.js 18+ (check with `node --version`)
- npm or pnpm (comes with Node.js)
- PostgreSQL database (Neon recommended)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment Variables

Create `.env.local` from the template:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your values:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/database
JWT_SECRET=your-secret-key-min-32-chars-long
DEEPSEEK_API_KEY=your-api-key
RECAPTCHA_ENABLED=false
RECAPTCHA_SECRET_KEY=your-secret
RECAPTCHA_SITE_KEY=your-site-key
PTERODACTYL_URL=https://your-panel.com
PTERODACTYL_API_KEY=your-api-key
APP_API_KEY=your-app-key
GEMINI_API_KEY=optional-api-key
GMAIL_USER=your-email@gmail.com
GMAIL_PASSWORD=your-app-password
RYZE_API_KEY=optional-api-key
NODE_ENV=development
PORT=3001
```

### 3. Run Development Server

```bash
npm run dev
```

Server will start at `http://localhost:3001`

### 4. Verify Setup

Open your browser and visit:
- Frontend: `http://localhost:3001/`
- API Config: `http://localhost:3001/api/config`
- Metrics: `http://localhost:3001/metrics`

## Testing with Vercel CLI

To test the Vercel production build locally:

### 1. Install Vercel CLI

```bash
npm install -g vercel
```

### 2. Link to Vercel Project

```bash
vercel link
```

### 3. Pull Environment Variables

```bash
vercel env pull .env.local
```

### 4. Run Vercel Development Server

```bash
vercel dev
```

This simulates the production environment locally, running on `http://localhost:3000`

## Common Issues

### Port Already in Use

If port 3001 is in use:

```bash
PORT=3002 npm run dev
```

Or kill the process:

```bash
lsof -ti:3001 | xargs kill -9
```

### Database Connection Fails

1. Verify `DATABASE_URL` is correct
2. Test connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Check firewall rules
4. For Neon, enable connection pooling in dashboard

### Module Not Found Errors

```bash
rm -rf node_modules package-lock.json
npm install
```

### Frontend Files Not Loading

- Check `http://localhost:3001/public/` exists
- Verify files are in project root and copied to `/public`
- Check browser console for 404 errors

## API Testing

### Using curl

```bash
# Get config
curl http://localhost:3001/api/config

# Test auth endpoints
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "TestPass123!"
  }'

# With authentication token
curl http://localhost:3001/api/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman

1. Import the API endpoints into Postman
2. Set base URL: `http://localhost:3001`
3. Test endpoints with appropriate headers and body

## Database Management

### Create New Database (Neon)

1. Go to [console.neon.tech](https://console.neon.tech)
2. Create new project
3. Copy connection string to `DATABASE_URL` in `.env.local`

### View Database (Using psql)

```bash
# Connect to database
psql $DATABASE_URL

# List tables
\dt

# Quit
\q
```

### Reset Database

⚠️ **Warning**: This deletes all data!

```bash
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

Then restart the server to reinitialize tables.

## Debugging

### Enable Debug Logging

Add to your code:

```javascript
console.log('[DEBUG]', variableName);
```

### Check Node Version

```bash
node --version
npm --version
```

### View Environment Variables

```bash
# See loaded variables
node -e "console.log(process.env)"
```

### Monitor Database Connections

```sql
SELECT count(*) FROM pg_stat_activity;
```

## Performance Testing

### Load Testing

```bash
npm install -g autocannon
autocannon http://localhost:3001/api/config -c 10 -d 30
```

### Memory Usage

```bash
node --max-old-space-size=4096 index.js
```

## Production Checklist

Before deploying to Vercel:

- [ ] `.env.local` has all required variables
- [ ] `npm test` passes (if tests exist)
- [ ] `npm run dev` starts without errors
- [ ] Frontend loads at `http://localhost:3001/`
- [ ] API endpoints respond correctly
- [ ] Database tables created successfully
- [ ] No console errors in browser DevTools
- [ ] All dependencies listed in `package.json`

## Next Steps

After local testing works:

1. Push code to GitHub
2. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for Vercel deployment
3. Set environment variables in Vercel dashboard
4. Monitor logs and set up alerts
