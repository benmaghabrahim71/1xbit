# 1xbit - Game Server Hosting Platform

A full-stack web application for managing and provisioning game servers, VPS services, and anti-DDoS protection built with Express.js and PostgreSQL.

## 🚀 Quick Deployment to Vercel

This project is configured for easy deployment to Vercel with serverless functions and PostgreSQL database.

### Start Here 📖

**Choose your path:**

1. **⚡ 15-minute quick start**: Read [`QUICK_START.md`](./QUICK_START.md)
2. **💻 Local development**: Read [`LOCAL_SETUP.md`](./LOCAL_SETUP.md)
3. **🚀 Full deployment guide**: Read [`DEPLOYMENT.md`](./DEPLOYMENT.md)
4. **✅ Step-by-step checklist**: Read [`DEPLOYMENT_CHECKLIST.md`](./DEPLOYMENT_CHECKLIST.md)
5. **🔧 Troubleshooting**: Read [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)

### What's Included

```
├── api/                    # Vercel serverless API handler
├── public/                 # Static HTML/CSS/JS frontend
├── server.js              # Express.js application
├── db.js                  # Database configuration
├── vercel.json            # Vercel deployment config
├── .env.example           # Environment variables template
└── [Documentation guides]
```

## 🎯 Features

- **Game Server Management**: Provision and manage Pterodactyl game servers
- **VPS Services**: Integrate with Ryze for VPS provisioning
- **Anti-DDoS Protection**: Security features for hosted services
- **User Management**: Registration, authentication, profiles
- **Admin Dashboard**: Manage servers, users, and billing
- **Client Area**: Self-service for customers
- **Payment Integration**: Invoice and subscription management
- **AI Chatbot**: FiveM server optimization advisor

## 🛠️ Tech Stack

- **Backend**: Node.js + Express.js
- **Frontend**: HTML5 + CSS3 + Vanilla JavaScript
- **Database**: PostgreSQL (Neon)
- **Hosting**: Vercel (Serverless Functions)
- **AI**: DeepSeek API + Google Gemini
- **Authentication**: JWT
- **Email**: Nodemailer (Gmail)

## 📦 Prerequisites

- Node.js 18+ ([download](https://nodejs.org/))
- npm or pnpm (comes with Node.js)
- PostgreSQL database (Neon recommended - [free tier](https://neon.tech/))

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# 3. Run locally
npm run dev

# 4. Open browser
# http://localhost:3001
```

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [`QUICK_START.md`](./QUICK_START.md) | 15-minute deployment guide |
| [`LOCAL_SETUP.md`](./LOCAL_SETUP.md) | Local development instructions |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Complete deployment guide |
| [`DEPLOYMENT_CHECKLIST.md`](./DEPLOYMENT_CHECKLIST.md) | Step-by-step deployment checklist |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Common issues and solutions |
| [`SETUP_SUMMARY.md`](./SETUP_SUMMARY.md) | Architecture and setup overview |

## 🌐 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your GitHub repository
4. Add environment variables
5. Deploy!

See [`QUICK_START.md`](./QUICK_START.md) for detailed steps.

### Local Development

```bash
npm run dev
```

## 🔐 Environment Variables

Create `.env.local` from `.env.example`:

```bash
DATABASE_URL=postgresql://...    # Neon connection
JWT_SECRET=your-secret-key       # Random 32+ chars
DEEPSEEK_API_KEY=...             # For AI features (optional)
PTERODACTYL_URL=...              # For game servers (optional)
PTERODACTYL_API_KEY=...
# See .env.example for all options
```

## 📊 Project Structure

```
/
├── api/
│   └── index.js                 # Vercel serverless entry point
├── public/                      # Static files (served by Vercel CDN)
│   ├── *.html                   # Web pages
│   ├── *.css                    # Stylesheets
│   └── *.js                     # Client-side scripts
├── server.js                    # Express.js app setup
├── db.js                        # Database pool configuration
├── index.js                     # Development server entry
├── vercel.json                  # Deployment configuration
├── package.json                 # Dependencies
└── [Supporting modules]
    ├── pterodactylService.js
    ├── ryzeService.js
    ├── fivemAdvisor.js
    ├── mailer.js
    └── [Others...]
```

## 🔗 API Endpoints

All API endpoints are available at `/api/*`:

- `GET /api/config` - Get configuration
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `GET /api/user/profile` - Get user profile
- `POST /api/admin/*` - Admin endpoints (requires authentication)
- And many more...

## 🧪 Testing

```bash
# Test API locally
curl http://localhost:3001/api/config

# Test registration
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"pass"}'
```

## 📈 Monitoring

After deployment to Vercel:

1. View logs in Vercel dashboard
2. Monitor function execution time
3. Track database connection count
4. Review analytics

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for monitoring setup.

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test locally with `npm run dev`
4. Push to GitHub
5. Vercel automatically deploys

## 🆘 Troubleshooting

Having issues? Check [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for solutions to:

- Database connection errors
- Missing static files
- API 404 errors
- Authentication issues
- Performance problems
- And more!

## 📞 Support

- **Documentation**: See guides in this repo
- **Vercel Docs**: https://vercel.com/docs
- **Node.js Docs**: https://nodejs.org/docs
- **PostgreSQL**: https://www.postgresql.org/docs

## 📄 License

[Add your license here]

## 🎉 Ready to Deploy?

Start with [`QUICK_START.md`](./QUICK_START.md) for a 15-minute deployment!
