const crypto = require('crypto');

const secret = process.argv[2];
const encryptionKey = process.env.PTERODACTYL_SECRETS_KEY;

if (!secret) {
  console.error('Usage: node scripts/encrypt-env-secret.js <secret-value>');
  process.exit(1);
}

if (!encryptionKey) {
  console.error('Set PTERODACTYL_SECRETS_KEY in the environment before running this helper.');
  process.exit(1);
}

const key = crypto.createHash('sha256').update(String(encryptionKey)).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();

console.log(JSON.stringify({
  encrypted: encrypted.toString('base64'),
  iv: iv.toString('base64'),
  authTag: authTag.toString('base64')
}, null, 2));
