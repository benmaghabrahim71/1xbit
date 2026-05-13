require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const ptero = require('./pterodactylService');
const { PterodactylAdminClient, pteroErrorPayload, pickServerState, randomPassword } = require('./pterodactylAdminClient');
const ryze = require('./ryzeService');
const OpenAI = require('openai');
const crypto = require('crypto');
const mailer = require('./mailer');
const {
  buildPanelInfoPayload,
  buildPanelResourcePayload,
  extractAttributes
} = require('./gamePanelData');
const {
  applyRemediationToProvisionInput,
  buildAllocatorRequirements,
  buildPasswordStrengthError,
  calculateNodeAvailabilityWithCpu,
  chooseSmallestQualifiedNode,
  isGameHostingMetadata,
  pickClosestNode
} = require('./gameHostingWorkflow');
const {
  buildGeminiPromptContext,
  buildRuleBasedRecommendation,
  extractGeminiText,
  extractServerProfile,
  formatRuleBasedRecommendation,
  normalizeChatMessages
} = require('./fivemAdvisor');

const app = express();
const PORT = process.env.PORT || 3001;
const pteroAdmin = new PterodactylAdminClient();

// Deepseek AI Client
const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// reCAPTCHA verification helper
const verifyRecaptcha = async (token) => {
  if (process.env.RECAPTCHA_ENABLED !== 'true') return true;
  if (!token) return false;
  try {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
    );
    return response.data.success;
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    return false;
  }
};


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Public configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    recaptchaEnabled: process.env.RECAPTCHA_ENABLED === 'true',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
    fivemChatbotEnabled: true,
    fivemChatbotProvider: process.env.GEMINI_API_KEY ? 'gemini' : 'rule-based'
  });
});

app.get('/metrics', (req, res) => {
  const averageSeconds = PROM_METRICS.gameProvisionSuccesses
    ? (PROM_METRICS.gameProvisionTotalMs / PROM_METRICS.gameProvisionSuccesses) / 1000
    : 0;

  res.type('text/plain').send([
    '# HELP host1top_checkout_attempts_total Total checkout attempts',
    '# TYPE host1top_checkout_attempts_total counter',
    `host1top_checkout_attempts_total ${PROM_METRICS.checkoutAttempts}`,
    '# HELP host1top_checkout_success_total Total successful checkouts',
    '# TYPE host1top_checkout_success_total counter',
    `host1top_checkout_success_total ${PROM_METRICS.checkoutSuccesses}`,
    '# HELP host1top_checkout_failure_total Total failed checkouts',
    '# TYPE host1top_checkout_failure_total counter',
    `host1top_checkout_failure_total ${PROM_METRICS.checkoutFailures}`,
    '# HELP host1top_game_provision_attempts_total Total game provisioning attempts',
    '# TYPE host1top_game_provision_attempts_total counter',
    `host1top_game_provision_attempts_total ${PROM_METRICS.gameProvisionAttempts}`,
    '# HELP host1top_game_provision_success_total Total successful game provisioning attempts',
    '# TYPE host1top_game_provision_success_total counter',
    `host1top_game_provision_success_total ${PROM_METRICS.gameProvisionSuccesses}`,
    '# HELP host1top_game_provision_failure_total Total failed game provisioning attempts',
    '# TYPE host1top_game_provision_failure_total counter',
    `host1top_game_provision_failure_total ${PROM_METRICS.gameProvisionFailures}`,
    '# HELP host1top_game_provision_average_seconds Average successful game provisioning time',
    '# TYPE host1top_game_provision_average_seconds gauge',
    `host1top_game_provision_average_seconds ${averageSeconds.toFixed(3)}`
  ].join('\n'));
});

app.post('/api/ai/fivem-optimizer/chat', enforceFiveMChatRateLimit, async (req, res) => {
  const { message, messages, profile } = req.body || {};
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  if (!trimmedMessage) {
    return res.status(400).json({ error: 'A FiveM server question is required.' });
  }

  if (trimmedMessage.length > 4000) {
    return res.status(400).json({ error: 'Please keep the message under 4000 characters.' });
  }

  if (profile !== undefined && (typeof profile !== 'object' || Array.isArray(profile) || profile === null)) {
    return res.status(400).json({ error: 'Profile must be an object when provided.' });
  }

  const normalizedMessages = normalizeChatMessages(messages, trimmedMessage);
  const serverProfile = extractServerProfile({ profile, message: trimmedMessage, messages: normalizedMessages });
  const recommendation = buildRuleBasedRecommendation(serverProfile);
  const fallbackReply = formatRuleBasedRecommendation(recommendation);
  const geminiConfig = buildGeminiApiUrl();

  if (!geminiConfig.apiKey) {
    return res.json({
      reply: fallbackReply,
      analysis: recommendation,
      meta: {
        provider: 'rule-based',
        model: geminiConfig.model,
        usedFallback: true,
        fallbackReason: 'Gemini API key is not configured on the server.'
      }
    });
  }

  try {
    const geminiResponse = await axios.post(
      geminiConfig.url,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: buildGeminiPromptContext(normalizedMessages, recommendation) }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 1000
        }
      },
      {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const aiReply = extractGeminiText(geminiResponse.data);
    if (!aiReply) {
      return res.json({
        reply: fallbackReply,
        analysis: recommendation,
        meta: {
          provider: 'rule-based',
          model: geminiConfig.model,
          usedFallback: true,
          fallbackReason: 'Gemini returned an empty response.'
        }
      });
    }

    res.json({
      reply: aiReply,
      analysis: recommendation,
      meta: {
        provider: 'gemini',
        model: geminiConfig.model,
        usedFallback: false
      }
    });
  } catch (error) {
    const statusCode = error.response?.status || 500;
    console.error('[FiveM Chatbot] Gemini request failed:', {
      statusCode,
      message: error.message,
      details: error.response?.data
    });

    res.json({
      reply: [
        fallbackReply,
        '',
        '## API Status',
        `- ${buildFiveMChatbotFallbackNotice(statusCode)}`
      ].join('\n'),
      analysis: recommendation,
      meta: {
        provider: 'rule-based',
        model: geminiConfig.model,
        usedFallback: true,
        fallbackReason: buildFiveMChatbotFallbackNotice(statusCode),
        geminiStatus: statusCode
      }
    });
  }
});

// Middleware: Secure routes with APP_API_KEY
const secureRoute = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.APP_API_KEY) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid API Key' });
  }
};

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Simple User Middleware for Client Area (Legacy)
const userAuth = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    req.userId = userId;
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Admin Authentication Middleware
const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }
    
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    
    // Verify token
    const decoded = jwt.verify(token, secret);
    
    // Check role in DB (most secure)
    const [users] = await pool.query('SELECT role FROM users WHERE id = ?', [decoded.id]);
    
    if (users.length === 0 || (users[0].role !== 'admin' && users[0].role !== 'super_admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.user = decoded;
    req.user.role = users[0].role;
    next();
  } catch (err) {
    console.error('Admin auth error:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(401).json({ error: 'Unauthorized access' });
  }
};

// Initialize Database Tables
const initDB = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Connected to Neon PostgreSQL database.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        balance NUMERIC(10, 2) DEFAULT 0.00,
        total_spent NUMERIC(10, 2) DEFAULT 0.00,
        credits INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        role VARCHAR(20) DEFAULT 'user',
        last_login TIMESTAMPTZ NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        phone VARCHAR(50),
        two_factor_enabled BOOLEAN DEFAULT false,
        two_factor_secret VARCHAR(255),
        last_login_ip VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255)`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255)`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255)`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(100)`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
    await connection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pterodactyl_user_id INT`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        memory INT DEFAULT 1024,
        cpu INT DEFAULT 100,
        disk INT DEFAULT 2048,
        swap INT DEFAULT 0,
        io INT DEFAULT 500,
        nest_id INT,
        egg_id INT,
        location_id INT,
        docker_image VARCHAR(255),
        startup TEXT,
        port_range VARCHAR(255),
        databases INT DEFAULT 0,
        allocations INT DEFAULT 0,
        backups INT DEFAULT 0,
        oom_disabled BOOLEAN DEFAULT false,
        billing_cycle VARCHAR(50) DEFAULT 'Monthly',
        provider VARCHAR(50) DEFAULT 'pterodactyl',
        game_name VARCHAR(100),
        ryze_plan_id VARCHAR(100),
        ryze_os_name VARCHAR(100),
        ryze_cpu_type VARCHAR(100),
        ryze_cores INT DEFAULT 1,
        description TEXT,
        tier VARCHAR(50) DEFAULT 'Standard',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS swap INT DEFAULT 0`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS io INT DEFAULT 500`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS nest_id INT`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS startup TEXT`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS port_range VARCHAR(255)`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS databases INT DEFAULT 0`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS allocations INT DEFAULT 0`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS backups INT DEFAULT 0`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS oom_disabled BOOLEAN DEFAULT false`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(50) DEFAULT 'Monthly'`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'pterodactyl'`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS game_name VARCHAR(100)`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS ryze_plan_id VARCHAR(100)`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS ryze_os_name VARCHAR(100)`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS ryze_cpu_type VARCHAR(100)`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS ryze_cores INT DEFAULT 1`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT`);
    await connection.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'Standard'`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        amount NUMERIC(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        plan_id INT REFERENCES plans(id),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        service_type VARCHAR(50),
        service_uuid VARCHAR(255),
        hostname VARCHAR(255),
        plan_id INT REFERENCES plans(id),
        memory INT,
        cpu INT,
        disk INT,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        expires_at TIMESTAMPTZ,
        auto_renew BOOLEAN DEFAULT false,
        protection_enabled BOOLEAN DEFAULT false,
        os_name VARCHAR(100),
        region VARCHAR(100),
        ryze_vmid VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS hostname VARCHAR(255)`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS memory INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cpu INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS disk INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS protection_enabled BOOLEAN DEFAULT false`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS os_name VARCHAR(100)`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS region VARCHAR(100)`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ryze_vmid VARCHAR(50)`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_server_id INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_user_id INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_allocation_id INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_egg_id INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_node_id INT`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pterodactyl_install_state VARCHAR(50)`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS order_metadata JSONB DEFAULT '{}'::jsonb`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provisioning_state VARCHAR(50) DEFAULT 'active'`);
    await connection.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS frozen_reason TEXT`);
    console.log('[initDB] Verified ryze_vmid column');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS vps_stats (
        id SERIAL PRIMARY KEY,
        service_uuid VARCHAR(255),
        cpu_usage NUMERIC(5, 2),
        mem_usage_mb INT,
        disk_usage_gb NUMERIC(10, 2),
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_vps_stats_service_uuid ON vps_stats(service_uuid)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_vps_stats_timestamp ON vps_stats(timestamp)`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_stats (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        total_services INT DEFAULT 0,
        active_services INT DEFAULT 0,
        total_invoices INT DEFAULT 0,
        paid_invoices INT DEFAULT 0,
        support_tickets INT DEFAULT 0,
        last_activity TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        type VARCHAR(20) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        description VARCHAR(255),
        reference_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id SERIAL PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        amount NUMERIC(10, 2) NOT NULL,
        max_redemptions INT NOT NULL DEFAULT 1,
        redeemed_count INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NULL,
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS redeemed_count INT NOT NULL DEFAULT 0`);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS notes TEXT`);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id)`);
    await connection.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS voucher_redemptions (
        id SERIAL PRIMARY KEY,
        voucher_id INT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        transaction_id INT REFERENCES transactions(id) ON DELETE SET NULL,
        amount NUMERIC(10, 2) NOT NULL,
        redeemed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(voucher_id, user_id)
      )
    `);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_expires_at ON vouchers(expires_at)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_user_id ON voucher_redemptions(user_id)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_voucher_id ON voucher_redemptions(voucher_id)`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        priority VARCHAR(20) DEFAULT 'medium',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS support_replies (
        id SERIAL PRIMARY KEY,
        ticket_id INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        browser_enabled BOOLEAN DEFAULT true,
        in_app_enabled BOOLEAN DEFAULT true,
        email_enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(80) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        metadata JSONB,
        read_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at)`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email)`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS pterodactyl_audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        subscription_id INT REFERENCES subscriptions(id) ON DELETE SET NULL,
        action VARCHAR(120) NOT NULL,
        success BOOLEAN DEFAULT false,
        status_code INT,
        request_payload JSONB,
        response_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_ptero_audit_user ON pterodactyl_audit_logs(user_id)`);
    await connection.query(`CREATE INDEX IF NOT EXISTS idx_ptero_audit_subscription ON pterodactyl_audit_logs(subscription_id)`);

    console.log('Database tables initialized.');
  } catch (err) {
    console.error('Database initialization failed:', err);
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

initDB();

const isAdminPterodactylEnabled = () => process.env.ADMIN_PTERODACTYL_ENABLED === 'true';

const buildPterodactylEnvironmentFromOrder = ({ plan, order, subscriptionId, user }) => {
  const baseName = order.hostname || `${plan.name}-${user.id}`;
  const safeDb = `db_${String(baseName).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 24)}`;
  const productName = order.plan_name || order.game_name || plan.game_name || plan.name;

  return {
    SERVER_NAME: baseName,
    PRODUCT_NAME: productName,
    PTERODACTYL_EGG_NAME: productName,
    MYSQL_DB: safeDb,
    MYSQL_DATABASE: safeDb,
    ORDER_EMAIL: user.email,
    ORDER_USERNAME: user.username,
    ORDER_ID: String(subscriptionId),
    HOST1TOP_PLAN: plan.name,
    GAME_NAME: order.game_name || plan.game_name || plan.name,
    ...(order.environment || {})
  };
};

const normalizePterodactylApiError = (err) => ({
  message: err.message,
  details: pteroErrorPayload(err),
  rollback: err.rollbackError || null
});

const PROM_METRICS = {
  checkoutAttempts: 0,
  checkoutSuccesses: 0,
  checkoutFailures: 0,
  gameProvisionAttempts: 0,
  gameProvisionSuccesses: 0,
  gameProvisionFailures: 0,
  gameProvisionTotalMs: 0
};

const FIVEM_CHATBOT_RATE_LIMIT_WINDOW_MS = Math.max(10000, Number(process.env.FIVEM_CHATBOT_RATE_LIMIT_WINDOW_MS) || 60000);
const FIVEM_CHATBOT_RATE_LIMIT_MAX = Math.max(1, Number(process.env.FIVEM_CHATBOT_RATE_LIMIT_MAX) || 8);
const fiveMChatbotRateLimitStore = new Map();
const notificationStreamClients = new Map();

const MASKED_AUDIT_KEYS = ['password', 'token', 'authorization', 'api_key', 'x-api-key'];

function sanitizePanelUrl(value = process.env.PTERODACTYL_URL || 'https://gp.host1top.com') {
  const raw = String(value || '').trim();
  if (!raw) return 'https://gp.host1top.com';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function redactSensitive(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry));

  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    if (MASKED_AUDIT_KEYS.includes(String(key).toLowerCase())) {
      clone[key] = '[REDACTED]';
    } else if (entry && typeof entry === 'object') {
      clone[key] = redactSensitive(entry);
    } else {
      clone[key] = entry;
    }
  }
  return clone;
}

function buildCsrfToken(userId, authToken) {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return crypto.createHmac('sha256', secret).update(`${userId}:${authToken}`).digest('hex');
}

function writeSseEvent(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addNotificationStreamClient(userId, response) {
  const clients = notificationStreamClients.get(userId) || new Set();
  const client = {
    response,
    heartbeat: setInterval(() => {
      try {
        writeSseEvent(response, 'ping', { ok: true, ts: Date.now() });
      } catch (error) {
        // The close handler below performs actual cleanup.
      }
    }, 25000)
  };

  clients.add(client);
  notificationStreamClients.set(userId, clients);
  return client;
}

function removeNotificationStreamClient(userId, client) {
  if (!client) return;
  clearInterval(client.heartbeat);
  const clients = notificationStreamClients.get(userId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) {
    notificationStreamClients.delete(userId);
  }
}

function broadcastNotificationRefresh(userId, reason = 'refresh') {
  const clients = notificationStreamClients.get(userId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    try {
      writeSseEvent(client.response, 'notification', {
        reason,
        ts: Date.now()
      });
    } catch (error) {
      removeNotificationStreamClient(userId, client);
    }
  }
}

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0];

  return rawIp.replace(/^::ffff:/, '').trim() || 'unknown';
}

function enforceFiveMChatRateLimit(req, res, next) {
  const now = Date.now();
  const ip = getRequestIp(req);
  const recentRequests = (fiveMChatbotRateLimitStore.get(ip) || []).filter(
    (timestamp) => now - timestamp < FIVEM_CHATBOT_RATE_LIMIT_WINDOW_MS
  );

  if (recentRequests.length >= FIVEM_CHATBOT_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((FIVEM_CHATBOT_RATE_LIMIT_WINDOW_MS - (now - recentRequests[0])) / 1000)
    );
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      error: 'Too many FiveM optimization requests. Please wait a moment before sending another message.'
    });
  }

  recentRequests.push(now);
  fiveMChatbotRateLimitStore.set(ip, recentRequests);
  next();
}

function buildGeminiApiUrl() {
  const model = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  return {
    model,
    apiKey,
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  };
}

function buildFiveMChatbotFallbackNotice(statusCode) {
  if (statusCode === 429) {
    return 'Gemini quota or rate limits were reached, so the response falls back to the built-in FiveM sizing engine.';
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'Gemini authentication failed, so the response falls back to the built-in FiveM sizing engine.';
  }
  return 'Gemini was temporarily unavailable, so the response falls back to the built-in FiveM sizing engine.';
}

function requireCsrfToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1];
  const csrfHeader = req.headers['x-csrf-token'];
  if (!token || !csrfHeader || csrfHeader !== buildCsrfToken(req.user.id, token)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

async function logPterodactylAudit(connection, {
  userId = null,
  subscriptionId = null,
  action,
  success = false,
  statusCode = null,
  requestPayload = null,
  responsePayload = null
}) {
  try {
    await connection.query(
      `INSERT INTO pterodactyl_audit_logs (user_id, subscription_id, action, success, status_code, request_payload, response_payload)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)`,
      [
        userId,
        subscriptionId,
        action,
        success,
        statusCode,
        JSON.stringify(redactSensitive(requestPayload || {})),
        JSON.stringify(redactSensitive(responsePayload || {}))
      ]
    );
  } catch (err) {
    console.warn('[Pterodactyl Audit] Failed to persist audit log:', err.message);
  }
}

async function retryWithBackoff(operation, { maxAttempts = 3, baseDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

async function callAiService(path, payload) {
  const baseUrl = process.env.AI_SERVICE_URL || process.env.AI_ALLOCATOR_BASE_URL || '';
  if (!baseUrl) return null;
  const response = await axios.post(`${String(baseUrl).replace(/\/$/, '')}${path}`, payload, { timeout: 10000 });
  return response.data;
}

async function allocateGameNode(requirements) {
  const nodes = await pteroAdmin.listNodes();
  const normalizedRequirements = buildAllocatorRequirements(requirements);
  const availabilityWithCpu = (node) => calculateNodeAvailabilityWithCpu(
    pteroAdmin.calculateNodeAvailability.bind(pteroAdmin),
    node
  );

  try {
    const aiResult = await callAiService('/ai/allocate', {
      requirements: normalizedRequirements,
      nodes: nodes.map((node) => {
        const attrs = node.attributes || {};
        const availability = availabilityWithCpu(node);
        return {
          id: Number(attrs.id),
          name: attrs.name,
          location: attrs.relationships?.location?.attributes?.short || attrs.relationships?.location?.attributes?.long || null,
          free_cpu: availability.freeCpu,
          free_ram: availability.freeMemory,
          free_disk: availability.freeDisk
        };
      })
    });

    if (aiResult?.selected_node_id) {
      return {
        nodeId: Number(aiResult.selected_node_id),
        ai: aiResult,
        downgraded: false
      };
    }
    if (aiResult?.suggested_node_id) {
      return {
        nodeId: Number(aiResult.suggested_node_id),
        ai: aiResult,
        downgraded: true
      };
    }
  } catch (err) {
    console.warn('[AI Allocate] Falling back to local allocator:', err.message);
  }

  const qualified = chooseSmallestQualifiedNode(nodes, normalizedRequirements, availabilityWithCpu);

  if (qualified) {
    return {
      nodeId: Number(qualified.node.attributes.id),
      ai: { fallback: 'local-smallest-fit' },
      downgraded: false
    };
  }

  const closest = pickClosestNode(nodes, normalizedRequirements, availabilityWithCpu);
  return {
    nodeId: closest?.nodeId || null,
    ai: closest ? { fallback: 'local-closest-fit', suggestion: closest } : null,
    downgraded: true
  };
}

async function diagnosePterodactylFailure(payload) {
  try {
    return await callAiService('/ai/diagnose', payload);
  } catch (err) {
    console.warn('[AI Diagnose] Unavailable:', err.message);
    return null;
  }
}

function buildPasswordSetLink(serviceUuid, token) {
  const base = process.env.FRONTEND_URL || 'http://localhost:3001';
  const url = new URL('/client-area.html', base);
  url.searchParams.set('section', 'game-panel');
  if (serviceUuid) url.searchParams.set('service', serviceUuid);
  if (token) url.searchParams.set('setPasswordToken', token);
  return url.toString();
}

async function storeProvisioningAccessMetadata(connection, subscriptionId, { serviceUuid, generatedPassword, pterodactylUserId, panelUrl }) {
  const passwordChangeToken = crypto.randomBytes(24).toString('base64url');
  const passwordHash = generatedPassword ? await bcrypt.hash(generatedPassword, 10) : null;
  const tokenHash = await bcrypt.hash(passwordChangeToken, 10);
  const metadata = {
    pterodactyl_user_id: pterodactylUserId,
    pterodactyl_panel_url: sanitizePanelUrl(panelUrl),
    pending_pterodactyl_password_hash: passwordHash,
    pending_pterodactyl_password_token_hash: tokenHash,
    pending_pterodactyl_password_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    pending_pterodactyl_password_issued_at: new Date().toISOString()
  };

  await connection.query(
    'UPDATE subscriptions SET order_metadata = COALESCE(order_metadata, \'{}\'::jsonb) || ?::jsonb WHERE id = ?',
    [JSON.stringify(metadata), subscriptionId]
  );

  return passwordChangeToken;
}

function parseOrderMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return {};
  }
}

function sanitizeGameServiceMetadata(metadata = {}) {
  const normalized = parseOrderMetadata(metadata);
  return {
    ...normalized,
    pterodactyl_panel_url: sanitizePanelUrl(normalized.pterodactyl_panel_url),
    service_category: normalized.service_category || 'game-hosting'
  };
}

function buildGamePanelServiceRecord(subscription, remote = null) {
  const metadata = sanitizeGameServiceMetadata(subscription.order_metadata);
  const remoteNode = remote?.relationships?.node?.attributes?.name || null;
  const remoteEgg = remote?.relationships?.egg?.attributes?.name || null;
  const remoteIdentifier = remote?.identifier || null;
  return {
    id: subscription.id,
    service_uuid: subscription.service_uuid,
    service_name: remote?.name || subscription.service_name,
    hostname: subscription.hostname || `${subscription.service_type.toLowerCase()}.host1top.com`,
    pricing_cycle: subscription.pricing_cycle,
    next_due: subscription.expires_at ? new Date(subscription.expires_at).toISOString().split('T')[0] : 'Never',
    status: subscription.status,
    service_type: subscription.service_type,
    service_category: metadata.service_category,
    memory: subscription.memory,
    cpu: subscription.cpu,
    disk: subscription.disk,
    price: parseFloat(subscription.price),
    panel_identifier: remoteIdentifier,
    panel_node: remoteNode,
    panel_egg: remoteEgg,
    pterodactyl_panel_url: metadata.pterodactyl_panel_url,
    pterodactyl_user_id: metadata.pterodactyl_user_id || subscription.pterodactyl_user_id || null,
    password_change_link: metadata.password_change_link || buildPasswordSetLink(subscription.service_uuid),
    has_pending_password_setup: Boolean(
      metadata.pending_pterodactyl_password_hash &&
      metadata.pending_pterodactyl_password_token_hash &&
      (!metadata.pending_pterodactyl_password_expires_at || new Date(metadata.pending_pterodactyl_password_expires_at) > new Date())
    )
  };
}

async function getOwnedGameService(connection, userId, uuid) {
  const [rows] = await connection.query(
    `SELECT s.id, s.user_id, s.service_type, s.service_uuid, s.hostname, s.expires_at, s.status, s.memory, s.cpu, s.disk,
            s.order_metadata, s.pterodactyl_server_id, s.pterodactyl_user_id,
            COALESCE(p.name, s.hostname, 'Game Server') AS service_name,
            COALESCE(p.billing_cycle, 'Monthly') AS pricing_cycle,
            COALESCE(p.price, 0.00) AS price
     FROM subscriptions s
     LEFT JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = ? AND s.service_type = 'GAME' AND (s.service_uuid = ? OR REPLACE(s.service_uuid, '-', '') = ?)
     LIMIT 1`,
    [userId, uuid, normalizeUuid(uuid)]
  );
  return rows[0] || null;
}

async function clearPendingPterodactylPasswordMetadata(connection, subscriptionId, metadata) {
  const nextMetadata = { ...sanitizeGameServiceMetadata(metadata) };
  delete nextMetadata.pending_pterodactyl_password_hash;
  delete nextMetadata.pending_pterodactyl_password_token_hash;
  delete nextMetadata.pending_pterodactyl_password_expires_at;
  delete nextMetadata.pending_pterodactyl_password_issued_at;
  nextMetadata.last_pterodactyl_password_change_at = new Date().toISOString();

  await connection.query(
    'UPDATE subscriptions SET order_metadata = ?::jsonb WHERE id = ?',
    [JSON.stringify(nextMetadata), subscriptionId]
  );

  return nextMetadata;
}

async function validatePendingPasswordSetupToken(metadata, token) {
  if (!token || !metadata?.pending_pterodactyl_password_token_hash) {
    return false;
  }
  if (metadata.pending_pterodactyl_password_expires_at) {
    const expiresAt = new Date(metadata.pending_pterodactyl_password_expires_at);
    if (Number.isFinite(expiresAt.getTime()) && expiresAt <= new Date()) {
      return false;
    }
  }
  return bcrypt.compare(token, metadata.pending_pterodactyl_password_token_hash);
}

async function freezeOrderAndOpenTicket(connection, { userId, subscriptionId, planName, reason, details }) {
  await connection.query(
    "UPDATE subscriptions SET status = 'FROZEN', provisioning_state = 'frozen', frozen_reason = ? WHERE id = ?",
    [reason, subscriptionId]
  );

  const [ticketResult] = await connection.query(
    "INSERT INTO support_tickets (user_id, subject, message, priority, status) VALUES (?, ?, ?, 'high', 'open') RETURNING id",
    [
      userId,
      `Provisioning issue: ${planName}`,
      `${reason}\n\n${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`
    ]
  );

  return ticketResult.insertId || null;
}

async function syncLocalPterodactylUser(connection, localUserId, pterodactylUserId) {
  await connection.query(
    'UPDATE users SET pterodactyl_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [pterodactylUserId, localUserId]
  );
}

async function provisionGameOrderWithAdminClient({ connection, req, plan, usersRow, subResult, hostname, os_name, region }) {
  const requestPayload = {
    localUserId: req.user.id,
    email: usersRow.email || req.user.email,
    username: usersRow.username,
    firstName: usersRow.first_name || usersRow.username || 'User',
    lastName: usersRow.last_name || 'Client',
    userExternalId: `host1top-user-${req.user.id}`,
    nodeId: req.body.node_id || plan.node_id || plan.location_id || null,
    nestId: Number(plan.nest_id || req.body.nest_id),
    eggId: Number(plan.egg_id || req.body.egg_id),
    name: hostname || req.body.server_name || req.body.plan_name || `${plan.name}-${req.user.id}`,
    memory: Number(plan.memory || req.body.memory || 1024),
    disk: Number(plan.disk || req.body.disk || 2048),
    cpu: Number(plan.cpu || req.body.cpu || 100),
    dockerImage: plan.docker_image || req.body.docker_image,
    startup: plan.startup || req.body.startup,
    environment: buildPterodactylEnvironmentFromOrder({
      plan,
      order: req.body,
      subscriptionId: subResult.insertId,
      user: {
        id: req.user.id,
        email: usersRow.email || req.user.email,
        username: usersRow.username
      }
    }),
    serverExternalId: `host1top-sub-${subResult.insertId}`,
    externalId: `host1top-sub-${subResult.insertId}`
  };

  const allocationDecision = await allocateGameNode({
    cpu: requestPayload.cpu,
    memory: requestPayload.memory,
    disk: requestPayload.disk,
    location: req.body.region || region || null
  });

  if (!requestPayload.nodeId && allocationDecision.nodeId) {
    requestPayload.nodeId = allocationDecision.nodeId;
  }

  if (allocationDecision.downgraded && req.body.allow_allocator_downgrade !== true) {
    const downgradeError = new Error('No node currently satisfies the exact requested resources. Confirmation required for suggested downgrade.');
    downgradeError.statusCode = 409;
    downgradeError.payload = {
      requires_confirmation: true,
      suggested_node_id: allocationDecision.nodeId,
      suggestion: allocationDecision.ai?.suggestion || allocationDecision.ai || null
    };
    throw downgradeError;
  }

  const provisioningStartedAt = Date.now();
  PROM_METRICS.gameProvisionAttempts += 1;

  let attemptInput = { ...requestPayload };
  let remediationApplied = false;

  while (true) {
    try {
      const provisioned = await retryWithBackoff(
        () => pteroAdmin.provisionGameServer(attemptInput),
        { maxAttempts: 3, baseDelayMs: 500 }
      );

      const passwordChangeToken = await storeProvisioningAccessMetadata(connection, subResult.insertId, {
        serviceUuid: provisioned.server.uuid || provisioned.server.identifier,
        generatedPassword: provisioned.generatedPassword || null,
        pterodactylUserId: provisioned.pterodactylUser.id,
        panelUrl: sanitizePanelUrl()
      });

      await syncLocalPterodactylUser(connection, req.user.id, provisioned.pterodactylUser.id);
      await connection.query(
        `UPDATE subscriptions
         SET service_uuid = ?, status = 'ACTIVE', provisioning_state = 'active', pterodactyl_server_id = ?, pterodactyl_allocation_id = ?, pterodactyl_egg_id = ?, pterodactyl_node_id = ?, pterodactyl_install_state = ?, hostname = ?, os_name = ?, region = ?,
             order_metadata = COALESCE(order_metadata, '{}'::jsonb) || ?::jsonb
         WHERE id = ?`,
        [
          provisioned.server.uuid || provisioned.server.identifier,
          provisioned.server.id,
          provisioned.allocationId,
          Number(attemptInput.eggId),
          Number(provisioned.nodeId || attemptInput.nodeId || 0),
          provisioned.lifecycle,
          hostname || `${plan.name.toLowerCase().replace(/\s+/g, '-')}.local`,
          os_name || 'Ubuntu 22.04',
          region || 'Eygelshoven, Niederlande',
          JSON.stringify({
            service_category: 'game-hosting',
            ai_allocator: allocationDecision.ai || null,
            pterodactyl_panel_url: sanitizePanelUrl(),
            pterodactyl_user_id: provisioned.pterodactylUser.id,
            pterodactyl_egg_name: provisioned.eggName || req.body.plan_name || plan.name,
            provisioned_spec: provisioned.requestedSpec || null,
            password_change_link: buildPasswordSetLink(provisioned.server.uuid || provisioned.server.identifier, passwordChangeToken)
          }),
          subResult.insertId
        ]
      );

      await logPterodactylAudit(connection, {
        userId: req.user.id,
        subscriptionId: subResult.insertId,
        action: 'checkout.provision_game',
        success: true,
        statusCode: 200,
        requestPayload: attemptInput,
        responsePayload: {
          server: provisioned.server,
          nodeId: provisioned.nodeId,
          allocationId: provisioned.allocationId,
          lifecycle: provisioned.lifecycle
        }
      });

      PROM_METRICS.gameProvisionSuccesses += 1;
      PROM_METRICS.gameProvisionTotalMs += Date.now() - provisioningStartedAt;

      return {
        ...provisioned,
        allocationDecision,
        passwordChangeToken
      };
    } catch (err) {
      const diagnosis = await diagnosePterodactylFailure({
        statusCode: err.response?.status || err.statusCode || 500,
        errorBody: normalizePterodactylApiError(err),
        lastRequestPayload: attemptInput
      });

      await logPterodactylAudit(connection, {
        userId: req.user.id,
        subscriptionId: subResult.insertId,
        action: remediationApplied ? 'checkout.provision_game.retry_failed' : 'checkout.provision_game.failed',
        success: false,
        statusCode: err.response?.status || err.statusCode || 500,
        requestPayload: attemptInput,
        responsePayload: diagnosis || normalizePterodactylApiError(err)
      });

      if (!remediationApplied && diagnosis) {
        remediationApplied = true;
        attemptInput = applyRemediationToProvisionInput(attemptInput, diagnosis);
        continue;
      }

      PROM_METRICS.gameProvisionFailures += 1;
      throw err;
    }
  }
}

const normalizeVoucherCode = (code = '') => String(code).trim().toUpperCase();

const generateRandomVoucherSuffix = (length = 8) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, alphabet.length);
    result += alphabet[index];
  }
  return result;
};

const generateVoucherCode = (prefix = 'H1T', length = 8) => {
  const normalizedPrefix = String(prefix || 'H1T')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return `${normalizedPrefix}-${generateRandomVoucherSuffix(Math.min(Math.max(length, 4), 16))}`;
};

const createVoucherBatch = async (connection, options, adminUserId) => {
  const {
    amount,
    maxRedemptions,
    expiresAt,
    notes,
    quantity,
    code,
    prefix,
    codeLength
  } = options;

  const createdVouchers = [];

  for (let i = 0; i < quantity; i += 1) {
    let nextCode = code && quantity === 1 ? normalizeVoucherCode(code) : '';
    let attempts = 0;

    while (attempts < 12) {
      if (!nextCode) {
        nextCode = generateVoucherCode(prefix, codeLength);
      }

      try {
        const [insertResult] = await connection.query(
          `INSERT INTO vouchers (code, amount, max_redemptions, expires_at, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
          [nextCode, amount, maxRedemptions, expiresAt || null, notes || null, adminUserId]
        );

        createdVouchers.push({
          id: insertResult.insertId,
          code: nextCode,
          amount,
          max_redemptions: maxRedemptions,
          expires_at: expiresAt || null,
          notes: notes || null
        });
        break;
      } catch (err) {
        if (err.code === '23505') {
          if (code && quantity === 1) {
            throw new Error('Voucher code already exists');
          }
          nextCode = '';
          attempts += 1;
          continue;
        }
        throw err;
      }
    }

    if (!createdVouchers[i]) {
      throw new Error('Failed to generate a unique voucher code');
    }
  }

  return createdVouchers;
};

// --- AUTHENTICATION ROUTES ---

// Ryze Proxy Endpoints
app.get('/api/ryze/os', async (req, res) => {
  try {
    const response = await ryze.listOperatingSystems();
    // Ryze typically returns { data: [...] } or { data: { list: [...] } }
    const osList = response.data?.list || response.data || [];
    res.json({ data: osList });
  } catch (err) {
    console.error('Ryze OS list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch OS list from Ryze' });
  }
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, recaptchaToken } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  // Verify reCAPTCHA
  const isHuman = await verifyRecaptcha(recaptchaToken);
  if (!isHuman) {
    return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  }
  
  // Validate input
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Check if user exists
    const [existingUsers] = await connection.query(
      'SELECT id FROM users WHERE username = ? OR email = ?', 
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user with all values initialized to 0
    const [userResult] = await connection.query(
      "INSERT INTO users (username, email, password, balance, total_spent, credits, status) VALUES (?, ?, ?, 0.00, 0.00, 0, 'active') RETURNING id",
      [username, email, hashedPassword]
    );
    
    const userId = userResult.insertId;
    
    // Initialize user stats with all values at 0
    await connection.query(
      'INSERT INTO user_stats (user_id, total_services, active_services, total_invoices, paid_invoices, support_tickets) VALUES (?, 0, 0, 0, 0, 0)',
      [userId]
    );
    
    // Create welcome transaction (0.00 credit for registration)
    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, description, status) VALUES (?, 'credit', 0.00, 'Welcome bonus', 'completed')",
      [userId]
    );
    
    await connection.commit();
    
    // Create JWT token
    const token = jwt.sign(
      { id: userId, username, email }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );
    
    // Get complete user data
    const [userData] = await connection.query(
      'SELECT id, username, email, balance, total_spent, credits, status, created_at FROM users WHERE id = ?',
      [userId]
    );
    
    // Get user stats
    const [userStats] = await connection.query(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [userId]
    );
    
    connection.release();
    
    // Send welcome email (fire-and-forget)
    mailer.sendWelcome({ to: email, username }).catch(e => console.error('[Mailer] Welcome fail:', e.message));
    
    res.status(201).json({ 
      message: 'User registered successfully',
      token,
      user: userData[0],
      stats: userStats[0]
    });
    
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password, recaptchaToken } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Verify reCAPTCHA
  const isHuman = await verifyRecaptcha(recaptchaToken);
  if (!isHuman) {
    return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Find user by username or email
    const [users] = await connection.query(
      'SELECT * FROM users WHERE username = ? OR email = ?', 
      [username, username]
    );
    
    if (users.length === 0) {
      connection.release();
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = users[0];
    
    // Check if user is banned or suspended
    if (user.status === 'banned') {
      connection.release();
      return res.status(403).json({ error: 'Account banned' });
    }
    
    if (user.status === 'suspended') {
      connection.release();
      return res.status(403).json({ error: 'Account suspended' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      connection.release();
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login and activity
    await connection.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );
    
    await connection.query(
      'UPDATE user_stats SET last_activity = CURRENT_TIMESTAMP WHERE user_id = ?',
      [user.id]
    );
    
    // Get complete user data
    const [userData] = await connection.query(
      'SELECT id, username, email, balance, total_spent, credits, status, last_login, created_at FROM users WHERE id = ?',
      [user.id]
    );
    
    // Get user stats
    const [userStats] = await connection.query(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [user.id]
    );
    
    connection.release();
    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );
    
    // Only send login alert if IP has changed from last known login IP
    const currentIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'Unknown';
    const lastIp = user.last_login_ip || null;
    if (currentIp !== '::1' && currentIp !== '127.0.0.1' && currentIp !== lastIp) {
      mailer.sendLoginAlert({ to: user.email, username: user.username, ip: currentIp, time: new Date().toUTCString() })
        .catch(e => console.error('[Mailer] Login alert fail:', e.message));
    }
    // Update stored last_login_ip
    pool.query('UPDATE users SET last_login_ip = ? WHERE id = ?', [currentIp, user.id]).catch(() => {});
    
    res.json({ 
      message: 'Login successful',
      token,
      user: userData[0],
      stats: userStats[0]
    });
    
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot Password - Send Token
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email, recaptchaToken } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Verify reCAPTCHA
  const isHuman = await verifyRecaptcha(recaptchaToken);
  if (!isHuman) {
    return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  }

  try {
    const connection = await pool.getConnection();
    const [users] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      connection.release();
      return res.json({ message: 'If an account exists with this email, you will receive a reset link.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await connection.query(
      'INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)',
      [email, token, expiresAt]
    );
    connection.release();

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/my-account.html?token=${token}`;

    await mailer.sendPasswordReset({ to: email, resetLink });
    res.json({ message: 'If an account exists with this email, you will receive a reset link.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send recovery email' });
  }
});

// Reset Password - Verify Token & Update
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });

  try {
    const connection = await pool.getConnection();
    const [tokens] = await connection.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      connection.release();
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const email = tokens[0].email;
    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.beginTransaction();
    await connection.query('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
    await connection.query('DELETE FROM password_reset_tokens WHERE email = ?', [email]);
    await connection.commit();
    
    connection.release();
    
    res.json({ message: 'Password updated successfully' });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user with complete data
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Get user data
    const [users] = await connection.query(
      'SELECT id, username, email, role, first_name, last_name, phone, two_factor_enabled, balance, total_spent, credits, status, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get user stats
    const [userStats] = await connection.query(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [req.user.id]
    );
    
    // Get recent transactions
    const [transactions] = await connection.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.user.id]
    );
    
    // Get active subscriptions
    const [subscriptions] = await connection.query(
      "SELECT s.*, p.name as plan_name, p.type as service_type FROM subscriptions s LEFT JOIN plans p ON s.plan_id = p.id WHERE s.user_id = ? AND s.status = 'ACTIVE'",
      [req.user.id]
    );
    
    // Get recent invoices
    const [invoices] = await connection.query(
      'SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [req.user.id]
    );
    
    res.json({ 
      user: users[0],
      stats: userStats[0] || null,
      transactions,
      subscriptions,
      invoices
    });
    
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/auth/csrf', authenticateToken, async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1];
  res.json({ csrfToken: buildCsrfToken(req.user.id, token) });
});

