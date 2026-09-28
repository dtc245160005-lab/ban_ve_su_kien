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

  throw new Error(`MAIL_TRANSPORT không hợp lệ: ${transport}. Chỉ hỗ trợ 'dev' hoặc 'smtp'.`);
}

function createEmailService(options = {}) {
  let transporter = options.transporter || null;

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

  return {
    sendMail,
    sendActivationEmail,
    assertConfiguration,
    escapeHtml,
  };
}

const defaultEmailService = createEmailService();
defaultEmailService.createEmailService = createEmailService;
defaultEmailService.assertConfiguration = assertConfiguration;
defaultEmailService.escapeHtml = escapeHtml;

module.exports = defaultEmailService;
