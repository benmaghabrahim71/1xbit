# Vercel Deployment Guide - 1xbit

This guide covers deploying your Express.js backend and static HTML frontend to Vercel.

## Architecture

- **Backend**: Express.js application running as Vercel Serverless Functions
- **Frontend**: Static HTML/CSS/JS files served from `/public` directory
- **Database**: PostgreSQL via Neon (DATABASE_URL environment variable)
- **API Routes**: All requests to `/api/*` are handled by the serverless function

## Project Structure

```
/vercel/share/v0-project/
├── api/
│   └── index.js              # Vercel serverless function entry point
├── public/                   # Static frontend files (auto-served by Vercel)
│   ├── index.html
│   ├── *.html               # All HTML pages
│   ├── *.css                # Stylesheets
│   ├── *.js                 # Client-side scripts
│   └── ...
├── server.js                # Express app configuration
├── db.js                    # Database pool configuration
├── index.js                 # Development server entry (not used in Vercel)
├── vercel.json              # Vercel configuration
├── .env.example             # Environment variable template
└── package.json             # Dependencies
```

## Setup Instructions

### 1. Install Dependencies Locally

```bash
npm install
```

### 2. Set Environment Variables

Create a `.env.local` file for local development (copy from `.env.example`):

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values:
- `DATABASE_URL`: Neon PostgreSQL connection string
- `JWT_SECRET`: Random secret key for JWT tokens
- `DEEPSEEK_API_KEY`: DeepSeek API key
- `RECAPTCHA_SECRET_KEY` & `RECAPTCHA_SITE_KEY`: Google reCAPTCHA keys
- `PTERODACTYL_URL` & `PTERODACTYL_API_KEY`: Pterodactyl panel credentials
- Other service API keys (Gmail, Gemini, Ryze, etc.)

### 3. Test Locally

```bash
npm start
```

The server will run on `http://localhost:3001`

### 4. Deploy to Vercel

#### Option A: Using Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts to:
1. Link to your GitHub repository
2. Select the project directory
3. Configure environment variables

#### Option B: Using GitHub + Vercel Dashboard

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Add environment variables in the "Environment Variables" section:
   - Add each variable from `.env.example`
   - Mark sensitive variables appropriately

## Environment Variables (Vercel)

Add these in the Vercel dashboard under **Settings > Environment Variables**:

```
DATABASE_URL              → your-neon-connection-string
JWT_SECRET               → random-secret-key
DEEPSEEK_API_KEY         → your-deepseek-key
RECAPTCHA_ENABLED        → true/false
RECAPTCHA_SECRET_KEY     → your-recaptcha-secret
RECAPTCHA_SITE_KEY       → your-recaptcha-site-key
PTERODACTYL_URL          → https://your-panel.com
PTERODACTYL_API_KEY      → your-pterodactyl-key
ADMIN_USER               → admin-username
ADMIN_PASSWORD           → admin-password
GEMINI_API_KEY           → your-gemini-key (optional)
GMAIL_USER               → your-email@gmail.com
GMAIL_PASSWORD           → your-app-password
RYZE_API_KEY             → your-ryze-key (optional)
APP_API_KEY              → your-app-api-key
```

## API Endpoints

All endpoints are available at: `https://your-domain.vercel.app/api/*`

### Example Requests

```bash
# Get configuration
curl https://your-domain.vercel.app/api/config

# Register user
curl -X POST https://your-domain.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"user","email":"user@example.com","password":"pass"}'

# Login
curl -X POST https://your-domain.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user","password":"pass"}'
```

## Frontend

The frontend is automatically served from `/public`:

- Home: `https://your-domain.vercel.app/`
- Admin: `https://your-domain.vercel.app/admin.html`
- Client Area: `https://your-domain.vercel.app/client-area.html`
- etc.

## Database Setup

The database tables are automatically created on first server startup via the `initDB()` function in `server.js`.

To verify the tables:
```bash
psql $DATABASE_URL -c "\dt"
```

## Monitoring & Logs

View logs in Vercel dashboard:
1. Go to your project
2. Click "Deployments"
3. Select a deployment
4. Click "Logs"

## Troubleshooting

### 1. Database Connection Errors
- Verify `DATABASE_URL` is correct in Environment Variables
- Check that your Neon database is active
- Ensure your IP is allowed (or use Neon's connection pooling)

### 2. Static Files Not Loading
- Verify files are in `/public` directory
- Check `vercel.json` routes configuration
- Clear cache: `vercel env pull` then redeploy

### 3. API Returning 404
- Check `vercel.json` rewrites section
- Verify `api/index.js` exists
- Check server.js for route definitions

### 4. Cold Start Issues
- First request after inactivity may be slow (~5-10s)
- This is normal for serverless functions
- Consider using Vercel's Pro plan for faster cold starts

### 5. CORS Issues
- CORS is enabled in server.js: `app.use(cors())`
- Add custom origins if needed in `server.js` instead of Vercel config

## Performance Tips

1. **Connection Pooling**: Neon provides built-in connection pooling
2. **Caching**: Static files are cached automatically by Vercel's CDN
3. **Database**: Use indexes on frequently queried columns
4. **API Responses**: Keep responses small and compress where possible

## Next Steps

1. Test all API endpoints after deployment
2. Set up monitoring/alerting
3. Configure custom domain
4. Set up CI/CD pipeline for automatic deployments
5. Monitor costs (especially database connections)

## Support

For Vercel-specific issues:
- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Community](https://vercel.com/support)

For application issues:
- Check logs in Vercel dashboard
- Test locally with `npm start`
- Verify environment variables
