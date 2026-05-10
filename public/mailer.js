/**
 * HOST1TOP — Mailer Service
 * Centralised transactional email helper.
 * All templates share the same brand shell; only the inner card content changes.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }
});

/* ─────────────────────── BRAND SHELL ─────────────────────── */
function brandWrap(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HOST1TOP</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#111111;border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
          <span style="font-size:24px;font-weight:900;letter-spacing:-0.5px;color:#b8fb3b;">HOST1TOP</span>
        </td></tr>

        <!-- Body Card -->
        <tr><td style="background:#181818;padding:40px;">
          ${innerHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#111111;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#555;">
            &copy; ${new Date().getFullYear()} HOST1TOP — Premium Hosting Infrastructure<br/>
            <a href="${process.env.FRONTEND_URL}" style="color:#b8fb3b;text-decoration:none;">host1top.com</a>
            &nbsp;·&nbsp;
            <a href="${process.env.FRONTEND_URL}/tos.html" style="color:#555;text-decoration:none;">Terms</a>
            &nbsp;·&nbsp;
            <a href="${process.env.FRONTEND_URL}/new-ticket.html" style="color:#555;text-decoration:none;">Support</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ─────────────────────── COMMON COMPONENTS ─────────────────────── */
function heading(text) {
  return `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#ffffff;">${text}</h1>`;
}
function paragraph(text) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#aaaaaa;">${text}</p>`;
}
function infoRow(label, value) {
  return `<tr>
    <td style="padding:10px 14px;font-size:13px;color:#888;font-weight:600;background:#0f0f0f;border-bottom:1px solid #222;">${label}</td>
    <td style="padding:10px 14px;font-size:13px;color:#fff;background:#0f0f0f;border-bottom:1px solid #222;text-align:right;">${value}</td>
  </tr>`;
}
function infoTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:10px;overflow:hidden;margin-bottom:24px;border:1px solid #222;">
    ${rows}
  </table>`;
}
function ctaButton(text, url) {
  return `<a href="${url}" style="display:inline-block;padding:14px 32px;background:#b8fb3b;color:#000000;font-weight:800;font-size:14px;text-decoration:none;border-radius:8px;margin-top:8px;">${text}</a>`;
}
function badge(text, color) {
  const colors = { green: '#10b981', red: '#ef4444', yellow: '#f59e0b', blue: '#3b82f6' };
  const bg = colors[color] || colors.green;
  return `<span style="background:${bg}22;color:${bg};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;padding:3px 10px;border-radius:999px;border:1px solid ${bg}55;">${text}</span>`;
}

/* ─────────────────────── SEND HELPER ─────────────────────── */
async function send(to, subject, html) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'HOST1TOP <no-reply@host1top.com>',
      to,
      subject,
      html
    });
    console.log(`[Mailer] Email sent → ${to} | ${subject}`);
  } catch (err) {
    console.error(`[Mailer] Failed → ${to} | ${subject}:`, err.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   1. WELCOME — on registration
═══════════════════════════════════════════════════════════ */
async function sendWelcome({ to, username }) {
  const html = brandWrap(`
    ${heading('Welcome to HOST1TOP! 🚀')}
    ${paragraph(`Hi <strong>${username}</strong>, your account has been created successfully. You now have access to our full suite of hosting infrastructure—RDP, VPS, and Game Servers.`)}
    ${infoTable(
      infoRow('Account', username) +
      infoRow('Status', badge('Active', 'green')) +
      infoRow('Panel', 'Client Area')
    )}
    ${paragraph('Get started by exploring our hosting plans or logging in to your client area.')}
    ${ctaButton('Go to Client Area', `${process.env.FRONTEND_URL}/client-area.html`)}
  `);
  await send(to, 'Welcome to HOST1TOP — Account Created ✅', html);
}

/* ═══════════════════════════════════════════════════════════
   2. LOGIN ALERT — on successful login
═══════════════════════════════════════════════════════════ */
async function sendLoginAlert({ to, username, ip, time }) {
  const html = brandWrap(`
    ${heading('New Login Detected')}
    ${paragraph(`Hi <strong>${username}</strong>, a new login was recorded on your HOST1TOP account.`)}
    ${infoTable(
      infoRow('Time', time || new Date().toUTCString()) +
      infoRow('IP Address', ip || 'Unknown') +
      infoRow('Status', badge('Successful', 'green'))
    )}
    ${paragraph('If this wasn\'t you, please reset your password immediately.')}
    ${ctaButton('Reset Password', `${process.env.FRONTEND_URL}/my-account.html`)}
  `);
  await send(to, 'New Login to Your HOST1TOP Account', html);
}

/* ═══════════════════════════════════════════════════════════
   3. PASSWORD RESET
═══════════════════════════════════════════════════════════ */
async function sendPasswordReset({ to, resetLink }) {
  const html = brandWrap(`
    ${heading('Reset Your Password 🔑')}
    ${paragraph('You requested a password reset for your HOST1TOP account. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.')}
    ${ctaButton('Reset My Password', resetLink)}
    ${paragraph('If you did not request this, you can safely ignore this email — your password will not change.')}
  `);
  await send(to, 'Password Reset — HOST1TOP', html);
}

/* ═══════════════════════════════════════════════════════════
   4. PASSWORD CHANGED CONFIRMATION
═══════════════════════════════════════════════════════════ */
async function sendPasswordChanged({ to, username }) {
  const html = brandWrap(`
    ${heading('Password Changed Successfully')}
    ${paragraph(`Hi <strong>${username}</strong>, your HOST1TOP account password was just changed.`)}
    ${paragraph('If you did not make this change, contact our support team immediately.')}
    ${ctaButton('Open Support Ticket', `${process.env.FRONTEND_URL}/new-ticket.html`)}
  `);
  await send(to, 'Your Password Has Been Changed — HOST1TOP', html);
}

/* ═══════════════════════════════════════════════════════════
   5. SUPPORT TICKET OPENED — to user
═══════════════════════════════════════════════════════════ */
async function sendTicketOpened({ to, username, ticketId, subject, priority }) {
  const priorityColors = { urgent: 'red', high: 'red', medium: 'yellow', low: 'blue' };
  const html = brandWrap(`
    ${heading('Support Ticket Opened')}
    ${paragraph(`Hi <strong>${username}</strong>, we've received your support request and our team will respond shortly.`)}
    ${infoTable(
      infoRow('Ticket ID', `#${ticketId}`) +
      infoRow('Subject', subject) +
      infoRow('Priority', badge(priority, priorityColors[priority] || 'yellow')) +
      infoRow('Status', badge('Open', 'green'))
    )}
    ${paragraph('You can view your ticket and reply at any time from the client area.')}
    ${ctaButton('View Ticket', `${process.env.FRONTEND_URL}/ticket-view.html?id=${ticketId}`)}
  `);
  await send(to, `Ticket #${ticketId} Opened — ${subject}`, html);
}

