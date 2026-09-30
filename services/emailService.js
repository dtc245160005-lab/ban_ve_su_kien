const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isDevOrTestEnvironment() {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test' || !env;
}

function parseMailFrom(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(?:"?([^"<]+)"?\s*)?<([^<>\s]+@[^<>\s]+)>$/);
  if (match) return { name: (match[1] || 'Ban Ve Su Kien').trim(), email: match[2] };
  return { name: 'Ban Ve Su Kien', email: raw };
}

function assertConfiguration() {
  const transport = (process.env.MAIL_TRANSPORT || 'dev').toLowerCase();

  if (transport === 'dev') {
    if (!isDevOrTestEnvironment()) {
      throw new Error(
        'MAIL_TRANSPORT=dev chỉ được phép sử dụng ở môi trường development hoặc test. Vui lòng cấu hình MAIL_TRANSPORT=smtp trên production/staging.'
      );
    }
    return;
  }

  if (transport === 'smtp') {
    const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
    const missing = requiredVars.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Thiếu các biến môi trường SMTP bắt buộc: ${missing.join(', ')}`);
    }
    return;
  }

  if (transport === 'brevo') {
    const requiredVars = ['BREVO_API_KEY', 'MAIL_FROM'];
    const missing = requiredVars.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Thiếu các biến môi trường Brevo bắt buộc: ${missing.join(', ')}`);
    }
    return;
  }

  throw new Error(`MAIL_TRANSPORT không hợp lệ: ${transport}. Chỉ hỗ trợ 'dev', 'smtp' hoặc 'brevo'.`);
}

function createEmailService(options = {}) {
  let transporter = options.transporter || null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  function getTransporter() {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return transporter;
  }

  async function sendMail({ to, subject, text, html, attachments }) {
    const transport = (options.mailTransport || process.env.MAIL_TRANSPORT || 'dev').toLowerCase();

    if (transport === 'dev') {
      if (!isDevOrTestEnvironment() && !options.allowDevInProduction) {
        throw new Error('MAIL_TRANSPORT=dev không được phép chạy trên môi trường production.');
      }

      console.log('\n==================== [DEV MAIL] ====================');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log('----------------------------------------------------');
      console.log(text || html);
      console.log('====================================================\n');

      return { devPreview: true, to, subject };
    }

    if (transport === 'brevo') {
      const sender = parseMailFrom(options.mailFrom || process.env.MAIL_FROM);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.MAIL_TIMEOUT_MS || 10000));
      try {
        const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'api-key': options.brevoApiKey || process.env.BREVO_API_KEY,
          },
          body: JSON.stringify({
            sender,
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: html,
            ...(Array.isArray(attachments) && attachments.length > 0 ? { attachment: attachments } : {}),
          }),
        });
        if (!response.ok) {
          const error = new Error(`Brevo email API rejected the request with status ${response.status}.`);
          error.code = 'BREVO_API_ERROR';
          error.status = response.status;
          throw error;
        }
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    if (transport !== 'smtp') {
      throw new Error(`MAIL_TRANSPORT không hợp lệ: ${transport}.`);
    }

    const client = getTransporter();
    return await client.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html,
      attachments,
    });
  }

  async function sendActivationEmail({ to, fullName, activationUrl }) {
    const displayName = fullName || 'Quý khách';
    const safeName = escapeHtml(displayName);
    const safeUrl = escapeHtml(activationUrl);
    const subject = 'Xác nhận tài khoản bán vé sự kiện';

    const text = [
      `Xin chào ${displayName},`,
      '',
      'Cảm ơn bạn đã đăng ký tài khoản. Vui lòng bấm vào liên kết dưới đây để kích hoạt tài khoản của bạn:',
      activationUrl,
      '',
      'Liên kết này có hiệu lực trong vòng 24 giờ và chỉ sử dụng được 1 lần.',
      'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.',
    ].join('\n');

    const html = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
        <h2>Xin chào ${safeName},</h2>
        <p>Cảm ơn bạn đã đăng ký tài khoản tại Hệ Thống Bán Vé Sự Kiện.</p>
        <p>Vui lòng bấm vào nút bên dưới để kích hoạt tài khoản của bạn:</p>
        <p style="margin: 24px 0;">
          <a href="${safeUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Kích hoạt tài khoản</a>
        </p>
        <p>Hoặc bạn có thể sao chép liên kết sau vào trình duyệt:</p>
        <p><a href="${safeUrl}">${safeUrl}</a></p>
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
          Liên kết này có hiệu lực trong vòng 24 giờ và chỉ sử dụng được 1 lần.<br />
          Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.
        </p>
      </div>
    `;

    return sendMail({ to, subject, text, html });
  }

  async function sendActivationCode({ to, fullName, activationCode }) {
    const displayName = fullName || 'Quý khách';
    const safeName = escapeHtml(displayName);
    const safeCode = escapeHtml(activationCode);
    const subject = 'Mã xác nhận tài khoản bán vé sự kiện';
    const text = [
      `Xin chào ${displayName},`,
      '',
      `Mã xác nhận tài khoản của bạn là: ${activationCode}`,
      '',
      'Mã này có hiệu lực trong 10 phút và chỉ sử dụng được một lần.',
      'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.',
    ].join('\n');
    const html = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
        <h2>Xin chào ${safeName},</h2>
        <p>Dùng mã sau để xác nhận tài khoản của bạn:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #2563eb;">${safeCode}</p>
        <p>Mã này có hiệu lực trong 10 phút và chỉ sử dụng được một lần.</p>
        <p style="color: #666; font-size: 0.9em;">Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
      </div>
    `;
    return sendMail({ to, subject, text, html });
  }

  return {
    sendMail,
    sendActivationEmail,
    sendActivationCode,
    assertConfiguration,
    escapeHtml,
    parseMailFrom,
  };
}

const defaultEmailService = createEmailService();
defaultEmailService.createEmailService = createEmailService;
defaultEmailService.assertConfiguration = assertConfiguration;
defaultEmailService.escapeHtml = escapeHtml;
defaultEmailService.parseMailFrom = parseMailFrom;

module.exports = defaultEmailService;
