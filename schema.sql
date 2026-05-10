/*
 In Neon, databases are stored on branches. By default, a project has one branch and one database.
 This schema creates all core tables used by the website backend.
 Run these statements in the Neon SQL editor on the branch/database you want to use.
*/

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
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret VARCHAR(255),
  last_login_ip VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  memory INT DEFAULT 1024,
  cpu INT DEFAULT 100,
  disk INT DEFAULT 2048,
  egg_id INT,
  location_id INT,
  docker_image VARCHAR(255),
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
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  amount NUMERIC(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  plan_id INT REFERENCES plans(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
  auto_renew BOOLEAN DEFAULT FALSE,
  protection_enabled BOOLEAN DEFAULT FALSE,
  os_name VARCHAR(100),
  region VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vps_stats (
  id SERIAL PRIMARY KEY,
  service_uuid VARCHAR(255),
  cpu_usage NUMERIC(5, 2),
  mem_usage_mb INT,
  disk_usage_gb NUMERIC(10, 2),
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  type VARCHAR(20) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  description VARCHAR(255),
  reference_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  priority VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vps_stats_service_uuid ON vps_stats(service_uuid);
CREATE INDEX IF NOT EXISTS idx_vps_stats_timestamp ON vps_stats(timestamp);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);

INSERT INTO plans (name, type, price, memory, cpu, disk, provider, billing_cycle, tier, ryze_plan_id, description)
SELECT 'Starter VPS', 'VPS', 9.99, 2048, 2, 40, 'ryze', 'Monthly', 'Standard', '1', 'Sample starter VPS plan'
WHERE NOT EXISTS (
  SELECT 1 FROM plans WHERE name = 'Starter VPS'
);

SELECT * FROM users;
SELECT * FROM plans;
SELECT * FROM invoices;
SELECT * FROM subscriptions;
SELECT * FROM vps_stats;
SELECT * FROM user_stats;
SELECT * FROM transactions;
SELECT * FROM support_tickets;
SELECT * FROM support_replies;
SELECT * FROM password_reset_tokens;
