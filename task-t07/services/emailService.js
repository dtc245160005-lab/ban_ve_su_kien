const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP configuration is incomplete.");
  }

  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    ...(username && password
      ? { auth: { user: username, pass: password } }
      : {}),
  });

  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  if (process.env.NODE_ENV === "development") {
    console.log(
      "[EMAIL PREVIEW - DEVELOPMENT]",
      JSON.stringify({ to, subject, text, html }, null, 2),
    );
    return { preview: true };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return getTransporter().sendMail({ from, to, subject, text, html });
}

module.exports = { sendEmail };