// Update profile details
app.post('/api/user/profile', authenticateToken, async (req, res) => {
  const { first_name, last_name, phone, current_password, new_password, two_factor_enabled } = req.body;
  
  try {
    const connection = await pool.getConnection();
    
    // Get current user to check password if needed
    const [users] = await connection.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const user = users[0];
    
    let passwordUpdateQuery = '';
    let passwordParams = [];
    
    // If password change requested
    if (new_password) {
      if (!current_password) {
        connection.release();
        return res.status(400).json({ error: 'Current password required to change password' });
      }
      
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        connection.release();
        return res.status(401).json({ error: 'Invalid current password' });
      }
      
      const hashedPassword = await bcrypt.hash(new_password, 10);
      passwordUpdateQuery = ', password = ?';
      passwordParams.push(hashedPassword);
    }
    
    // Update basic info and 2FA
    await connection.query(
      `UPDATE users SET first_name = ?, last_name = ?, phone = ?, two_factor_enabled = ? ${passwordUpdateQuery} WHERE id = ?`,
      [first_name || null, last_name || null, phone || null, two_factor_enabled ? 1 : 0, ...passwordParams, req.user.id]
    );
    
    connection.release();
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// --- USER DASHBOARD ENDPOINTS ---

// Get user dashboard data
app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get user overview
    const [user] = await connection.query(
      'SELECT id, username, email, balance, total_spent, credits, status FROM users WHERE id = ?',
      [req.user.id]
    );
    
    // Get user statistics
    const [stats] = await connection.query(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [req.user.id]
    );
    
    // Get service counts
    const [serviceCounts] = await connection.query(
      `SELECT 
        COUNT(CASE WHEN service_type = 'VPS' THEN 1 END) as vps_count,
        COUNT(CASE WHEN service_type = 'RDP' THEN 1 END) as rdp_count,
        COUNT(CASE WHEN service_type = 'GAME' THEN 1 END) as game_count
      FROM subscriptions WHERE user_id = ? AND status = 'ACTIVE'`,
      [req.user.id]
    );
    
    // Get recent activity
    const [recentActivity] = await connection.query(
      `SELECT 
        'transaction' as type, amount, description, created_at 
        FROM transactions WHERE user_id = ?
      UNION ALL
      SELECT 
        'invoice' as type, amount, 'Invoice #' as description, created_at 
      FROM invoices WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 10`,
      [req.user.id, req.user.id]
    );
    
    // Get active subscriptions
    const [activeSubscriptions] = await connection.query(
      `SELECT s.id, s.service_uuid, s.service_type, s.hostname, s.status, s.expires_at, 
              CASE 
                WHEN s.ryze_vmid IS NOT NULL THEN CONCAT('VM #', s.ryze_vmid)
                ELSE p.name 
              END as plan_name 
       FROM subscriptions s 
       LEFT JOIN plans p ON s.plan_id = p.id 
       WHERE s.user_id = ? AND s.status = 'ACTIVE' 
       ORDER BY s.created_at DESC LIMIT 5`,
      [req.user.id]
    );
    
    connection.release();
    
    res.json({
      user: user[0],
      stats: stats[0],
      service_counts: serviceCounts[0],
      recent_activity: recentActivity,
      active_subscriptions: activeSubscriptions
    });
    
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user billing information
app.get('/api/user/billing', authenticateToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get billing overview
    const [billing] = await connection.query(
      'SELECT balance, total_spent, credits FROM users WHERE id = ?',
      [req.user.id]
    );
    
    // Get transactions
    const [transactions] = await connection.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    
    // Get invoices
    const [invoices] = await connection.query(
      'SELECT i.*, p.name as plan_name FROM invoices i LEFT JOIN plans p ON i.plan_id = p.id WHERE i.user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    
    connection.release();
    
    res.json({
      billing: billing[0],
      transactions,
      invoices
    });
    
  } catch (err) {
    console.error('Billing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Checkout processing
app.post('/api/user/checkout', authenticateToken, async (req, res) => {
  const { plan_id, hostname, os_name, region, payment_method, terms, privacy } = req.body;
  PROM_METRICS.checkoutAttempts += 1;
  
  if (terms !== true || privacy !== true) {
    PROM_METRICS.checkoutFailures += 1;
    return res.status(400).json({ error: 'Please accept the terms and conditions and privacy policy' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let plan;
    const planType = (req.body.plan_type || '').toUpperCase();

    if (plan_id) {
      // 1. Get Plan Details from DB
      const [plans] = await connection.query('SELECT * FROM plans WHERE id = ?', [plan_id]);
      if (plans.length === 0) {
        await connection.rollback();
        PROM_METRICS.checkoutFailures += 1;
        return res.status(404).json({ error: 'Plan not found' });
      }
      plan = plans[0];
    } else if (['GAME', 'VPS', 'RDP'].includes(planType)) {
      // Handle Custom Plan from Frontend
      plan = {
        id: null,
        name: req.body.plan_name || 'Custom Plan',
        type: planType,
        price: parseFloat(req.body.plan_price || 0),
        memory: parseInt(req.body.memory || 1024),
        cpu: parseInt(req.body.cpu || 100),
        disk: parseInt(req.body.disk || 2048),
        nest_id: req.body.nest_id,
        egg_id: req.body.egg_id,
        billing_cycle: req.body.billing_cycle || 'Monthly'
      };
    } else {
      await connection.rollback();
      PROM_METRICS.checkoutFailures += 1;
      return res.status(400).json({ error: 'Plan ID or valid custom plan details are required' });
    }

    // 2. Check User Balance
    const [users] = await connection.query('SELECT balance, email, username, first_name, last_name FROM users WHERE id = ?', [req.user.id]);
    const userBalance = parseFloat(users[0].balance);
    const planPrice = parseFloat(plan.price);
    const userEmail = users[0].email || req.user.email;
    const userFirstName = users[0].first_name || users[0].username || 'User';
    const userLastName = users[0].last_name || 'Client';

    if (userBalance < planPrice) {
      await connection.rollback();
      PROM_METRICS.checkoutFailures += 1;
      return res.status(400).json({ error: 'Insufficient balance. Please top up your account.' });
    }

    // 3. Deduct Balance & Create Transaction
    await connection.query('UPDATE users SET balance = balance - ?, total_spent = total_spent + ? WHERE id = ?', [planPrice, planPrice, req.user.id]);
    
    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, description, status) VALUES (?, 'debit', ?, ?, 'completed')",
      [req.user.id, planPrice, `Purchase: ${plan.name}`]
    );

    // 4. Create Invoice
    await connection.query(
      "INSERT INTO invoices (user_id, amount, status, plan_id) VALUES (?, ?, 'PAID', ?)",
      [req.user.id, planPrice, plan.id || null]
    );

    // 5. Create Subscription
    const serviceUuid = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // Monthly subscription

    const [subResult] = await connection.query(
      "INSERT INTO subscriptions (user_id, service_type, service_uuid, hostname, plan_id, memory, cpu, disk, status, expires_at, os_name, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?) RETURNING id",
      [req.user.id, plan.type, serviceUuid, hostname || `${plan.name.toLowerCase().replace(/\s+/g, '-')}.local`, plan.id || null, plan.memory, plan.cpu, plan.disk, expiresAt, os_name || 'Ubuntu 22.04', region || 'Eygelshoven, Niederlande']
    );

    // 6. Provision Service
    let finalUuid = serviceUuid;
    let gameProvisioningData = null;
    console.log(`[Checkout] Provisioning ${plan.type} service for user ${req.user.id}...`);
    
    try {
      if (plan.type === 'GAME') {
        if (isAdminPterodactylEnabled()) {
          const provisioned = await provisionGameOrderWithAdminClient({
            connection,
            req,
            plan,
            usersRow: users[0],
            subResult,
            hostname,
            os_name,
            region
          });
          gameProvisioningData = provisioned;
          finalUuid = provisioned.server.uuid || provisioned.server.identifier || finalUuid;
          console.log(`[Checkout] Linked service to Ptero UUID: ${finalUuid}`);

          if (provisioned.generatedPassword) {
            mailer.sendPterodactylAccess({
              to: userEmail,
              username: users[0].username,
              password: provisioned.generatedPassword,
              panelUrl: sanitizePanelUrl(),
              setPasswordLink: buildPasswordSetLink(finalUuid, provisioned.passwordChangeToken)
            }).catch((mailErr) => console.error('[Mailer] Automated Pterodactyl access fail:', mailErr.message));
          }
        } else {
          // Legacy fallback when feature flag is disabled
          let additionalPorts = 0;
          if (parseInt(plan.egg_id) === 18) {
            additionalPorts = 1;
          } else if (parseInt(plan.egg_id) === 19) {
            additionalPorts = 2;
          }

          const pteroRes = await ptero.createServer({
            userId: req.user.id,
            userEmail,
            firstName: userFirstName,
            lastName: userLastName,
            name: hostname || `${plan.name}-${req.user.id}`,
            serviceId: subResult.insertId,
            nestId: plan.nest_id || 5,
            eggId: plan.egg_id || (plan.type === 'GAME' ? 18 : 1),
            locationId: plan.location_id || 0,
            nodeId: 0,
            memory: plan.memory || 1024,
            swap: 0,
            io: 500,
            cpu: plan.cpu || 100,
            disk: plan.disk || 2048,
            databases: 1,
            backups: 1,
            allocations: 1,
            additionalPorts,
            dockerImage: plan.docker_image || undefined,
            environment: req.body.environment || {},
            startOnCompletion: true,
          });

          if (pteroRes?.attributes?.uuid) {
            finalUuid = pteroRes.attributes.uuid;
            await connection.query("UPDATE subscriptions SET service_uuid = ?, status = 'ACTIVE' WHERE id = ?", [finalUuid, subResult.insertId]);
          } else if (pteroRes?.attributes?.identifier) {
            finalUuid = pteroRes.attributes.identifier;
            await connection.query("UPDATE subscriptions SET service_uuid = ?, status = 'ACTIVE' WHERE id = ?", [finalUuid, subResult.insertId]);
          }
        }
      } else if (plan.type === 'VPS' || plan.type === 'RDP') {
        const ryzeOrderData = buildRyzeOrderPayload(plan, {
          hostname: hostname || `${plan.name.toLowerCase().replace(/\s+/g, '-')}.host1top.com`,
          os_name,
          runtime: 30,
          terms,
          privacy
        });
        
        console.log('[Checkout] Ryze Order Data:', JSON.stringify(ryzeOrderData));
        
        const ryzeRes = await ryze.orderServer(ryzeOrderData);
        
        console.log('[Checkout] Ryze Response:', JSON.stringify(ryzeRes));

        const extractRyzeUuid = (payload) => (
          payload?.data?.uuid ||
          payload?.data?.data?.uuid ||
          payload?.data?.server?.uuid ||
          payload?.uuid ||
          payload?.server?.uuid ||
          null
        );

        const extractRyzeVmid = (payload) => (
          payload?.data?.vmid ||
          payload?.data?.data?.vmid ||
          payload?.data?.id ||
          payload?.data?.data?.id ||
          payload?.vmid ||
          payload?.id ||
          null
        );

        let provisionedUuid = extractRyzeUuid(ryzeRes);
        let provisionedVmid = extractRyzeVmid(ryzeRes);

        // Some Ryze order responses do not return uuid directly.
        // Resolve it using freshly created hostname from live server list.
        if (!provisionedUuid || !provisionedVmid) {
          try {
            const servers = await getRyzeServerList();
            const requestedHostname = (ryzeOrderData.hostname || '').toLowerCase();
            const matchedServer = servers.find((server) =>
              (server?.hostname || '').toLowerCase() === requestedHostname
            );
            if (matchedServer) {
              if (!provisionedUuid) provisionedUuid = matchedServer.uuid;
              if (!provisionedVmid) provisionedVmid = matchedServer.vmid || matchedServer.id;
            }
          } catch (resolveErr) {
            console.warn('[Checkout] Could not resolve Ryze UUID from list:', resolveErr.message);
          }
        }
        
        if (provisionedUuid) {
          finalUuid = provisionedUuid;
          await connection.query(
            "UPDATE subscriptions SET service_uuid = ?, ryze_vmid = ?, status = 'ACTIVE' WHERE id = ?", 
            [finalUuid, provisionedVmid, subResult.insertId]
          );
          console.log(`[Checkout] Linked service to Ryze UUID: ${finalUuid} (VMID: ${provisionedVmid})`);
        } else {
          console.warn('[Checkout] Ryze order accepted but UUID unavailable; subscription remains PENDING until sync.');
        }
      }
    } catch (provisionErr) {
      const errorPayload = plan.type === 'GAME' && isAdminPterodactylEnabled()
        ? normalizePterodactylApiError(provisionErr)
        : (provisionErr.response?.data ? JSON.stringify(provisionErr.response.data) : provisionErr.message);
      console.error(`[Checkout] Provisioning FAILED for ${plan.type}:`, errorPayload);
      if (plan.type === 'GAME' && isAdminPterodactylEnabled()) {
        const ticketId = await freezeOrderAndOpenTicket(connection, {
          userId: req.user.id,
          subscriptionId: subResult.insertId,
          planName: plan.name,
          reason: 'Automatic game provisioning failed after remediation',
          details: errorPayload
        });
        mailer.sendTicketOpened({
          to: userEmail,
          username: users[0].username,
          ticketId,
          subject: `Provisioning issue: ${plan.name}`,
          priority: 'high'
        }).catch((mailErr) => console.error('[Mailer] Provisioning freeze notice fail:', mailErr.message));
        provisionErr.orderFrozen = true;
        throw provisionErr;
      }
      // Keep as PENDING for manual intervention on legacy integrations
    }

    // 7. Update User Stats
    await connection.query(
      "UPDATE user_stats SET total_services = total_services + 1, active_services = active_services + 1, total_invoices = total_invoices + 1, paid_invoices = paid_invoices + 1 WHERE user_id = ?",
      [req.user.id]
    );

    await connection.commit();

    const orderId = String(343545645 + Number(subResult.insertId || 0));
    const successMessage = (plan.type === 'VPS' || plan.type === 'RDP')
      ? 'Order Placed! Your VPS is being provisioned. It should be online within 2 minutes.'
      : 'Purchase successful!';

    PROM_METRICS.checkoutSuccesses += 1;

    res.json({
      success: true,
      message: successMessage,
      service_uuid: finalUuid || serviceUuid,
      order_id: orderId,
      sftp: gameProvisioningData ? {
        host: gameProvisioningData.sftp.ip || gameProvisioningData.sftp.host || new URL(process.env.PTERODACTYL_URL || 'https://gp.host1top.com').hostname,
        port: gameProvisioningData.sftp.port || 2022,
        username: gameProvisioningData.sftp.username || gameProvisioningData.server.identifier || null,
        password: gameProvisioningData.generatedPassword || null
      } : undefined,
      game_panel: gameProvisioningData ? {
        url: sanitizePanelUrl(),
        email: userEmail,
        set_password_link: buildPasswordSetLink(finalUuid || serviceUuid, gameProvisioningData.passwordChangeToken)
      } : undefined
    });
  } catch (err) {
    PROM_METRICS.checkoutFailures += 1;
    if (connection) {
      try {
        if (err.orderFrozen) {
          await connection.commit();
        } else {
          await connection.rollback();
        }
      } catch (rollbackErr) {
        console.error('Checkout rollback error:', rollbackErr.message);
      }
    }
    console.error('Checkout error:', err);
    res.status(err.statusCode || 500).json({
      error: err.payload?.requires_confirmation
        ? err.message
        : 'Checkout failed',
      details: err.payload || null
    });
  } finally {
    if (connection) connection.release();
  }
});

// Get user services
app.get('/api/user/services', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    const [services] = await connection.query(
      `SELECT 
        s.id,
        s.plan_id,
        s.user_id,
        s.status,
        s.expires_at,
        s.service_uuid,
        s.pterodactyl_server_id,
        s.pterodactyl_user_id,
        s.order_metadata,
        s.hostname,
        s.ryze_vmid,
        CASE 
          WHEN s.ryze_vmid IS NOT NULL THEN CONCAT('VM #', s.ryze_vmid)
          ELSE COALESCE(p.name, s.hostname, 'Premium Service')
        END as service_name,
        COALESCE(p.type, s.service_type, 'VPS') as service_type,
        COALESCE(p.memory, 0) as memory,
        COALESCE(p.cpu, 0) as cpu,
        COALESCE(p.disk, 0) as disk,
        COALESCE(p.price, 0.00) as price,
        COALESCE(p.billing_cycle, 'Monthly') as pricing_cycle
      FROM subscriptions s 
      LEFT JOIN plans p ON s.plan_id = p.id 
      WHERE s.user_id = ? 
      ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    
    let pterodactylServerMap = new Map();
    if (isAdminPterodactylEnabled() && services.some((service) => service.service_type === 'GAME')) {
      try {
        const panelServers = await pteroAdmin.listServers();
        pterodactylServerMap = new Map(panelServers.flatMap((server) => {
          const attrs = server.attributes || {};
          return [
            [String(attrs.id), attrs],
            [attrs.uuid, attrs],
            [attrs.identifier, attrs]
          ].filter((entry) => entry[0]);
        }));
      } catch (panelErr) {
        console.warn('[Services] Failed to enrich GAME services from Pterodactyl:', panelErr.message);
      }
    }

    const formattedServices = services.map(s => {
      const remote = s.service_type === 'GAME'
        ? (
            pterodactylServerMap.get(String(s.pterodactyl_server_id || '')) ||
            pterodactylServerMap.get(s.service_uuid) ||
            pterodactylServerMap.get(normalizeUuid(s.service_uuid))
          )
        : null;
      const remoteNode = remote?.relationships?.node?.attributes?.name || null;
      const remoteEgg = remote?.relationships?.egg?.attributes?.name || null;
      const remoteIdentifier = remote?.identifier || null;
      const remoteStatus = remote ? (remote.suspended ? 'SUSPENDED' : pickServerState({ attributes: remote }).toUpperCase()) : null;
      const effectiveStatus = remoteStatus && remoteStatus !== 'UNKNOWN'
        ? remoteStatus
        : (s.status || 'Active');
      return {
        ...buildGamePanelServiceRecord({ ...s, status: effectiveStatus }, remote),
        panel_identifier: remoteIdentifier,
        panel_node: remoteNode,
        panel_egg: remoteEgg
      };
    });

    res.json({ services: formattedServices });
  } catch (err) {
    console.error('Fetch services error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Get specific service details
app.get('/api/user/service/:uuid', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  const normalizedRequested = normalizeUuid(uuid);
  console.log(`[Service] Fetching details for ${uuid} (User: ${req.user.id})`);
  
  let connection;
  try {
    connection = await pool.getConnection();
    
    // 1. Try finding by direct service_uuid or internal ID first (most efficient)
    let [services] = await connection.query(
      `SELECT s.*, 
              CASE 
                WHEN s.ryze_vmid IS NOT NULL THEN CONCAT('VM #', s.ryze_vmid)
                ELSE p.name 
              END as plan_name,
              p.type as service_type, 
              COALESCE(s.memory, p.memory) as memory, 
              COALESCE(s.cpu, p.cpu) as cpu, 
              COALESCE(s.disk, p.disk) as disk, 
              p.price, p.billing_cycle 
       FROM subscriptions s 
       LEFT JOIN plans p ON s.plan_id = p.id 
       WHERE s.user_id = ? AND (s.service_uuid = ? OR s.id::text = ? OR REPLACE(s.service_uuid, '-', '') = ?)`,
      [req.user.id, uuid, uuid, normalizedRequested]
    );

    // 2. If not found, try robust Ryze resolution (for VPS/RDP placeholders or VMID matches)
    if (services.length === 0) {
      const resolved = await resolveRyzeServerUuid(req.user.id, uuid);
      if (resolved) {
        [services] = await connection.query(
          `SELECT s.*, 
                  CASE 
                    WHEN s.ryze_vmid IS NOT NULL THEN CONCAT('VM #', s.ryze_vmid)
                    ELSE p.name 
                  END as plan_name,
                  p.type as service_type, 
                  COALESCE(s.memory, p.memory) as memory, 
                  COALESCE(s.cpu, p.cpu) as cpu, 
                  COALESCE(s.disk, p.disk) as disk, 
                  p.price, p.billing_cycle 
           FROM subscriptions s 
           LEFT JOIN plans p ON s.plan_id = p.id 
           WHERE s.user_id = ? AND s.id = ?`,
          [req.user.id, resolved.sub.id]
        );
      }
    }

    if (services.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Service not found or unauthorized' });
    }
    
    let service = services[0];

    // Always sync specs from Ryze API for VPS servers
    if (service.service_type === 'VPS' && process.env.RYZE_API_KEY) {
      try {
        const ryzeRes = await axios.get(`https://dash.ryzehosting.com/api/v2/server/list`, {
          headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}` }
        });
        const list = Array.isArray(ryzeRes.data.data?.list) ? ryzeRes.data.data.list : [];
        const remote = list.find(s => s.uuid === uuid || (s.hostname && s.hostname.toLowerCase() === (service.hostname || '').toLowerCase()));
        
        if (remote) {
          service.cpu = remote.config?.cores || service.cpu;
          service.memory = remote.config?.memory || service.memory;
          service.disk = remote.config?.disk || service.disk;
          
          service.os_name = remote.os?.display_name || remote.os?.displayname || remote.osDisplayName || remote.os?.name || service.os_name;
          
          if (remote.node?.location) {
            const loc = remote.node.location;
            service.region = `${loc.city || ''}, ${loc.country || ''}`.trim().replace(/^,/, '') || loc.datacenter || service.region;
          } else if (remote.datacenter) {
            const dc = remote.datacenter;
            service.region = `${dc.city || ''}, ${dc.country || ''}`.trim().replace(/^,/, '') || dc.displayname || dc.name || service.region;
          }
          
          // Persist to DB for next time, using the CORRECT Ryze UUID
          await pool.query('UPDATE subscriptions SET service_uuid = ?, cpu = ?, memory = ?, disk = ?, os_name = ?, region = ? WHERE id = ?', 
            [remote.uuid, service.cpu, service.memory, service.disk, service.os_name, service.region, service.id]
          );
          
          // Update the local object so the frontend gets the correct UUID
          service.service_uuid = remote.uuid;
        }
      } catch (e) {
        console.warn(`Lazy sync failed for ${uuid}:`, e.message);
      }
    }

    res.json({ service });
  } catch (err) {
    console.error('Service fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch service' });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/user/game-panel/services', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [services] = await connection.query(
      `SELECT s.id, s.user_id, s.status, s.expires_at, s.service_uuid, s.hostname, s.memory, s.cpu, s.disk,
              s.order_metadata, s.pterodactyl_server_id, s.pterodactyl_user_id,
              'GAME' AS service_type,
              COALESCE(p.name, s.hostname, 'Game Server') AS service_name,
              COALESCE(p.billing_cycle, 'Monthly') AS pricing_cycle,
              COALESCE(p.price, 0.00) AS price
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = ? AND s.service_type = 'GAME'
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );

    let pterodactylServerMap = new Map();
    if (isAdminPterodactylEnabled() && services.length > 0) {
      try {
        const panelServers = await pteroAdmin.listServers();
        pterodactylServerMap = new Map(panelServers.flatMap((server) => {
          const attrs = server.attributes || {};
          return [
            [String(attrs.id), attrs],
            [attrs.uuid, attrs],
            [attrs.identifier, attrs]
          ].filter((entry) => entry[0]);
        }));
      } catch (panelErr) {
        console.warn('[Game Panel Services] Failed to enrich from Pterodactyl:', panelErr.message);
      }
    }

    const gameServices = services
      .map((service) => {
        const remote = (
          pterodactylServerMap.get(String(service.pterodactyl_server_id || '')) ||
          pterodactylServerMap.get(service.service_uuid) ||
          pterodactylServerMap.get(normalizeUuid(service.service_uuid))
        );
        return buildGamePanelServiceRecord(service, remote);
      })
      .filter((service) => isGameHostingMetadata({ service_category: service.service_category }));

    res.json({ services: gameServices });
  } catch (err) {
    console.error('Game panel services error:', err);
    res.status(500).json({ error: 'Failed to load game-hosting services' });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game-panel/:uuid/password', authenticateToken, requireCsrfToken, async (req, res) => {
  const nextPassword = String(req.body?.newPassword || req.body?.password || '').trim();
  const confirmPassword = String(req.body?.confirmPassword || req.body?.confirm_password || '').trim();
  const setupToken = String(req.body?.setupToken || req.body?.setPasswordToken || '').trim();

  if (!nextPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Please enter the new password twice' });
  }
  if (nextPassword !== confirmPassword) {
    return res.status(400).json({ error: 'The password confirmation does not match' });
  }

  const strengthError = buildPasswordStrengthError(nextPassword);
  if (strengthError) {
    return res.status(400).json({ error: strengthError });
  }

  let connection;
  let subscription = null;
  try {
    connection = await pool.getConnection();
    subscription = await getOwnedGameService(connection, req.user.id, req.params.uuid);
    if (!subscription) {
      connection.release();
      return res.status(404).json({ error: 'Game-hosting service not found' });
    }

    const metadata = sanitizeGameServiceMetadata(subscription.order_metadata);
    if (!isGameHostingMetadata(metadata)) {
      connection.release();
      return res.status(404).json({ error: 'Game Panel is only available for game-hosting services' });
    }

    if (setupToken) {
      const validSetupToken = await validatePendingPasswordSetupToken(metadata, setupToken);
      if (!validSetupToken) {
        connection.release();
        return res.status(400).json({ error: 'This one-click password setup link is invalid or has expired' });
      }
    }

    const pterodactylUserId = Number(metadata.pterodactyl_user_id || subscription.pterodactyl_user_id || 0);
    if (!pterodactylUserId) {
      connection.release();
      return res.status(400).json({ error: 'This service is not linked to a Pterodactyl user yet' });
    }

    await retryWithBackoff(
      () => pteroAdmin.resetUserPassword(pterodactylUserId, nextPassword),
      { maxAttempts: 3, baseDelayMs: 500 }
    );

    const nextMetadata = await clearPendingPterodactylPasswordMetadata(connection, subscription.id, metadata);
    await logPterodactylAudit(connection, {
      userId: req.user.id,
      subscriptionId: subscription.id,
      action: setupToken ? 'client.game_panel.password_setup' : 'client.game_panel.password_change',
      success: true,
      statusCode: 200,
      requestPayload: {
        serviceUuid: subscription.service_uuid,
        pterodactylUserId,
        usedSetupToken: Boolean(setupToken)
      },
      responsePayload: {
        message: 'Password updated successfully'
      }
    });

    connection.release();
    res.json({
      message: buildGamePanelPasswordResponseMessage(Boolean(setupToken)),
      service: buildGamePanelServiceRecord({ ...subscription, order_metadata: nextMetadata })
    });
  } catch (err) {
    if (connection) connection.release();
    if (subscription?.id) {
      await logPterodactylAudit(pool, {
        userId: req.user.id,
        subscriptionId: subscription.id,
        action: 'client.game_panel.password_change_failed',
        success: false,
        statusCode: err.response?.status || err.statusCode || 500,
        requestPayload: {
          serviceUuid: subscription.service_uuid,
          usedSetupToken: Boolean(setupToken)
        },
        responsePayload: normalizePterodactylApiError(err)
      });
    }
    res.status(err.response?.status || err.statusCode || 500).json({
      error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to update Pterodactyl password'
    });
  }
});

async function getRyzeServerList() {
  const response = await axios.get('https://dash.ryzehosting.com/api/v2/server/list', {
    headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Accept': 'application/json' }
  });
  return Array.isArray(response.data?.data?.list) ? response.data.data.list : [];
}

function mapRyzeOsName(input) {
  const value = String(input || '').toLowerCase().trim();
  if (!value) return 'ubuntu-2404-noble';
  
  if (value.includes('ubuntu 24') || value.includes('ubuntu24.04')) return 'ubuntu-2404-noble';
  if (value.includes('ubuntu 22') || value.includes('ubuntu22.04')) return 'ubuntu-2204-jammy';
  if (value.includes('ubuntu 20') || value.includes('ubuntu20.04')) return 'ubuntu-2004-focal';
  if (value.includes('debian 12') || value.includes('debian12')) return 'debian-12-bookworm';
  if (value.includes('debian 11') || value.includes('debian11')) return 'debian-11-bullseye';
  if (value.includes('debian 10') || value.includes('debian10')) return 'debian-10-buster';
  if (value.includes('windows') || value.includes('server 19')) return 'windows-server-19';
  if (value.includes('arch')) return 'archlinux';
  if (value.includes('fedora')) return 'fedora';
  if (value.includes('alma') && value.includes('9')) return 'almalinux9';
  if (value.includes('rocky') && value.includes('9')) return 'rockylinux9';
  if (value.includes('centos') && value.includes('7')) return 'centos7';
  
  return value.replace(/\s+/g, '-').replace(/_/g, '-');
}

function mapRyzeHostsystem(input) {
  const raw = String(input || '').trim();
  const value = raw.toLowerCase();
  if (!value) return 'nl_ryzen';
  if (value === 'nl_ryzen' || value === 'nl_xeon') return value;
  if (value.includes('ryzen')) return 'nl_ryzen';
  if (value.includes('xeon')) return 'nl_xeon';
  return 'nl_ryzen';
}

// Get user notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ notifications: rows });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Mark all notifications as read
app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Mark single notification as read
app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Debug: Create a test notification
app.post('/api/debug/notification', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { title, message, type, link } = req.body;
    await connection.query(
      'INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, title || 'Test Notification', message || 'This is a sample alert!', type || 'info', link || '#']
    );
    res.json({ success: true, message: 'Notification created' });
  } catch (err) {
    console.error('Debug notification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

function normalizeRyzeDisk(input) {
  // Ryze validates predefined disk options; 30 is rejected on current hostsystems.
  // Normalize to GB and enforce practical minimum 50GB.
  const raw = Number(input || 50);
  const gb = raw > 512 ? Math.ceil(raw / 1024) : raw; // convert MB-style plan values to GB
  const rounded = Math.ceil(gb / 10) * 10;
  return Math.max(50, rounded);
}

function normalizeRyzeCores(plan) {
  // ryze_cores is the correct field — use it if set and valid
  const ryzeCores = Number(plan?.ryze_cores || 0);
  if (ryzeCores >= 1 && ryzeCores <= 64) return ryzeCores;

  // plan.cpu stores Pterodactyl-style percentages: 100 = 1 core, 200 = 2 cores, etc.
  const cpuVal = Number(plan?.cpu || 0);
  if (cpuVal >= 100) {
    const converted = Math.max(1, Math.round(cpuVal / 100));
    return Math.min(converted, 64);
  }
  // If cpu is already a small number (1-64), use it directly
  if (cpuVal >= 1 && cpuVal <= 64) return cpuVal;

  // Default fallback
  return 1;
}

function buildRyzeOrderPayload(plan, options = {}) {
  const hostname = options.hostname || `${String(plan?.name || 'vps').toLowerCase().replace(/\s+/g, '-')}.host1top.com`;
  const acceptedTerms = options.terms !== undefined ? Boolean(options.terms) : true;
  const acceptedPrivacy = options.privacy !== undefined ? Boolean(options.privacy) : true;
  return {
    cores: normalizeRyzeCores(plan),
    memory: Number(plan?.memory || 1024),
    disk: normalizeRyzeDisk(plan?.disk || 50),
    hostsystem: mapRyzeHostsystem(plan?.ryze_cpu_type || plan?.ryze_plan_id || 'nl_ryzen'),
    os: mapRyzeOsName(options.os_name || plan?.ryze_os_name || 'ubuntu24.04'),
    ipv4: Number(options.ipv4 || 1),
    ipv6: Number(options.ipv6 || 1),
    runtime: Number(options.runtime || 30),
    hostname,
    terms: acceptedTerms,
    privacy: acceptedPrivacy,
    discount_code: options.discount_code || ''
  };
}

function normalizeUuid(value) {
  return String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

function toDashedUuid(value) {
  const normalized = normalizeUuid(value);
  if (!/^[a-f0-9]{32}$/.test(normalized)) return String(value || '');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

async function resolveRyzeServerUuid(userId, requestedUuid) {
  const requestedNormalized = normalizeUuid(requestedUuid);
  console.log(`[Resolution] Resolving Ryze service for ${requestedUuid} (User: ${userId})`);
  
  let connection;
  try {
    connection = await pool.getConnection();
    
    // 1. Direct DB lookup (Exact match or HEX match)
    const [subs] = await connection.query(
      `SELECT id, service_uuid, hostname, status, service_type 
       FROM subscriptions 
       WHERE user_id = ? AND (service_uuid = ? OR REPLACE(service_uuid, '-', '') = ?) 
       LIMIT 1`,
      [userId, requestedUuid, requestedNormalized]
    );

    let sub = subs.length > 0 ? subs[0] : null;
    const servers = await getRyzeServerList();
    
    // 2. If we found a sub, try to verify it against Ryze
    if (sub) {
      const matchedRemote = servers.find(rs => 
        rs.uuid === sub.service_uuid || 
        normalizeUuid(rs.uuid) === normalizeUuid(sub.service_uuid) ||
        (rs.hostname && sub.hostname && rs.hostname.toLowerCase() === sub.hostname.toLowerCase()) ||
        (rs.vmid?.toString() === requestedUuid)
      );

      if (matchedRemote) {
        if (sub.service_uuid !== matchedRemote.uuid) {
          await connection.query('UPDATE subscriptions SET service_uuid = ? WHERE id = ?', [matchedRemote.uuid, sub.id]);
          sub.service_uuid = matchedRemote.uuid;
        }
        connection.release();
        return { sub, resolvedUuid: matchedRemote.uuid };
      }
    }

    // 3. Robust fallback: find ANY Ryze server that matches ANY of this user's placeholder subs
    if (!sub) {
      const [userSubs] = await connection.query(
        "SELECT id, service_uuid, hostname, status FROM subscriptions WHERE user_id = ? AND (service_type = 'VPS' OR service_type = 'RDP')",
        [userId]
      );

      for (const s of userSubs) {
        const match = servers.find(rs => 
          (rs.hostname && s.hostname && rs.hostname.toLowerCase() === s.hostname.toLowerCase()) ||
          (normalizeUuid(rs.uuid) === requestedNormalized) ||
          (rs.vmid?.toString() === requestedUuid)
        );

        if (match) {
          if (s.service_uuid !== match.uuid) {
            await connection.query('UPDATE subscriptions SET service_uuid = ? WHERE id = ?', [match.uuid, s.id]);
            s.service_uuid = match.uuid;
          }
          connection.release();
          return { sub: s, resolvedUuid: match.uuid };
        }
      }
    }

    if (connection) connection.release();
    if (sub) return { sub, resolvedUuid: sub.service_uuid };
    
  } catch (err) {
    if (connection) connection.release();
    console.error('[Resolution] Fail:', err.message);
  }
  return null;
}

// Helper for Ryze User Proxy
async function ryzeUserProxy(req, res, path, method = 'GET', data = null) {
  const { uuid } = req.params;
  try {
    if (!process.env.RYZE_API_KEY) return res.status(500).json({ error: 'Ryze API not configured' });

    const resolved = await resolveRyzeServerUuid(req.user.id, uuid);
    if (!resolved) return res.status(403).json({ error: 'Unauthorized' });
    if (resolved.unresolved && (path === 'status' || path === 'ipaddresses')) {
      return res.status(202).json({
        response: 'Provisioning in progress',
        state: 'pending',
        code: 202,
        data: null
      });
    }

    const callRyze = async (targetUuid) => {
      const dashedUuid = toDashedUuid(targetUuid);
      const config = {
        method,
        url: `https://dash.ryzehosting.com/api/v2/server/${path}`,
        headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }
      };
      
      // The OpenAPI spec explicitly requires the UUID in the requestBody for these endpoints
      config.data = { ...(data || {}), uuid: dashedUuid };
      // Also include in params as fallback
      config.params = { uuid: dashedUuid };

      return axios(config);
    };

    try {
      const primaryUuid = toDashedUuid(resolved.resolvedUuid);
      const response = await callRyze(primaryUuid);
      return res.json(response.data);
    } catch (err) {
      // If UUID changed remotely, retry once using hostname/id lookup and persist.
      if (err.response?.status === 404) {
        const refreshed = await resolveRyzeServerUuid(req.user.id, uuid);
        if (refreshed?.unresolved && (path === 'status' || path === 'ipaddresses')) {
          return res.status(202).json({
            response: 'Provisioning in progress',
            state: 'pending',
            code: 202,
            data: null
          });
        }
        if (refreshed?.resolvedUuid && refreshed.resolvedUuid !== resolved.resolvedUuid) {
          try {
            const retryResponse = await callRyze(toDashedUuid(refreshed.resolvedUuid));
            return res.json(retryResponse.data);
          } catch (retryErr) {
            err = retryErr;
          }
        }
        
        // Graceful fallback for manually ordered or unlinked servers
        if (err.response?.status === 404) {
          if (path === 'status') {
            return res.json({
              response: 'Success', state: 'success', code: 200,
              data: { status: resolved.sub.status === 'active' ? 'online' : 'offline', power: 'unknown' }
            });
          }
          if (path === 'ipaddresses') {
            return res.json({
              response: 'Success', state: 'success', code: 200,
              data: { ipv4_addresses: [], ipv6_addresses: [], primary_ipv4: null, primary_ipv6: null }
            });
          }
        }
      }
      throw err;
    }
  } catch (err) {
    console.error(`Ryze Proxy Error (${path}):`, err.response?.data || err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Ryze API error' });
  }
}

// Ryze Power Control (User)
app.post('/api/user/ryze/:uuid/power', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'power', 'POST', { action: req.body.action });
});

// Ryze Status
app.get('/api/user/ryze/:uuid/info', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  try {
    if (!process.env.RYZE_API_KEY) return res.status(500).json({ error: 'Ryze API not configured' });
    const resolved = await resolveRyzeServerUuid(req.user.id, uuid);
    if (!resolved) return res.status(403).json({ error: 'Unauthorized' });
    if (resolved.unresolved) {
      return res.status(202).json({
        response: 'Provisioning in progress',
        state: 'pending',
        code: 202,
        data: null
      });
    }
    const ryzeRes = await axios.get('https://dash.ryzehosting.com/api/v2/server/list', {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}` }
    });
    const targetUuid = normalizeUuid(resolved.resolvedUuid);
    const remote = ryzeRes.data.data?.list?.find((s) => normalizeUuid(s.uuid) === targetUuid);
    if (!remote) return res.status(404).json({ error: 'Server not found on Ryze' });
    res.json({ data: remote });
  } catch (err) {
    res.status(500).json({ error: 'Ryze API error' });
  }
});

app.get('/api/user/ryze/:uuid/status', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'status');
});

// Ryze IPs
app.get('/api/user/ryze/:uuid/ipaddresses', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'ipaddresses');
});

// Ryze Password Reset
app.post('/api/user/ryze/:uuid/password', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'password', 'POST', { password: req.body.password });
});

// Ryze Reinstall
app.post('/api/user/ryze/:uuid/reinstall', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  try {
    const [sub] = await pool.query('SELECT protection_enabled FROM subscriptions WHERE user_id = ? AND service_uuid = ?', [req.user.id, uuid]);
    if (sub.length > 0 && sub[0].protection_enabled) {
      return res.status(403).json({ error: 'Reinstall protection is ENABLED. Disable it first in the settings.' });
    }
    await ryzeUserProxy(req, res, 'reinstall', 'POST', { os: req.body.os, hostname: req.body.hostname });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check protection status' });
  }
});

// Ryze VNC
app.get('/api/user/ryze/:uuid/vnc', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'vnc');
});

// Ryze PTR
app.post('/api/user/ryze/:uuid/ptr', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'ptr', 'POST', { ip: req.body.ip, ptr: req.body.ptr });
});

// Ryze OS List
app.get('/api/user/ryze/os', authenticateToken, async (req, res) => {
  try {
    const { tier, type } = req.query;
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/os`, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}` }
    });
    
    let osList = Array.isArray(response.data?.data) ? response.data.data : [];
    
    // Type Filter (VPS vs RDP)
    if (type === 'RDP') {
      const filtered = osList.filter(os => {
        const name = (os.display_name || os.name || '').toLowerCase();
        return name.includes('windows') && name.includes('2019');
      });
      
      // If found in API, use it; otherwise, use the official Ryze identifier
      if (filtered.length > 0) {
        osList = filtered;
      } else {
        osList = [{ 
          name: 'windows-server-19', 
          display_name: 'Windows Server 2019', 
          image: 'https://cdn.ryzehosting.com/os/windows.png',
          minDiskSize: 40 
        }];
      }
    } else {
      // Default to VPS: Allow Windows if present, but prioritize Linux.
      // We don't hide it anymore because the user requested it.
    }

    // Tier Filter removed per user request to include Windows Server 2019 everywhere.

    res.json({ data: osList });
  } catch (err) {
    console.error('User OS list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch OS list' });
  }
});

// Ryze Protection Toggle
app.post('/api/user/ryze/:uuid/protection', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  const { enabled } = req.body;
  try {
    const [sub] = await pool.query('SELECT id FROM subscriptions WHERE user_id = ? AND service_uuid = ?', [req.user.id, uuid]);
    if (sub.length === 0) return res.status(403).json({ error: 'Unauthorized' });

    await pool.query('UPDATE subscriptions SET protection_enabled = ? WHERE service_uuid = ?', [enabled, uuid]);
    res.json({ message: `Protection ${enabled ? 'enabled' : 'disabled'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update protection' });
  }
});

// Ryze RRD Data (Graphs - Remote)
app.get('/api/user/ryze/:uuid/rrddata', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'rrddata');
});

// Ryze History (Local)
app.get('/api/user/ryze/:uuid/history', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT cpu_usage as cpu, mem_usage_mb as mem, disk_usage_gb as disk, timestamp FROM vps_stats WHERE service_uuid = ? ORDER BY timestamp DESC LIMIT 1440', 
      [uuid]
    );
    res.json({ history: rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch local history' });
  }
});



// Search User by Email (for assignment)
app.post('/api/user/ryze/:uuid/renew', authenticateToken, async (req, res) => {
  await ryzeUserProxy(req, res, 'renew', 'POST', { duration: req.body.duration || 30 });
});


// Pterodactyl Power Control (User)
app.post('/api/user/pterodactyl/power', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid, action } = req.body;
  if (!uuid || !action) return res.status(400).json({ error: 'UUID and action required' });

  try {
    const [sub] = await pool.query('SELECT id FROM subscriptions WHERE user_id = ? AND service_uuid = ?', [req.user.id, uuid]);
    if (sub.length === 0) return res.status(403).json({ error: 'Unauthorized' });

    const pterodactylUrl = process.env.PTERODACTYL_URL;
    const pterodactylKey = process.env.PTERODACTYL_CLIENT_KEY; 

    const response = await axios.post(`${pterodactylUrl}/api/client/servers/${uuid}/power`, 
      { signal: action },
      { headers: { 'Authorization': `Bearer ${pterodactylKey}`, 'Accept': 'application/json' } }
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.detail || 'Pterodactyl error' });
  }
});