/* ═══════════════════════════════════════════════════════════
   6. ADMIN REPLY — to user
═══════════════════════════════════════════════════════════ */
async function sendAdminReply({ to, username, ticketId, subject, adminMessage }) {
  const html = brandWrap(`
    ${heading('New Reply on Your Ticket')}
    ${paragraph(`Hi <strong>${username}</strong>, our support team has replied to your ticket.`)}
    ${infoTable(
      infoRow('Ticket ID', `#${ticketId}`) +
      infoRow('Subject', subject)
    )}
    <div style="background:#0f0f0f;border-left:3px solid #b8fb3b;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#cccccc;line-height:1.7;">${adminMessage}</p>
    </div>
    ${ctaButton('View & Reply', `${process.env.FRONTEND_URL}/ticket-view.html?id=${ticketId}`)}
  `);
  await send(to, `Re: Ticket #${ticketId} — ${subject}`, html);
}

/* ═══════════════════════════════════════════════════════════
   7. USER REPLY NOTIFICATION — to admin (optional inbox)
═══════════════════════════════════════════════════════════ */
async function sendAdminTicketAlertTo({ to, ticketId, subject, username }) {
  if (!to) return;
  const html = brandWrap(`
    ${heading('New Ticket Reply from User')}
    ${paragraph(`User <strong>${username}</strong> replied to ticket <strong>#${ticketId}</strong>.`)}
    ${infoTable(infoRow('Subject', subject) + infoRow('Ticket', `#${ticketId}`))}
    ${ctaButton('View in Admin Console', `${process.env.FRONTEND_URL}/admin.html`)}
  `);
  await send(to, `[Support] User replied to Ticket #${ticketId}`, html);
}

async function sendAdminTicketAlert({ ticketId, subject, username }) {
  if (!process.env.ADMIN_EMAIL) return;
  await sendAdminTicketAlertTo({
    to: process.env.ADMIN_EMAIL,
    ticketId,
    subject,
    username
  });
}

/* ═══════════════════════════════════════════════════════════
   8. FUNDS ADDED
═══════════════════════════════════════════════════════════ */
async function sendFundsAdded({ to, username, amount, balance }) {
  const html = brandWrap(`
    ${heading('Funds Added to Your Account 💳')}
    ${paragraph(`Hi <strong>${username}</strong>, funds have been successfully added to your HOST1TOP account.`)}
    ${infoTable(
      infoRow('Amount Added', `<strong style="color:#b8fb3b;">+$${parseFloat(amount).toFixed(2)}</strong>`) +
      infoRow('New Balance', `$${parseFloat(balance).toFixed(2)}`)
    )}
    ${paragraph('You can now use your balance to order or renew hosting services.')}
    ${ctaButton('View Plans', `${process.env.FRONTEND_URL}/plans/index.html`)}
  `);
  await send(to, 'Funds Added — HOST1TOP', html);
}

/* ═══════════════════════════════════════════════════════════
   9. INVOICE PAID / SERVICE PROVISIONED
═══════════════════════════════════════════════════════════ */
async function sendInvoicePaid({ to, username, invoiceId, planName, serviceType, amount, expiresAt }) {
  const html = brandWrap(`
    ${heading('Invoice Paid — Service Activated ✅')}
    ${paragraph(`Hi <strong>${username}</strong>, your payment has been processed and your service is now active.`)}
    ${infoTable(
      infoRow('Invoice', `#${invoiceId}`) +
      infoRow('Plan', planName) +
      infoRow('Service Type', badge(serviceType, 'blue')) +
      infoRow('Amount Paid', `$${parseFloat(amount).toFixed(2)}`) +
      infoRow('Valid Until', expiresAt || 'N/A') +
      infoRow('Status', badge('Active', 'green'))
    )}
    ${ctaButton('Manage Services', `${process.env.FRONTEND_URL}/my-services.html`)}
  `);
  await send(to, `Invoice #${invoiceId} Paid — ${planName} Activated`, html);
}

