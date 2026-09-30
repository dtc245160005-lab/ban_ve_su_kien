const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmailService, parseMailFrom } = require('../services/emailService');

describe('Brevo HTTPS email transport', () => {
  test('parseMailFrom hỗ trợ tên hiển thị và email thuần', () => {
    assert.deepStrictEqual(parseMailFrom('"Ban Ve" <sender@example.com>'), { name: 'Ban Ve', email: 'sender@example.com' });
    assert.deepStrictEqual(parseMailFrom('sender@example.com'), { name: 'Ban Ve Su Kien', email: 'sender@example.com' });
  });

  test('gửi OTP qua Brevo API với api-key ở header và payload đúng', async () => {
    let request;
    const service = createEmailService({
      mailTransport: 'brevo',
      brevoApiKey: 'test-secret-key',
      mailFrom: '"Ban Ve" <sender@example.com>',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 201, json: async () => ({ messageId: 'test-message-id' }) };
      },
    });
    const result = await service.sendActivationCode({ to: 'buyer@example.com', fullName: 'Buyer', activationCode: '123456' });
    assert.strictEqual(result.messageId, 'test-message-id');
    assert.strictEqual(request.url, 'https://api.brevo.com/v3/smtp/email');
    assert.strictEqual(request.options.headers['api-key'], 'test-secret-key');
    const body = JSON.parse(request.options.body);
    assert.deepStrictEqual(body.sender, { name: 'Ban Ve', email: 'sender@example.com' });
    assert.deepStrictEqual(body.to, [{ email: 'buyer@example.com' }]);
    assert.match(body.textContent, /123456/);
    assert.strictEqual(request.options.body.includes('test-secret-key'), false);
  });

  test('lỗi API chỉ trả status, không đưa API key vào thông báo', async () => {
    const service = createEmailService({
      mailTransport: 'brevo',
      brevoApiKey: 'never-log-this-key',
      mailFrom: 'sender@example.com',
      fetchImpl: async () => ({ ok: false, status: 401 }),
    });
    await assert.rejects(
      service.sendMail({ to: 'buyer@example.com', subject: 'OTP', text: '123456', html: '<b>123456</b>' }),
      (error) => error.code === 'BREVO_API_ERROR' && !error.message.includes('never-log-this-key')
    );
  });
});