// ── GAME PANEL ROUTES (/api/user/game/:uuid/*) ─────────────────────────────
// These are consumed by game-panel.html. All routes verify subscription ownership first.

async function verifyGameOwnership(userId, uuid) {
  try {
    const [rows] = await pool.query(
      "SELECT id FROM subscriptions WHERE user_id = $1 AND service_type = 'GAME' AND (service_uuid = $2 OR REPLACE(service_uuid, '-', '') = $3)",
      [userId, uuid, normalizeUuid(uuid)]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('[verifyGameOwnership] DB error:', err.message);
    return false; // fail-safe: deny access on error
  }
}

// Helper: get the short ptero identifier (first segment of UUID)
function pteroShortId(uuid) {
  if (!uuid) return uuid;
  // If it's already a short 8-char ID, return as-is
  if (!uuid.includes('-')) return uuid;
  return uuid.split('-')[0];
}

async function resolveOwnedGamePanelContext(connection, userId, uuid) {
  const subscription = await getOwnedGameService(connection, userId, uuid);
  if (!subscription) return null;

  const metadata = sanitizeGameServiceMetadata(subscription.order_metadata);
  let remoteServer = null;
  let remoteError = null;

  if (isAdminPterodactylEnabled()) {
    try {
      if (subscription.pterodactyl_server_id) {
        remoteServer = await retryWithBackoff(
          () => pteroAdmin.getServer(subscription.pterodactyl_server_id),
          { maxAttempts: 3, baseDelayMs: 400 }
        );
      } else {
        const servers = await retryWithBackoff(
          () => pteroAdmin.listServers(),
          { maxAttempts: 3, baseDelayMs: 400 }
        );
        const normalizedUuid = normalizeUuid(subscription.service_uuid);
        remoteServer = servers.find((entry) => {
          const attrs = entry.attributes || {};
          return (
            attrs.external_id === `host1top-sub-${subscription.id}` ||
            attrs.uuid === subscription.service_uuid ||
            normalizeUuid(attrs.uuid || '') === normalizedUuid ||
            attrs.identifier === pteroShortId(subscription.service_uuid)
          );
        }) || null;
      }
    } catch (err) {
      remoteError = err;
    }
  }

  return { subscription, metadata, remoteServer, remoteError };
}

function resolveGameServerIdentifier(context) {
  const remoteAttrs = extractAttributes(context?.remoteServer);
  return remoteAttrs.identifier || pteroShortId(remoteAttrs.uuid || context?.subscription?.service_uuid);
}

async function ensureNotificationPreferences(connection, userId) {
  const [rows] = await connection.query(
    'SELECT user_id, browser_enabled, in_app_enabled, email_enabled FROM notification_preferences WHERE user_id = ?',
    [userId]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  await connection.query(
    'INSERT INTO notification_preferences (user_id, browser_enabled, in_app_enabled, email_enabled) VALUES (?, TRUE, TRUE, TRUE)',
    [userId]
  );

  return {
    user_id: userId,
    browser_enabled: true,
    in_app_enabled: true,
    email_enabled: true
  };
}

async function createNotificationRecord(connection, { userId, type, title, message, link = null, metadata = null }) {
  await connection.query(
    'INSERT INTO notifications (user_id, type, title, message, link, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, type, title, message, link, metadata ? JSON.stringify(metadata) : null]
  );
  setTimeout(() => broadcastNotificationRefresh(userId, 'new-notification'), 350);
}

async function notifyUserIfEnabled(connection, userId, payload) {
  const prefs = await ensureNotificationPreferences(connection, userId);
  if (prefs.in_app_enabled || prefs.browser_enabled) {
    await createNotificationRecord(connection, { userId, ...payload });
  }
  return prefs;
}

async function notifyAllAdminsIfEnabled(connection, payload) {
  const [admins] = await connection.query(
    "SELECT id, email, username FROM users WHERE role IN ('admin', 'super_admin')"
  );

  const recipients = [];
  for (const admin of admins) {
    const prefs = await ensureNotificationPreferences(connection, admin.id);
    if (prefs.in_app_enabled || prefs.browser_enabled) {
      await createNotificationRecord(connection, { userId: admin.id, ...payload });
    }
    recipients.push({ ...admin, preferences: prefs });
  }

  return recipients;
}

async function getNotificationRows(connection, userId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const [notifications] = await connection.query(
    `SELECT id, type, title, message, link, metadata, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    [userId]
  );
  const [countRows] = await connection.query(
    'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );

  return {
    notifications,
    unread_count: Number(countRows[0]?.unread_count || 0)
  };
}

function buildGamePanelPasswordResponseMessage(usedSetupToken) {
  return usedSetupToken
    ? 'Your Pterodactyl password is set. You can now sign in to the game panel.'
    : 'Your Pterodactyl password was updated successfully.';
}

// GET /api/user/game/:uuid/info — server details (name, node, limits, allocations)
app.get('/api/user/game/:uuid/info', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;

    if (!context) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const payload = buildPanelInfoPayload({
      subscription: context.subscription,
      metadata: context.metadata,
      remoteServer: context.remoteServer,
      userEmail: req.user.email
    });

    if (context.remoteError) {
      payload.dashboard.warning = context.remoteError.message;
    }

    res.json(payload);
  } catch (err) {
    const status = err.response?.status || 500;
    console.error('[game/info] Error:', err.response?.data || err.message);
    res.status(status).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/resources — live CPU/RAM/disk stats
app.get('/api/user/game/:uuid/resources', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;

    if (!context) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    let resourcePayload = null;
    let liveError = null;

    try {
      const remoteAttrs = extractAttributes(context.remoteServer);
      const identifier = remoteAttrs.identifier || pteroShortId(remoteAttrs.uuid || context.subscription.service_uuid);
      resourcePayload = await retryWithBackoff(
        () => ptero.getServerStatus(identifier),
        { maxAttempts: 3, baseDelayMs: 500 }
      );
    } catch (err) {
      liveError = err;
    }

    res.json(buildPanelResourcePayload({
      subscription: context.subscription,
      remoteServer: context.remoteServer,
      resourcePayload,
      liveError
    }));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/user/game/:uuid/power — start/stop/restart/kill
app.post('/api/user/game/:uuid/power', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  const signal = req.body.signal || req.body.action;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    await ptero.setPowerState(resolveGameServerIdentifier(context), signal);
    res.json({ status: 'success', signal });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/user/game/:uuid/command — send console command
app.post('/api/user/game/:uuid/command', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  const { command } = req.body;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    await ptero.sendCommand(resolveGameServerIdentifier(context), command);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/files/list — file manager listing
app.get('/api/user/game/:uuid/files/list', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getFiles(resolveGameServerIdentifier(context), req.query.directory || '/');
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/files/contents — read file
app.get('/api/user/game/:uuid/files/contents', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getFileContents(resolveGameServerIdentifier(context), req.query.file);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/user/game/:uuid/files/write — write / save file
app.post('/api/user/game/:uuid/files/write', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    await ptero.writeFile(resolveGameServerIdentifier(context), req.query.file, req.body.content || req.body.contents || '');
    res.json({ status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/rename', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.renameFiles(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/copy', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.copyFile(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/delete', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.deleteFiles(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/compress', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.compressFiles(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/decompress', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.decompressFile(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/chmod', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.chmodFiles(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/files/create-folder', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.createFolder(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/user/game/:uuid/files/upload', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getUploadUrl(resolveGameServerIdentifier(context));
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/user/game/:uuid/files/download', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getDownloadUrl(resolveGameServerIdentifier(context), req.query.file);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/databases
app.get('/api/user/game/:uuid/databases', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getDatabases(resolveGameServerIdentifier(context));
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/databases', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.createDatabase(resolveGameServerIdentifier(context), req.body);
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.delete('/api/user/game/:uuid/databases/:databaseId', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid, databaseId } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    await ptero.deleteDatabase(resolveGameServerIdentifier(context), databaseId);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/backups
app.get('/api/user/game/:uuid/backups', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getBackups(resolveGameServerIdentifier(context));
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/user/game/:uuid/backups', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.createBackup(resolveGameServerIdentifier(context), req.body || {});
    res.json(data || { status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.delete('/api/user/game/:uuid/backups/:backupId', authenticateToken, requireCsrfToken, async (req, res) => {
  const { uuid, backupId } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    await ptero.deleteBackup(resolveGameServerIdentifier(context), backupId);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/user/game/:uuid/backups/:backupId/download', authenticateToken, async (req, res) => {
  const { uuid, backupId } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getBackupDownload(resolveGameServerIdentifier(context), backupId);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors?.[0]?.detail || err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/network/allocations
app.get('/api/user/game/:uuid/network/allocations', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getNetworkAllocations(resolveGameServerIdentifier(context));
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/startup — startup variables
app.get('/api/user/game/:uuid/startup', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;
    if (!context) return res.status(403).json({ error: 'Unauthorized' });
    const data = await ptero.getStartupVariables(resolveGameServerIdentifier(context));
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/user/game/:uuid/websocket — websocket credentials
app.get('/api/user/game/:uuid/websocket', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;

    if (!context) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const remoteAttrs = extractAttributes(context.remoteServer);
    const identifier = remoteAttrs.identifier || pteroShortId(remoteAttrs.uuid || context.subscription.service_uuid);
    const data = await retryWithBackoff(
      () => ptero.getWebsocketCredentials(identifier),
      { maxAttempts: 3, baseDelayMs: 500 }
    );
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json({
      error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to establish the live console connection'
    });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/user/game/:uuid/logs', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await resolveOwnedGamePanelContext(connection, req.user.id, uuid);
    connection.release();
    connection = null;

    if (!context) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const remoteAttrs = extractAttributes(context.remoteServer);
    const identifier = remoteAttrs.identifier || pteroShortId(remoteAttrs.uuid || context.subscription.service_uuid);
    const candidates = ['/logs/latest.log', '/latest.log', '/server.log'];

    for (const file of candidates) {
      try {
        const logs = await retryWithBackoff(
          () => ptero.getFileContents(identifier, file),
          { maxAttempts: 2, baseDelayMs: 300 }
        );
        if (typeof logs === 'string' && logs.trim()) {
          return res.json({ success: true, logs });
        }
      } catch (err) {
        // Try next candidate file.
      }
    }

    res.status(404).json({ error: 'No logs found for this server' });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message || 'Failed to load server logs' });
  } finally {
    if (connection) connection.release();
  }
});


app.post('/api/user/add-funds', authenticateToken, async (req, res) => {
  const { amount, payment_method } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Update user balance
    await connection.query(
      'UPDATE users SET balance = balance + ? WHERE id = ?',
      [amount, req.user.id]
    );
    
    // Create transaction record
    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, description, status) VALUES (?, 'credit', ?, ?, 'completed')",
      [req.user.id, amount, `Funds added via ${payment_method}`]
    );
    
    await connection.commit();
    
    // Get updated balance and user info
    const [balanceRows] = await connection.query('SELECT email, username, balance FROM users WHERE id = ?', [req.user.id]);
    connection.release();
    
    if (balanceRows.length > 0) {
      mailer.sendFundsAdded({ 
        to: balanceRows[0].email, 
        username: balanceRows[0].username, 
        amount, 
        balance: balanceRows[0].balance 
      }).catch(e => console.error('[Mailer] Funds added fail:', e.message));
    }
    
    res.json({ 
      message: 'Funds added successfully',
      amount
    });
    
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Add funds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/user/cashbox', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const [users] = await connection.query(
      'SELECT id, username, balance, total_spent, credits FROM users WHERE id = ?',
      [req.user.id]
    );
    const [redemptions] = await connection.query(
      `SELECT vr.id, vr.amount, vr.redeemed_at, t.id AS transaction_id, t.description, v.code
       FROM voucher_redemptions vr
       JOIN vouchers v ON v.id = vr.voucher_id
       LEFT JOIN transactions t ON t.id = vr.transaction_id
       WHERE vr.user_id = ?
       ORDER BY vr.redeemed_at DESC
       LIMIT 25`,
      [req.user.id]
    );

    connection.release();
    res.json({
      user: users[0] || null,
      redemptions
    });
  } catch (err) {
    if (connection) connection.release();
    console.error('Cashbox fetch error:', err);
    res.status(500).json({ error: 'Failed to load cashbox data' });
  }
});

app.post('/api/user/vouchers/redeem', authenticateToken, async (req, res) => {
  const code = normalizeVoucherCode(req.body?.code);

  if (!code) {
    return res.status(400).json({ error: 'Voucher code is required' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [voucherRows] = await connection.query(
      'SELECT * FROM vouchers WHERE code = ? FOR UPDATE',
      [code]
    );

    if (voucherRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Voucher code not found' });
    }

    const voucher = voucherRows[0];
    const now = new Date();

    if (!voucher.is_active) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: 'This voucher is inactive' });
    }

    if (voucher.expires_at && new Date(voucher.expires_at) < now) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: 'This voucher has expired' });
    }

    if (Number(voucher.redeemed_count) >= Number(voucher.max_redemptions)) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: 'This voucher has reached its usage limit' });
    }

    const [existingRedemption] = await connection.query(
      'SELECT id FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?',
      [voucher.id, req.user.id]
    );

    if (existingRedemption.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: 'You have already redeemed this voucher' });
    }

    await connection.query(
      'UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [voucher.amount, req.user.id]
    );

    const [transactionResult] = await connection.query(
      `INSERT INTO transactions (user_id, type, amount, description, reference_id, status)
       VALUES (?, 'credit', ?, ?, ?, 'completed') RETURNING id`,
      [req.user.id, voucher.amount, `Voucher redeemed: ${voucher.code}`, voucher.code]
    );

    await connection.query(
      `INSERT INTO voucher_redemptions (voucher_id, user_id, transaction_id, amount)
       VALUES (?, ?, ?, ?)`,
      [voucher.id, req.user.id, transactionResult.insertId, voucher.amount]
    );

    await connection.query(
      'UPDATE vouchers SET redeemed_count = redeemed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [voucher.id]
    );

    const [updatedUserRows] = await connection.query(
      'SELECT id, username, balance FROM users WHERE id = ?',
      [req.user.id]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: 'Voucher redeemed successfully',
      voucher: {
        code: voucher.code,
        amount: Number(voucher.amount),
        max_redemptions: Number(voucher.max_redemptions),
        redeemed_count: Number(voucher.redeemed_count) + 1
      },
      transaction: {
        id: transactionResult.insertId,
        description: `Voucher redeemed: ${voucher.code}`
      },
      balance: Number(updatedUserRows[0]?.balance || 0)
    });
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    console.error('Voucher redemption error:', err);
    res.status(500).json({ error: err.message || 'Failed to redeem voucher' });
  }
});

// Create support ticket
app.post('/api/user/support', authenticateToken, async (req, res) => {
  const { subject, message, priority } = req.body;
  
  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required' });
  }
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    // Create support ticket
    const [result] = await connection.query(
      'INSERT INTO support_tickets (user_id, subject, message, priority) VALUES (?, ?, ?, ?) RETURNING id',
      [req.user.id, subject, message, priority || 'medium']
    );
    
    // Update or create user stats
    await connection.query(
      `INSERT INTO user_stats (user_id, support_tickets) 
       VALUES (?, 1) 
       ON CONFLICT (user_id) DO UPDATE SET support_tickets = user_stats.support_tickets + 1`,
      [req.user.id]
    );
    
    await connection.commit();
    
    const ticketId = result.insertId;
    
    // Fetch user email for notification
    const [userRows] = await connection.query('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
    if (userRows.length > 0) {
      mailer.sendTicketOpened({ 
        to: userRows[0].email, 
        username: userRows[0].username, 
        ticketId, 
        subject, 
        priority: priority || 'medium' 
      }).catch(e => console.error('[Mailer] Ticket opened fail:', e.message));
    }
    
    res.status(201).json({ 
      message: 'Support ticket created successfully',
      ticket_id: ticketId
    });
    
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Support ticket error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Get user support tickets
app.get('/api/user/tickets', authenticateToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [tickets] = await connection.query(
      'SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    connection.release();
    res.json({ tickets });
  } catch (err) {
    console.error('Get tickets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single ticket details
app.get('/api/user/tickets/:id', authenticateToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get ticket info
    const [tickets] = await connection.query(
      'SELECT * FROM support_tickets WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (tickets.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Get replies
    const [replies] = await connection.query(
      'SELECT * FROM support_replies WHERE ticket_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    
    connection.release();
    res.json({ ticket: tickets[0], replies });
  } catch (err) {
    console.error('Get ticket error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const payload = await getNotificationRows(connection, req.user.id, req.query.limit);
    connection.release();
    connection = null;
    res.json(payload);
  } catch (err) {
    if (connection) connection.release();
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications/stream', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const client = addNotificationStreamClient(user.id, res);
  writeSseEvent(res, 'ready', { ok: true, ts: Date.now() });

  req.on('close', () => {
    removeNotificationStreamClient(user.id, client);
  });
});

app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [req.params.id, req.user.id]
    );
    connection.release();
    connection = null;
    broadcastNotificationRefresh(req.user.id, 'marked-read');
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    if (connection) connection.release();
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    connection.release();
    connection = null;
    broadcastNotificationRefresh(req.user.id, 'marked-all-read');
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    if (connection) connection.release();
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications/preferences', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const preferences = await ensureNotificationPreferences(connection, req.user.id);
    connection.release();
    connection = null;
    res.json({ preferences });
  } catch (err) {
    if (connection) connection.release();
    console.error('Get notification preferences error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/notifications/preferences', authenticateToken, async (req, res) => {
  const browserEnabled = req.body?.browser_enabled !== false;
  const inAppEnabled = req.body?.in_app_enabled !== false;
  const emailEnabled = req.body?.email_enabled !== false;
  let connection;
  try {
    connection = await pool.getConnection();
    await ensureNotificationPreferences(connection, req.user.id);
    await connection.query(
      `UPDATE notification_preferences
       SET browser_enabled = ?, in_app_enabled = ?, email_enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [browserEnabled, inAppEnabled, emailEnabled, req.user.id]
    );
    const preferences = await ensureNotificationPreferences(connection, req.user.id);
    connection.release();
    connection = null;
    broadcastNotificationRefresh(req.user.id, 'preferences-updated');
    res.json({ message: 'Notification preferences updated', preferences });
  } catch (err) {
    if (connection) connection.release();
    console.error('Update notification preferences error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post reply to ticket
app.post('/api/user/tickets/:id/reply', authenticateToken, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    // Verify ownership
    const [tickets] = await connection.query(
      'SELECT id, subject FROM support_tickets WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (tickets.length === 0) {
      await connection.rollback();
      connection.release();
      connection = null;
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Insert reply
    await connection.query(
      'INSERT INTO support_replies (ticket_id, user_id, message, is_admin) VALUES (?, ?, ?, FALSE)',
      [req.params.id, req.user.id, message]
    );
    
    // Update ticket status to open if it was resolved
    await connection.query(
      "UPDATE support_tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [req.params.id]
    );

    const adminRecipients = await notifyAllAdminsIfEnabled(connection, {
      type: 'ticket_user_reply',
      title: `User replied to ticket #${req.params.id}`,
      message: `${req.user.username || req.user.email || 'A user'} replied to "${tickets[0].subject}".`,
      link: `/admin.html#support`,
      metadata: { ticket_id: Number(req.params.id), subject: tickets[0].subject }
    });

    await connection.commit();
    
    connection.release();
    connection = null;

    for (const admin of adminRecipients) {
      if (admin.preferences?.email_enabled) {
        mailer.sendAdminTicketAlertTo({
          to: admin.email,
          ticketId: req.params.id,
          subject: tickets[0].subject,
          username: req.user.username || req.user.email || 'User'
        }).catch((e) => console.error('[Mailer] Admin ticket alert fail:', e.message));
      }
    }
    res.json({ message: 'Reply posted successfully' });
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    console.error('Post reply error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- BILLING ROUTES ---

// Create Invoice
app.post('/api/billing/invoice', userAuth, async (req, res) => {
  const { planId, amount } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO invoices (user_id, amount, plan_id) VALUES (?, ?, ?) RETURNING id',
      [req.userId, amount, planId]
    );
    res.status(201).json({ message: 'Invoice generated', invoiceId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay Invoice (Simulated)
app.post('/api/billing/pay', userAuth, async (req, res) => {
  const { invoiceId } = req.body;
  try {
    // 1. Mark invoice as paid
    await pool.query("UPDATE invoices SET status = 'PAID' WHERE id = ? AND user_id = ?", [invoiceId, req.userId]);

    // 2. Fetch plan details
    const [invoices] = await pool.query('SELECT plan_id FROM invoices WHERE id = ?', [invoiceId]);
    const planId = invoices[0].plan_id;
    const [plans] = await pool.query('SELECT * FROM plans WHERE id = ?', [planId]);
    const plan = plans[0];

    // 3. Provision service (if VPS/RDP via Ryze)
    if (plan.type === 'VPS' || plan.type === 'RDP') {
      const orderPayload = buildRyzeOrderPayload(plan, {
        hostname: `vps-${req.userId}`,
        runtime: 30
      });
      const order = await ryze.orderServer(orderPayload);

      // 4. Create subscription
      await pool.query(
        "INSERT INTO subscriptions (user_id, service_type, service_uuid, plan_id, expires_at) VALUES (?, ?, ?, ?, NOW() + INTERVAL '30 days')",
        [req.userId, plan.type, order.data.uuid, planId]
      );
    }

    res.json({ message: 'Payment processed and service provisioned!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RYZE VPS/RDP CONTROL ROUTES ---

app.get('/api/vps/list', userAuth, async (req, res) => {
  try {
    const [subs] = await pool.query("SELECT * FROM subscriptions WHERE user_id = ? AND (service_type = 'VPS' OR service_type = 'RDP')", [req.userId]);
    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vps/:uuid/power', userAuth, async (req, res) => {
  const { action } = req.body;
  try {
    const result = await ryze.setPowerState(req.params.uuid, action);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vps/:uuid/status', userAuth, async (req, res) => {
  try {
    const status = await ryze.getServerStatus(req.params.uuid);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RYZE VPS/RDP CONTROL ROUTES ---

// Get server IP addresses
app.get('/api/server/:uuid/ipaddresses', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  
  try {
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/ipaddresses`, {
      headers: {
        'Authorization': `Bearer ${process.env.RYZE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: { uuid: toDashedUuid(uuid) },
      params: { uuid: toDashedUuid(uuid) }
    });
    
    if (response.data.state === 'success') {
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: 'Failed to get IP addresses' });
    }
  } catch (error) {
    if (error.response?.status === 404) {
      return res.json({
        ipv4_addresses: [], ipv6_addresses: [], primary_ipv4: null, primary_ipv6: null
      });
    }
    console.error('IP addresses error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Get server hardware info
app.get('/api/server/:uuid/hardware', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  try {
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/hardware`, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Content-Type': 'application/json' },
      params: { uuid }
    });
    if (response.data.state === 'success') res.json(response.data.data);
    else res.status(400).json({ error: 'Failed to get hardware info' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get server RRD data (statistics)
app.get('/api/server/:uuid/rrddata', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  try {
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/rrddata`, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Content-Type': 'application/json' },
      params: { uuid }
    });
    if (response.data.state === 'success') res.json(response.data.data);
    else res.status(400).json({ error: 'Failed to get RRD data' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Power management
app.post('/api/server/:uuid/power', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  const { action } = req.body;
  try {
    const response = await axios.post(`https://dash.ryzehosting.com/api/v2/server/power`, { uuid, action }, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Content-Type': 'application/json' }
    });
    if (response.data.state === 'success') res.json({ message: 'Power action executed successfully' });
    else res.status(400).json({ error: 'Failed to execute power action' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reinstall server
app.post('/api/server/:uuid/reinstall', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  const { os, hostname } = req.body;
  try {
    const response = await axios.post(`https://dash.ryzehosting.com/api/v2/server/reinstall`, { uuid, os, hostname }, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Content-Type': 'application/json' }
    });
    if (response.data.state === 'success') res.json({ message: 'Reinstallation started', data: response.data.data });
    else res.status(400).json({ error: 'Failed to start reinstallation' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password
app.post('/api/server/:uuid/password', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  const { password } = req.body;
  try {
    const response = await axios.post(`https://dash.ryzehosting.com/api/v2/server/password`, { uuid, password }, {
      headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Content-Type': 'application/json' }
    });
    if (response.data.state === 'success') res.json({ message: 'Password reset successfully', data: response.data.data });
    else res.status(400).json({ error: 'Failed to reset password' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get server status
app.get('/api/server/:uuid/status', authenticateToken, async (req, res) => {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  
  try {
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/status`, {
      headers: {
        'Authorization': `Bearer ${process.env.RYZE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: { uuid: toDashedUuid(uuid) },
      params: { uuid: toDashedUuid(uuid) }
    });
    
    if (response.data.state === 'success') {
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: 'Failed to get server status' });
    }
  } catch (error) {
    if (error.response?.status === 404) {
      return res.json({ status: 'offline', power: 'unknown' });
    }
    console.error('Server status error:', error.response?.data || error.message);
    res.status(error.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// --- PTERODACTYL GAME SERVER MANAGEMENT ---

// Pterodactyl API client
const pteroClient = axios.create({
  baseURL: process.env.PTERODACTYL_URL || 'https://panel.host1top.example/api',
  headers: {
    'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Get game server details
app.get('/api/server/:uuid/details', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  
  try {
    const response = await pteroClient.get(`/client/servers/${uuid}`);
    res.json(response.data);
  } catch (error) {
    console.error('Pterodactyl server details error:', error);
    res.status(500).json({ error: 'Failed to get server details' });
  }
});

// Get server resources
app.get('/api/server/:uuid/resources', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  
  try {
    const response = await pteroClient.get(`/client/servers/${uuid}/resources`);
    res.json(response.data);
  } catch (error) {
    console.error('Pterodactyl resources error:', error);
    res.status(500).json({ error: 'Failed to get server resources' });
  }
});

// Get server console
app.get('/api/server/:uuid/console', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  
  try {
    const response = await pteroClient.get(`/client/servers/${uuid}/console`);
    res.json(response.data);
  } catch (error) {
    console.error('Pterodactyl console error:', error);
    res.status(500).json({ error: 'Failed to get console output' });
  }
});

// Send command to game server
app.post('/api/server/:uuid/command', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  const { command } = req.body;
  
  try {
    const response = await pteroClient.post(`/client/servers/${uuid}/command`, {
      command
    });
    res.json({ message: 'Command sent successfully' });
  } catch (error) {
    console.error('Pterodactyl command error:', error);
    res.status(500).json({ error: 'Failed to send command' });
  }
});

// Power actions for game server
app.post('/api/server/:uuid/power', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  const { signal } = req.body; // start, stop, restart, kill
  
  try {
    const response = await pteroClient.post(`/client/servers/${uuid}/power`, {
      signal
    });
    res.json({ message: 'Power action sent successfully' });
  } catch (error) {
    console.error('Pterodactyl power error:', error);
    res.status(500).json({ error: 'Failed to send power signal' });
  }
});

// Update server settings
app.post('/api/server/:uuid/settings', authenticateToken, async (req, res) => {
  const { uuid } = req.params;
  const settings = req.body;
  
  try {
    const response = await pteroClient.post(`/client/servers/${uuid}/settings`, settings);
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Pterodactyl settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --- AI CHAT ENDPOINT (DEEPSEEK) ---
app.post('/api/ai/chat', async (req, res) => {
  const { messages } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const systemPrompt = {
    role: "system",
    content: `You are the HOST1TOP Assistant. 
    Strict Limits:
    1. Only answer questions about HOST1TOP website, hosting products (VPS, RDP, Game Servers), and solving problems with our control panels.
    2. If a user asks about anything else (general knowledge, coding not related to our API, personal advice), politely refuse and state that you are here to help with HOST1TOP services.
    3. Be professional, helpful, and concise.
    4. Our main products: Budget Cloud VPS, Extreme Cloud VPS (Ryzen 9 9950X), Game Hosting (SA-MP, MTA, Minecraft).
    5. Support is available 24/7 via ticket or Discord.`
  };

  try {
    const completion = await deepseek.chat.completions.create({
      messages: [systemPrompt, ...messages],
      model: "deepseek-chat",
    });

    res.json({
      reply: completion.choices[0].message.content,
      meta: { provider: 'Deepseek' }
    });
  } catch (error) {
    console.error('Deepseek API error:', error.response?.data || error.message);
    if (error.response?.status === 402) {
      return res.status(402).json({ error: 'The AI assistant has insufficient balance to process your request. Please contact support.' });
    }
    res.status(500).json({ error: 'AI Assistant is temporarily unavailable' });
  }
});

// --- ADMIN ENDPOINTS ---

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Find admin user
    const [users] = await connection.query(
      "SELECT * FROM users WHERE (username = ? OR email = ?) AND role IN ('admin', 'super_admin')", 
      [username, username]
    );
    
    if (users.length === 0) {
      connection.release();
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    
    const user = users[0];
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      connection.release();
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    
    // Update last login
    await connection.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );
    
    connection.release();
    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      message: 'Admin login successful',
      token,
      admin: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        role: user.role 
      }
    });
    
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Admin Dashboard Data
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get system statistics
    const [stats] = await connection.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended_users,
        COUNT(CASE WHEN status = 'banned' THEN 1 END) as banned_users,
        COUNT(CASE WHEN role = 'admin' OR role = 'super_admin' THEN 1 END) as admin_users,
        SUM(balance) as total_balance,
        SUM(total_spent) as total_revenue
      FROM users
    `);
    
    // Get service statistics
    const [serviceStats] = await connection.query(`
      SELECT 
        COUNT(*) as total_subscriptions,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_services,
        COUNT(CASE WHEN service_type = 'VPS' THEN 1 END) as vps_services,
        COUNT(CASE WHEN service_type = 'RDP' THEN 1 END) as rdp_services,
        COUNT(CASE WHEN service_type = 'GAME' THEN 1 END) as game_services
      FROM subscriptions
    `);
    
    // Get recent registrations
    const [recentUsers] = await connection.query(
      'SELECT id, username, email, created_at FROM users ORDER BY created_at DESC LIMIT 10'
    );
    
    // Get recent transactions
    const [recentTransactions] = await connection.query(
      'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10'
    );
    
    // Get support tickets
    const [tickets] = await connection.query(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tickets
      FROM support_tickets
    `);
    
    connection.release();
    
    res.json({
      system_stats: stats[0],
      service_stats: serviceStats[0],
      recent_users: recentUsers,
      recent_transactions: recentTransactions,
      support_stats: tickets[0]
    });
    
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Users
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    let query = `
      SELECT id, username, email, balance, total_spent, credits, status, role, last_login, created_at 
      FROM users 
      WHERE 1=1
    `;
    let params = [];
    
    if (search) {
      query += ' AND (username LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const [users] = await connection.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    let countParams = [];
    
    if (search) {
      countQuery += ' AND (username LIKE ? OR email LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    const [countResult] = await connection.query(countQuery, countParams);
    
    connection.release();
    
    res.json({
      users,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / limit)
      }
    });
    
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update User Status
app.put('/api/admin/users/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  const userId = req.params.id;
  
  if (!['active', 'suspended', 'banned'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Fetch user info before update for email
    const [userRows] = await connection.query('SELECT email, username FROM users WHERE id = ?', [userId]);
    
    await connection.query(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, userId]
    );
    
    connection.release();
    
    // Send suspension email if account was suspended
    if ((status === 'suspended' || status === 'banned') && userRows.length > 0) {
      mailer.sendAccountSuspended({ 
        to: userRows[0].email, 
        username: userRows[0].username 
      }).catch(e => console.error('[Mailer] Account suspended fail:', e.message));
    }
    
    res.json({ message: 'User status updated successfully' });
    
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update User Balance
app.put('/api/admin/users/:id/balance', adminAuth, async (req, res) => {
  const { amount, action } = req.body; // action: 'add' or 'subtract'
  const userId = req.params.id;
  
  if (!amount || amount <= 0 || !['add', 'subtract'].includes(action)) {
    return res.status(400).json({ error: 'Invalid amount or action' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const balanceChange = action === 'add' ? amount : -amount;
    
    // Update user balance
    await connection.query(
      'UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [balanceChange, userId]
    );
    
    // Create transaction record
    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, description, status) VALUES (?, ?, ?, ?, 'completed')",
      [userId, action === 'add' ? 'credit' : 'debit', amount, `Admin ${action} of funds`]
    );
    
    await connection.commit();
    
    // Fetch updated user info to send notification
    const [userRows] = await connection.query('SELECT email, username, balance FROM users WHERE id = ?', [userId]);
    connection.release();
    
    if (action === 'add' && userRows.length > 0) {
      mailer.sendFundsAdded({ 
        to: userRows[0].email, 
        username: userRows[0].username, 
        amount, 
        balance: userRows[0].balance 
      }).catch(e => console.error('[Mailer] Admin funds added fail:', e.message));
    }
    
    res.json({ message: 'User balance updated successfully' });
    
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Update user balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Plans
app.get('/api/admin/plans', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [plans] = await connection.query('SELECT * FROM plans ORDER BY created_at DESC');
    
    connection.release();
    
    res.json({ plans });
    
  } catch (err) {
    console.error('Get plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public route to get plans for frontend
app.get('/api/plans', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [plans] = await connection.query('SELECT * FROM plans ORDER BY price ASC');
    connection.release();
    res.json({ plans });
  } catch (err) {
    console.error('Get public plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public route to get a single plan
app.get('/api/plans/:id', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [plans] = await connection.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    connection.release();
    if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: plans[0] });
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Plan
app.post('/api/admin/plans', adminAuth, async (req, res) => {
  const { name, type, price, memory, cpu, disk, nest_id, egg_id, location_id, docker_image, provider, game_name, ryze_plan_id, ryze_os_name, description, tier } = req.body;
  
  if (!name || !type || !price) {
    return res.status(400).json({ error: 'Name, type, and price are required' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    const [result] = await connection.query(
      'INSERT INTO plans (name, type, price, memory, cpu, disk, nest_id, egg_id, location_id, docker_image, provider, game_name, ryze_plan_id, ryze_os_name, ryze_cpu_type, ryze_cores, description, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [
        name, 
        type, 
        price, 
        memory || 1024, 
        cpu || 100, 
        disk || 2048, 
        nest_id === '' ? null : (nest_id || null),
        egg_id === '' ? null : (egg_id || null), 
        location_id === '' ? null : (location_id || null), 
        docker_image || '', 
        provider || 'pterodactyl', 
        game_name || '', 
        ryze_plan_id || '', 
        ryze_os_name || '', 
        req.body.ryze_cpu_type || '', 
        req.body.ryze_cores || 1, 
        description || '', 
        tier || 'Standard'
      ]
    );
    
    connection.release();
    
    res.status(201).json({ 
      message: 'Plan created successfully',
      plan_id: result.insertId
    });
    
  } catch (err) {
    console.error('Create plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Plan
app.put('/api/admin/plans/:id', adminAuth, async (req, res) => {
  const planId = req.params.id;
  const { name, type, price, memory, cpu, disk, nest_id, egg_id, location_id, docker_image, provider, game_name, ryze_plan_id, ryze_os_name, description, tier } = req.body;
  
  try {
    const connection = await pool.getConnection();
    
    await connection.query(
      'UPDATE plans SET name = ?, type = ?, price = ?, memory = ?, cpu = ?, disk = ?, nest_id = ?, egg_id = ?, location_id = ?, docker_image = ?, provider = ?, game_name = ?, ryze_plan_id = ?, ryze_os_name = ?, ryze_cpu_type = ?, ryze_cores = ?, description = ?, tier = ? WHERE id = ?',
      [
        name, 
        type, 
        price, 
        memory, 
        cpu, 
        disk, 
        nest_id === '' ? null : (nest_id || null),
        egg_id === '' ? null : (egg_id || null), 
        location_id === '' ? null : (location_id || null), 
        docker_image, 
        provider, 
        game_name, 
        ryze_plan_id, 
        ryze_os_name, 
        req.body.ryze_cpu_type, 
        req.body.ryze_cores, 
        description, 
        tier, 
        planId
      ]
    );
    
    connection.release();
    
    res.json({ message: 'Plan updated successfully' });
    
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete Plan
app.delete('/api/admin/plans/:id', adminAuth, async (req, res) => {
  const planId = req.params.id;
  
  try {
    const connection = await pool.getConnection();
    
    // Check if plan is in use
    const [subscriptions] = await connection.query(
      'SELECT COUNT(*) as count FROM subscriptions WHERE plan_id = ?',
      [planId]
    );
    
    if (subscriptions[0].count > 0) {
      connection.release();
      return res.status(400).json({ error: 'Cannot delete plan that is in use' });
    }
    
    await connection.query('DELETE FROM plans WHERE id = ?', [planId]);
    
    connection.release();
    
    res.json({ message: 'Plan deleted successfully' });
    
  } catch (err) {
    console.error('Delete plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Subscriptions
app.get('/api/admin/subscriptions', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [subscriptions] = await connection.query(`
      SELECT s.*, u.username, u.email, p.name as plan_name, p.type as service_type 
      FROM subscriptions s 
      JOIN users u ON s.user_id = u.id 
      LEFT JOIN plans p ON s.plan_id = p.id 
      ORDER BY s.created_at DESC
    `);
    
    connection.release();
    
    res.json({ subscriptions });
    
  } catch (err) {
    console.error('Get subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Support Tickets
app.get('/api/admin/support', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [tickets] = await connection.query(`
      SELECT st.*, u.username, u.email 
      FROM support_tickets st 
      JOIN users u ON st.user_id = u.id 
      ORDER BY st.created_at DESC
    `);
    connection.release();
    res.json({ tickets });
  } catch (err) {
    console.error('Get all support tickets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Single Support Ticket with Thread
app.get('/api/admin/support/:id', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [tickets] = await connection.query(`
      SELECT st.*, u.username, u.email 
      FROM support_tickets st 
      JOIN users u ON st.user_id = u.id 
      WHERE st.id = ?
    `, [req.params.id]);

    if (tickets.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const [replies] = await connection.query(
      'SELECT * FROM support_replies WHERE ticket_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    connection.release();
    res.json({ ticket: tickets[0], replies });
  } catch (err) {
    console.error('Get admin ticket error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Support Ticket Status
app.put('/api/admin/support/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  const ticketId = req.params.id;
  
  if (!['open', 'in_progress', 'closed', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    // Fetch ticket + user info before updating
    const [ticketRows] = await connection.query(`
      SELECT st.subject, st.user_id, u.email, u.username 
      FROM support_tickets st JOIN users u ON st.user_id = u.id 
      WHERE st.id = ?`, [ticketId]);
    
    await connection.query(
      'UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, ticketId]
    );

    let userPreferences = null;
    if (ticketRows.length > 0) {
      userPreferences = await notifyUserIfEnabled(connection, ticketRows[0].user_id, {
        type: 'ticket_status_update',
        title: `Ticket #${ticketId} updated`,
        message: `Your ticket "${ticketRows[0].subject}" is now marked as ${status.replace('_', ' ')}.`,
        link: `/ticket-view.html?id=${ticketId}`,
        metadata: { ticket_id: Number(ticketId), status }
      });
    }
    
    await connection.commit();
    connection.release();
    connection = null;
    
    // Email user if ticket is closed or resolved
    if ((status === 'closed' || status === 'resolved') && ticketRows.length > 0 && userPreferences?.email_enabled) {
      mailer.sendTicketClosed({
        to: ticketRows[0].email,
        username: ticketRows[0].username,
        ticketId,
        subject: ticketRows[0].subject
      }).catch(e => console.error('[Mailer] Ticket closed fail:', e.message));
    }
    
    res.json({ message: 'Support ticket status updated successfully' });
    
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    console.error('Update ticket status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Transactions
app.get('/api/admin/transactions', adminAuth, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [transactions] = await connection.query(`
      SELECT t.*, u.username, u.email 
      FROM transactions t 
      JOIN users u ON t.user_id = u.id 
      ORDER BY t.created_at DESC
    `);
    connection.release();
    res.json({ transactions });
  } catch (err) {
    console.error('Get all transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/vouchers/stats', adminAuth, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [statsRows] = await connection.query(`
      SELECT
        COUNT(*) AS total_vouchers,
        COUNT(CASE WHEN is_active = true THEN 1 END) AS active_vouchers,
        COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP THEN 1 END) AS expired_vouchers,
        COALESCE(SUM(redeemed_count), 0) AS total_redemptions,
        COALESCE(SUM(amount * redeemed_count), 0) AS redeemed_value,
        COALESCE(SUM(max_redemptions), 0) AS total_capacity
      FROM vouchers
    `);
    connection.release();

    const stats = statsRows[0] || {};
    const totalCapacity = Number(stats.total_capacity || 0);
    const totalRedemptions = Number(stats.total_redemptions || 0);

    res.json({
      stats: {
        total_vouchers: Number(stats.total_vouchers || 0),
        active_vouchers: Number(stats.active_vouchers || 0),
        expired_vouchers: Number(stats.expired_vouchers || 0),
        total_redemptions: totalRedemptions,
        redeemed_value: Number(stats.redeemed_value || 0),
        utilization_rate: totalCapacity > 0 ? Number(((totalRedemptions / totalCapacity) * 100).toFixed(2)) : 0
      }
    });
  } catch (err) {
    if (connection) connection.release();
    console.error('Voucher stats error:', err);
    res.status(500).json({ error: 'Failed to load voucher statistics' });
  }
});

app.get('/api/admin/vouchers', adminAuth, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [vouchers] = await connection.query(`
      SELECT
        v.*,
        u.username AS created_by_username,
        MAX(vr.redeemed_at) AS last_redeemed_at,
        COUNT(vr.id) AS redemption_rows,
        COUNT(DISTINCT vr.user_id) AS unique_users,
        COALESCE(SUM(vr.amount), 0) AS redeemed_value
      FROM vouchers v
      LEFT JOIN users u ON u.id = v.created_by
      LEFT JOIN voucher_redemptions vr ON vr.voucher_id = v.id
      GROUP BY v.id, u.username
      ORDER BY v.created_at DESC
    `);
    connection.release();
    res.json({ vouchers });
  } catch (err) {
    if (connection) connection.release();
    console.error('Voucher list error:', err);
    res.status(500).json({ error: 'Failed to load vouchers' });
  }
});

app.post('/api/admin/vouchers', adminAuth, async (req, res) => {
  const amount = Number(req.body?.amount);
  const maxRedemptions = Number(req.body?.max_redemptions || req.body?.maxRedemptions || 1);
  const quantity = Number(req.body?.quantity || 1);
  const expiresAt = req.body?.expires_at || req.body?.expiresAt || null;
  const notes = String(req.body?.notes || '').trim();
  const code = String(req.body?.code || '').trim();
  const prefix = String(req.body?.prefix || 'H1T').trim();
  const codeLength = Number(req.body?.code_length || req.body?.codeLength || 8);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Voucher amount must be greater than 0' });
  }
  if (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0) {
    return res.status(400).json({ error: 'Maximum redemptions must be at least 1' });
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 250) {
    return res.status(400).json({ error: 'Bulk quantity must be between 1 and 250' });
  }
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    return res.status(400).json({ error: 'Expiration date is invalid' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const vouchers = await createVoucherBatch(connection, {
      amount,
      maxRedemptions,
      expiresAt,
      notes,
      quantity,
      code,
      prefix,
      codeLength
    }, req.user.id);

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: quantity > 1 ? 'Vouchers created successfully' : 'Voucher created successfully',
      vouchers
    });
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    console.error('Voucher create error:', err);
    res.status(500).json({ error: err.message || 'Failed to create vouchers' });
  }
});

app.put('/api/admin/vouchers/:id/status', adminAuth, async (req, res) => {
  const voucherId = Number(req.params.id);
  const isActive = req.body?.is_active;

  if (!Number.isInteger(voucherId)) {
    return res.status(400).json({ error: 'Invalid voucher id' });
  }
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [result] = await connection.query(
      'UPDATE vouchers SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [isActive, voucherId]
    );
    connection.release();

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Voucher not found' });
    }

    res.json({ message: `Voucher ${isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (err) {
    if (connection) connection.release();
    console.error('Voucher status update error:', err);
    res.status(500).json({ error: 'Failed to update voucher status' });
  }
});

app.get('/api/admin/vouchers/:id/redemptions', adminAuth, async (req, res) => {
  const voucherId = Number(req.params.id);
  if (!Number.isInteger(voucherId)) {
    return res.status(400).json({ error: 'Invalid voucher id' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [voucherRows] = await connection.query(
      'SELECT id, code, amount, redeemed_count, max_redemptions, expires_at, is_active FROM vouchers WHERE id = ?',
      [voucherId]
    );

    if (voucherRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Voucher not found' });
    }

    const [redemptions] = await connection.query(
      `SELECT vr.id, vr.amount, vr.redeemed_at, vr.transaction_id, u.username, u.email
       FROM voucher_redemptions vr
       JOIN users u ON u.id = vr.user_id
       WHERE vr.voucher_id = ?
       ORDER BY vr.redeemed_at DESC`,
      [voucherId]
    );
    connection.release();

    res.json({
      voucher: voucherRows[0],
      redemptions
    });
  } catch (err) {
    if (connection) connection.release();
    console.error('Voucher redemption log error:', err);
    res.status(500).json({ error: 'Failed to load voucher redemption log' });
  }
});

app.get('/api/admin/game-servers/config', adminAuth, async (req, res) => {
  res.json({
    enabled: isAdminPterodactylEnabled()
  });
});

app.get('/api/admin/game-servers/nests', adminAuth, async (req, res) => {
  try {
    const nests = await pteroAdmin.listNests();
    res.json({ nests });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load nests', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.get('/api/admin/game-servers/nests/:nestId/eggs', adminAuth, async (req, res) => {
  try {
    const eggs = await pteroAdmin.listEggs(req.params.nestId);
    res.json({ eggs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load eggs', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.get('/api/admin/game-servers/nodes', adminAuth, async (req, res) => {
  try {
    const nodes = await pteroAdmin.listNodes();
    const hydrated = nodes.map((node) => ({
      ...node,
      capacity: pteroAdmin.calculateNodeAvailability(node)
    }));
    res.json({ nodes: hydrated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load nodes', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.get('/api/admin/game-servers/servers', adminAuth, async (req, res) => {
  let connection;
  try {
    const servers = await pteroAdmin.listServers();
    connection = await pool.getConnection();
    const [subscriptions] = await connection.query(
      `SELECT id, user_id, service_uuid, hostname, pterodactyl_server_id, pterodactyl_node_id, pterodactyl_egg_id
       FROM subscriptions WHERE service_type = 'GAME'`
    );
    connection.release();

    const subscriptionByServerId = new Map(subscriptions.map((row) => [Number(row.pterodactyl_server_id), row]));
    const subscriptionByUuid = new Map(subscriptions.map((row) => [row.service_uuid, row]));

    res.json({
      servers: servers.map((server) => {
        const attrs = server.attributes || {};
        const linked = subscriptionByServerId.get(Number(attrs.id)) || subscriptionByUuid.get(attrs.uuid) || null;
        return {
          id: attrs.id,
          uuid: attrs.uuid,
          identifier: attrs.identifier,
          name: attrs.name,
          node: attrs.relationships?.node?.attributes?.name || attrs.node,
          node_id: attrs.relationships?.node?.attributes?.id || attrs.node,
          egg: attrs.relationships?.egg?.attributes?.name || attrs.egg,
          egg_id: attrs.relationships?.egg?.attributes?.id || attrs.egg,
          owner: attrs.relationships?.user?.attributes?.email || attrs.user,
          owner_id: attrs.relationships?.user?.attributes?.id || attrs.user,
          status: attrs.suspended ? 'suspended' : pickServerState(server),
          linked_subscription_id: linked?.id || null,
          linked_user_id: linked?.user_id || null
        };
      })
    });
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ error: 'Failed to load game servers', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/users/sync', adminAuth, async (req, res) => {
  const localUserId = Number(req.body?.user_id);
  if (!Number.isInteger(localUserId)) {
    return res.status(400).json({ error: 'Valid user_id is required' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [users] = await connection.query(
      'SELECT id, username, email, first_name, last_name, pterodactyl_user_id FROM users WHERE id = ?',
      [localUserId]
    );
    if (!users.length) {
      connection.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const result = await pteroAdmin.ensureUserByEmail({
      email: user.email,
      username: user.username,
      firstName: user.first_name || user.username,
      lastName: user.last_name || 'Client',
      externalId: user.id
    });

    await syncLocalPterodactylUser(connection, user.id, result.user.attributes.id);
    connection.release();

    res.json({
      message: result.created ? 'Pterodactyl user created and linked' : 'Existing Pterodactyl user linked',
      pterodactyl_user_id: result.user.attributes.id,
      created: result.created
    });
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ error: 'Failed to sync Pterodactyl user', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/users/:userId/reset-password', adminAuth, async (req, res) => {
  const localUserId = Number(req.params.userId);
  if (!Number.isInteger(localUserId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [users] = await connection.query(
      'SELECT id, username, email, pterodactyl_user_id FROM users WHERE id = ?',
      [localUserId]
    );
    if (!users.length) {
      connection.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    if (!user.pterodactyl_user_id) {
      connection.release();
      return res.status(400).json({ error: 'User is not linked to Pterodactyl yet' });
    }

    const password = randomPassword(18);
    await pteroAdmin.resetUserPassword(user.pterodactyl_user_id, password);
    connection.release();

    mailer.sendPterodactylAccess({
      to: user.email,
      username: user.username,
      password,
      panelUrl: process.env.PTERODACTYL_URL || 'https://gp.host1top.com'
    }).catch((mailErr) => console.error('[Mailer] Pterodactyl password reset fail:', mailErr.message));

    res.json({ message: 'Pterodactyl password reset and emailed successfully' });
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ error: 'Failed to reset Pterodactyl password', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/servers/provision', adminAuth, async (req, res) => {
  const {
    user_id,
    server_name,
    node_id,
    nest_id,
    egg_id,
    memory,
    cpu,
    disk,
    hostname,
    environment,
    plan_id
  } = req.body;

  if (!user_id || !server_name || !node_id || !nest_id || !egg_id || !memory || !cpu || !disk) {
    return res.status(400).json({ error: 'Missing required provisioning fields' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [users] = await connection.query(
      'SELECT id, username, email, first_name, last_name FROM users WHERE id = ?',
      [user_id]
    );
    if (!users.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const [subResult] = await connection.query(
      `INSERT INTO subscriptions (user_id, service_type, service_uuid, hostname, plan_id, memory, cpu, disk, status, expires_at, os_name, region)
       VALUES (?, 'GAME', ?, ?, ?, ?, ?, ?, 'PENDING', NOW() + INTERVAL '30 days', ?, ?) RETURNING id`,
      [user.id, crypto.randomBytes(16).toString('hex'), hostname || server_name, plan_id || null, memory, cpu, disk, 'Managed by admin', 'Pterodactyl']
    );

    const provisioned = await pteroAdmin.provisionGameServer({
      localUserId: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name || user.username,
      lastName: user.last_name || 'Client',
      userExternalId: `host1top-user-${user.id}`,
      nodeId: Number(node_id),
      nestId: Number(nest_id),
      eggId: Number(egg_id),
      name: server_name,
      memory: Number(memory),
      disk: Number(disk),
      cpu: Number(cpu),
      environment: {
        ...buildPterodactylEnvironmentFromOrder({
          plan: { name: server_name, game_name: server_name },
          order: { hostname, environment: environment || {} },
          subscriptionId: subResult.insertId,
          user
        }),
        ...(environment || {})
      },
      serverExternalId: `host1top-sub-${subResult.insertId}`,
      externalId: `host1top-sub-${subResult.insertId}`
    });

    await syncLocalPterodactylUser(connection, user.id, provisioned.pterodactylUser.id);
    await connection.query(
      `UPDATE subscriptions
       SET service_uuid = ?, status = 'ACTIVE', pterodactyl_server_id = ?, pterodactyl_allocation_id = ?, pterodactyl_egg_id = ?, pterodactyl_node_id = ?, pterodactyl_install_state = ?, hostname = ?
       WHERE id = ?`,
      [
        provisioned.server.uuid || provisioned.server.identifier,
        provisioned.server.id,
        provisioned.allocationId,
        Number(egg_id),
        Number(node_id),
        provisioned.lifecycle,
        hostname || server_name,
        subResult.insertId
      ]
    );
    await connection.commit();
    connection.release();

    if (provisioned.generatedPassword) {
      mailer.sendPterodactylAccess({
        to: user.email,
        username: user.username,
        password: provisioned.generatedPassword,
        panelUrl: process.env.PTERODACTYL_URL || 'https://gp.host1top.com'
      }).catch((mailErr) => console.error('[Mailer] Initial Pterodactyl access fail:', mailErr.message));
    }

    res.status(201).json({
      message: 'Game server provisioned successfully',
      subscription_id: subResult.insertId,
      server_uuid: provisioned.server.uuid,
      sftp: {
        host: provisioned.sftp.ip || provisioned.sftp.host || new URL(process.env.PTERODACTYL_URL || 'https://gp.host1top.com').hostname,
        port: provisioned.sftp.port || 2022,
        username: provisioned.sftp.username || provisioned.server.identifier || null,
        password: provisioned.generatedPassword || null
      }
    });
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    res.status(500).json({ error: 'Failed to provision game server', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/servers/:identifier/power', adminAuth, async (req, res) => {
  const { signal } = req.body;
  if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
    return res.status(400).json({ error: 'Invalid power signal' });
  }

  try {
    await pteroAdmin.setServerPower(req.params.identifier, signal);
    res.json({ message: `Power signal ${signal} sent successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send power signal', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/servers/bulk/power', adminAuth, async (req, res) => {
  const identifiers = Array.isArray(req.body?.identifiers) ? req.body.identifiers : [];
  const signal = req.body?.signal;
  if (!identifiers.length || !['start', 'stop', 'restart', 'kill'].includes(signal)) {
    return res.status(400).json({ error: 'Valid identifiers and signal are required' });
  }

  try {
    await Promise.all(identifiers.map((identifier) => pteroAdmin.setServerPower(identifier, signal)));
    res.json({ message: `Bulk ${signal} completed`, count: identifiers.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to perform bulk power action', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.delete('/api/admin/game-servers/servers/:serverId', adminAuth, async (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isInteger(serverId)) {
    return res.status(400).json({ error: 'Invalid server id' });
  }

  let connection;
  try {
    await pteroAdmin.deleteServer(serverId, true);
    connection = await pool.getConnection();
    await connection.query(
      `UPDATE subscriptions
       SET status = 'CANCELLED', pterodactyl_install_state = 'deleted'
       WHERE pterodactyl_server_id = ?`,
      [serverId]
    );
    connection.release();
    res.json({ message: 'Server deleted successfully' });
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ error: 'Failed to delete server', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.post('/api/admin/game-servers/servers/bulk/delete', adminAuth, async (req, res) => {
  const serverIds = Array.isArray(req.body?.server_ids) ? req.body.server_ids.map((value) => Number(value)).filter(Number.isInteger) : [];
  if (!serverIds.length) {
    return res.status(400).json({ error: 'Valid server_ids are required' });
  }

  let connection;
  try {
    await Promise.all(serverIds.map((serverId) => pteroAdmin.deleteServer(serverId, true)));
    connection = await pool.getConnection();
    await connection.query(
      `UPDATE subscriptions
       SET status = 'CANCELLED', pterodactyl_install_state = 'deleted'
       WHERE pterodactyl_server_id = ANY($1::int[])`,
      [serverIds]
    );
    connection.release();
    res.json({ message: 'Bulk delete completed', count: serverIds.length });
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ error: 'Failed to bulk delete servers', pterodactyl: normalizePterodactylApiError(err) });
  }
});

app.get('/api/admin/game-servers/servers/:identifier/websocket', adminAuth, async (req, res) => {
  try {
    const credentials = await pteroAdmin.getWebsocketCredentials(req.params.identifier);
    res.json(credentials);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get websocket credentials', pterodactyl: normalizePterodactylApiError(err) });
  }
});

// Reply to Support Ticket
app.post('/api/admin/support/:id/reply', adminAuth, async (req, res) => {
  const ticketId = req.params.id;
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Reply message is required' });
  }
  
  let connection;
  try {
    connection = await pool.getConnection();
    
    await connection.beginTransaction();

    const [ticketRows] = await connection.query(`
      SELECT st.subject, st.user_id, u.email, u.username
      FROM support_tickets st
      JOIN users u ON st.user_id = u.id
      WHERE st.id = ?`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      await connection.rollback();
      connection.release();
      connection = null;
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Insert the admin reply
    await connection.query(
      'INSERT INTO support_replies (ticket_id, user_id, message, is_admin) VALUES (?, ?, ?, TRUE)',
      [ticketId, req.user.id, message]
    );

    // Update the ticket status
    await connection.query(
      "UPDATE support_tickets SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ticketId]
    );

    const userPreferences = await notifyUserIfEnabled(connection, ticketRows[0].user_id, {
      type: 'ticket_admin_reply',
      title: `Support replied to ticket #${ticketId}`,
      message: `HOST1TOP Support replied to "${ticketRows[0].subject}".`,
      link: `/ticket-view.html?id=${ticketId}`,
      metadata: { ticket_id: Number(ticketId), subject: ticketRows[0].subject }
    });

    await connection.commit();
    connection.release();
    connection = null;
    
    if (ticketRows.length > 0 && userPreferences?.email_enabled) {
      mailer.sendAdminReply({
        to: ticketRows[0].email,
        username: ticketRows[0].username,
        ticketId,
        subject: ticketRows[0].subject,
        adminMessage: message
      }).catch(e => console.error('[Mailer] Admin reply fail:', e.message));
    }
    
    res.json({ message: 'Reply sent and ticket status updated' });
    
  } catch (err) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
    console.error('Ticket reply error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pterodactyl Proxy
app.get('/api/admin/pterodactyl/servers', adminAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const baseUrl = process.env.PTERODACTYL_URL.replace(/\/$/, '');
    const response = await axios.get(`${baseUrl}/api/application/servers?include=allocations`, {
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    res.json({ servers: response.data.data });
  } catch (err) {
    console.error('Pterodactyl API error:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Failed to fetch Pterodactyl servers' });
  }
});

app.post('/api/admin/pterodactyl/servers/:id/suspend', adminAuth, async (req, res) => {
  try {
    await ptero.suspendServer(req.params.id);
    res.json({ message: 'Server suspended successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/pterodactyl/servers/:id/unsuspend', adminAuth, async (req, res) => {
  try {
    await ptero.unsuspendServer(req.params.id);
    res.json({ message: 'Server unsuspended successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ryze Proxy
app.get('/api/admin/ryze/servers', adminAuth, async (req, res) => {
  let connection;
  try {
    if (!process.env.RYZE_API_KEY) {
      return res.json({ servers: [] });
    }

    const listData = await ryze.listServers();
    
    // Ryze API returns { response: "success", data: { list: [...] } }
    if (listData && listData.data && listData.data.list) {
      const servers = listData.data.list;
      
      connection = await pool.getConnection();
      const [assigned] = await connection.query("SELECT service_uuid, user_id, ryze_vmid FROM subscriptions WHERE service_type IN ('VPS', 'RDP')");
      
      const assignedUuids = new Set(assigned.map(a => a.service_uuid).filter(Boolean));
      const assignedVmids = new Set(assigned.map(a => a.ryze_vmid?.toString()).filter(Boolean));

      // Fetch IP addresses for each server
      const enrichedServers = await Promise.all(servers.map(async (server) => {
        // Mark if assigned
        server.is_assigned = assignedUuids.has(server.uuid) || (server.vmid && assignedVmids.has(server.vmid.toString()));
        
        try {
          // Some Ryze endpoints expect uuid in params or body
          const ipData = await ryze.getServerIpAddresses(server.uuid);
          if (ipData && ipData.data && ipData.data.primary_ipv4) {
            server.primary_ip = ipData.data.primary_ipv4.ip;
          }
        } catch (ipErr) {
          console.warn(`[Admin:Ryze] Could not fetch IP for ${server.uuid}:`, ipErr.message);
          server.primary_ip = 'N/A';
        }
        return server;
      }));

      connection.release();
      res.json({ servers: enrichedServers });
    } else {
      res.json({ servers: [] });
    }

  } catch (err) {
    if (connection) connection.release();
    console.error('Ryze Admin API error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch Ryze infrastructure' });
  }
});

// Ryze OS List Proxy (for Deploy New Plan modal)
app.get('/api/admin/ryze/os', adminAuth, async (req, res) => {
  try {
    if (!process.env.RYZE_API_KEY) return res.json({ os_list: [] });
    
    // Correct endpoint: /server/os â€” returns array directly in data[]
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/os`, {
      headers: {
        'Authorization': `Bearer ${process.env.RYZE_API_KEY}`,
        'Accept': 'application/json'
      }
    });
    
    // Response shape: { data: [ { name, display_name, minDiskSize, image }, ... ] }
    const osList = Array.isArray(response.data?.data) ? response.data.data : [];
    res.json({ os_list: osList });
  } catch (err) {
    console.error('Ryze OS list error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch OS list', os_list: [] });
  }
});

// Admin Cancel & Refund Ryze Server
app.post('/api/admin/ryze/:uuid/cancel', adminAuth, async (req, res) => {
  const { uuid } = req.params;
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Get Subscription and User info
    const [subs] = await connection.query(`
      SELECT s.*, COALESCE(p.price, 0) as plan_price, u.id as user_id, u.balance
      FROM subscriptions s
      LEFT JOIN plans p ON s.plan_id = p.id
      JOIN users u ON s.user_id = u.id
      WHERE s.service_uuid = ? OR REPLACE(s.service_uuid, '-', '') = ? OR s.id::text = ?
      LIMIT 1
    `, [uuid, uuid.replace(/-/g, ''), uuid]);

    if (subs.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Subscription not found in local database' });
    }

    const sub = subs[0];
    const refundAmount = parseFloat(sub.plan_price || 0);

    // 2. Call Ryze API to delete
    try {
      console.log(`[Admin] Initiating Ryze deletion for ${uuid}...`);
      await axios.post(`https://dash.ryzehosting.com/api/v2/server/delete`, {
        uuid: normalizeUuid(uuid)
      }, {
        headers: { 'Authorization': `Bearer ${process.env.RYZE_API_KEY}`, 'Accept': 'application/json' },
        timeout: 10000 // 10s timeout
      });
      console.log(`[Admin] Ryze deletion successful for ${uuid}`);
    } catch (ryzeErr) {
      const errorMsg = ryzeErr.response?.data?.error || ryzeErr.response?.data?.message || ryzeErr.message;
      console.warn(`[Admin] Ryze deletion warning for ${uuid}: ${errorMsg}`);
      // We continue even if Ryze fails (e.g. if server already deleted there)
    }

    // 3. Refund User
    const finalRefund = isNaN(refundAmount) ? 0 : refundAmount;
    await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [finalRefund, sub.user_id]);

    // 4. Update Subscription
    await connection.query("UPDATE subscriptions SET status = 'CANCELLED' WHERE id = ?", [sub.id]);

    // 5. Log Transaction
    await connection.query(
      'INSERT INTO transactions (user_id, amount, type, description, status) VALUES (?, ?, ?, ?, ?)',
      [sub.user_id, finalRefund, 'credit', `Refund for cancelled ${sub.service_type || 'VPS'} #${sub.id}`, 'completed']
    );

    await connection.commit();
    connection.release();

    res.json({ 
      success: true, 
      message: `Server #${sub.id} cancelled. User refunded $${finalRefund.toFixed(2)}.`,
      refunded: finalRefund
    });

  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('Admin cancel error details:', err.message, err.stack);
    res.status(500).json({ error: `Cancellation failed: ${err.message}` });
  }
});

// Ryze Hardware / CPU Types Proxy (for Deploy New Plan modal)
app.get('/api/admin/ryze/hardware', adminAuth, async (req, res) => {
  try {
    if (!process.env.RYZE_API_KEY) return res.json({ hardware_list: [] });
    
    // Endpoint: /server/hardware â€” returns array of hardware configs
    const response = await axios.get(`https://dash.ryzehosting.com/api/v2/server/hardware`, {
      headers: {
        'Authorization': `Bearer ${process.env.RYZE_API_KEY}`,
        'Accept': 'application/json'
      }
    });
    
    // Response shape: { data: [ { name, displayname, datacenter, configuration: { cores, mem } }, ... ] }
    const hwList = Array.isArray(response.data?.data) ? response.data.data : [];
    res.json({ hardware_list: hwList });
  } catch (err) {
    console.error('Ryze hardware list error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch hardware list', hardware_list: [] });
  }
});

// --- RYZE ADMIN PROXIES ---
async function ryzeAdminProxy(req, res, path, method = 'GET', data = null) {
  const uuid = (req.params.uuid || '').replace(/-/g, '').toLowerCase();
  try {
    if (!process.env.RYZE_API_KEY) return res.status(500).json({ error: 'Ryze API not configured' });

    const dashedUuid = toDashedUuid(uuid);
    const config = {
      method,
      url: `https://dash.ryzehosting.com/api/v2/server/${path}`,
      headers: {
        'Authorization': `Bearer ${process.env.RYZE_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    config.data = { ...(data || {}), uuid: dashedUuid };
    config.params = { uuid: dashedUuid };

    const response = await axios(config);
    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 404) {
      if (path === 'status') {
        return res.json({ response: 'Success', state: 'success', code: 200, data: { status: 'offline', power: 'unknown' } });
      }
      if (path === 'ipaddresses') {
        return res.json({ response: 'Success', state: 'success', code: 200, data: { ipv4_addresses: [], ipv6_addresses: [], primary_ipv4: null, primary_ipv6: null } });
      }
    }
    console.error(`Ryze Admin Proxy Error (${path}):`, err.response?.data || err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Ryze API error' });
  }
}

app.get('/api/admin/ryze/:uuid/status', adminAuth, (req, res) => ryzeAdminProxy(req, res, 'status'));
app.get('/api/admin/ryze/:uuid/rrddata', adminAuth, (req, res) => ryzeAdminProxy(req, res, 'rrddata'));

// Search User by Email (for assignment)
app.get('/api/admin/users/search', adminAuth, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  
  try {
    const [users] = await pool.query('SELECT id, username, email FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: users[0] });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Assign Service to User
app.post('/api/admin/assign-service', adminAuth, async (req, res) => {
  const { user_id, service_type, service_uuid, hostname, plan_id, ryze_vmid } = req.body;
  
  if (!user_id || !service_type || !service_uuid) {
    return res.status(400).json({ error: 'User ID, type and UUID are required' });
  }
  
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Check if already assigned
    const [existing] = await connection.query('SELECT id FROM subscriptions WHERE service_uuid = ?', [service_uuid]);
    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({ error: 'This service is already assigned to a user' });
    }

    let memory = null, cpu = null, disk = null, os_name = null, region = null, finalVmid = ryze_vmid;

    // If Ryze, fetch real specs and VMID if not provided
    if (service_type === 'VPS' || service_type === 'RDP') {
      try {
        const servers = await getRyzeServerList();
        const server = servers.find(s => s.uuid === service_uuid || (finalVmid && s.vmid?.toString() === finalVmid.toString()));
        if (server) {
          memory = server.config?.memory || server.mem || null;
          cpu = server.config?.cores || server.cores || null;
          disk = server.config?.disk || server.disk || null;
          os_name = server.os?.display_name || server.os?.name || null;
          region = server.node?.location?.city || null;
          if (!finalVmid) finalVmid = server.vmid || server.id;
        }
      } catch (e) { console.warn('Ryze spec fetch failed during assignment', e.message); }
    }

    // Create the subscription
    const [result] = await connection.query(
      `INSERT INTO subscriptions (user_id, service_type, service_uuid, hostname, plan_id, status, memory, cpu, disk, os_name, region, ryze_vmid) 
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
      [user_id, service_type, service_uuid, hostname || (service_type === 'GAME' ? 'Game Server' : `VM #${finalVmid || 'VPS'}`), plan_id || null, memory, cpu, disk, os_name, region, finalVmid]
    );

    connection.release();
    res.json({ message: 'Service assigned successfully', subscription_id: result.insertId || result.id });
    
  } catch (err) {
    if (connection) connection.release();
    console.error('Assign service error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Catch-all route: serve index.html for any unmatched routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

module.exports = app;