/* ═══════════════════════════════════════════════════════════
   10. ACCOUNT SUSPENDED (by admin)
═══════════════════════════════════════════════════════════ */
async function sendAccountSuspended({ to, username, reason }) {
  const html = brandWrap(`
    ${heading('Account Suspended')}
    ${paragraph(`Hi <strong>${username}</strong>, your HOST1TOP account has been suspended.`)}
    ${reason ? infoTable(infoRow('Reason', reason)) : ''}
    ${paragraph('If you believe this is a mistake, please contact our support team to appeal.')}
    ${ctaButton('Contact Support', `${process.env.FRONTEND_URL}/new-ticket.html`)}
  `);
  await send(to, 'Your HOST1TOP Account Has Been Suspended', html);
}

/* ═══════════════════════════════════════════════════════════
   11. TICKET CLOSED
═══════════════════════════════════════════════════════════ */
async function sendTicketClosed({ to, username, ticketId, subject }) {
  const html = brandWrap(`
    ${heading('Ticket Closed')}
    ${paragraph(`Hi <strong>${username}</strong>, your support ticket has been marked as resolved.`)}
    ${infoTable(
      infoRow('Ticket ID', `#${ticketId}`) +
      infoRow('Subject', subject) +
      infoRow('Status', badge('Closed', 'blue'))
    )}
    ${paragraph('If you need further assistance, you can open a new ticket at any time.')}
    ${ctaButton('Open New Ticket', `${process.env.FRONTEND_URL}/new-ticket.html`)}
  `);
  await send(to, `Ticket #${ticketId} Closed — ${subject}`, html);
}

/* ═══════════════════════════════════════════════════════════
   12. PTERODACTYL ACCESS / PASSWORD RESET
═══════════════════════════════════════════════════════════ */
async function sendPterodactylAccess({ to, username, password, panelUrl, setPasswordLink }) {
  const sanitizedPanelUrl = String(panelUrl || process.env.PTERODACTYL_URL || '').replace(/\/$/, '');
  const html = brandWrap(`
    ${heading('Game Panel Access Ready')}
    ${paragraph(`Hi <strong>${username}</strong>, your HOST1TOP game panel access has been prepared or reset by the administration team.`)}
    ${infoTable(
      infoRow('Panel URL', sanitizedPanelUrl || 'Not configured') +
      infoRow('Email / Username', to) +
      infoRow('Temporary Password', `<strong>${password}</strong>`) +
      infoRow('Quick Password Setup', setPasswordLink ? `<a href="${setPasswordLink}" style="color:#b8fb3b;text-decoration:none;">Open secure setup page</a>` : 'Open the client area')
    )}
    ${paragraph('Use these credentials to log in to the Pterodactyl panel. For security, please change the password immediately after signing in.')}
    ${setPasswordLink ? ctaButton('Set Your Own Password', setPasswordLink) : ''}
    <div style="height:12px;"></div>
    ${ctaButton('Open Game Panel', sanitizedPanelUrl || process.env.FRONTEND_URL)}
  `);
  await send(to, 'Pterodactyl Panel Access — HOST1TOP', html);
}

module.exports = {
  sendWelcome,
  sendLoginAlert,
  sendPasswordReset,
  sendPasswordChanged,
  sendTicketOpened,
  sendAdminReply,
  sendAdminTicketAlert,
  sendAdminTicketAlertTo,
  sendFundsAdded,
  sendInvoicePaid,
  sendAccountSuspended,
  sendTicketClosed,
  sendPterodactylAccess,
};
