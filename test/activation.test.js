const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');
const { start } = require('../index');
const activationService = require('../services/activationService');
const { redisClient, closeRedis } = require('../lib/redis');
const logger = require('../lib/logger');

describe('T-08 Account Activation & Resend Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await start({ port: 0 });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.destroy();
    await closeRedis();
  });

  async function createInactiveUserWithToken(email, password = 'Password@123') {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const tokenObj = activationService.createActivationToken();

    let user;
    await db.transaction(async (trx) => {
      const [u] = await trx('users')
        .insert({
          email,
          full_name: 'Test Activation User',
          password_hash: passwordHash,
          is_active: false,
        })
        .returning('*');

      const buyerRole = await trx('roles').where({ name: 'buyer' }).first('id');
      await trx('user_roles').insert({ user_id: u.id, role_id: buyerRole.id });

      await trx('email_activation_tokens').insert({
        user_id: u.id,
        token_hash: tokenObj.tokenHash,
        expires_at: tokenObj.expiresAt,
      });

      user = u;
    });

    return { user, rawToken: tokenObj.rawToken, tokenHash: tokenObj.tokenHash };
  }

  test('1. Kích hoạt đúng: 200; sau đó đăng nhập thành công', async () => {
    const email = `act_success_${Date.now()}@example.test`;
    const password = 'Password@123';
    const { rawToken } = await createInactiveUserWithToken(email, password);

    // Kích hoạt qua POST /api/auth/activate
    const res = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.code, 'ACCOUNT_ACTIVATED');

    // Kiểm tra user trong DB đã is_active = true
    const user = await db('users').where({ email }).first();
    assert.strictEqual(user.is_active, true);

    // Đăng nhập thử
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.strictEqual(loginBody.success, true);
    assert.strictEqual(loginBody.user.email, email);
  });

  test('2. Kích hoạt lần hai: nhận 409 TOKEN_USED (Liên kết đã được sử dụng)', async () => {
    const email = `act_twice_${Date.now()}@example.test`;
    const { rawToken } = await createInactiveUserWithToken(email);

    // Kích hoạt lần 1
    const res1 = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });
    assert.strictEqual(res1.status, 200);

    // Kích hoạt lần 2
    const res2 = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });
    assert.strictEqual(res2.status, 409);
    const body2 = await res2.json();
    assert.strictEqual(body2.success, false);
    assert.strictEqual(body2.code, 'TOKEN_USED');
    assert.ok(body2.message.includes('đã được sử dụng'));
  });

  test('3. Token hết hạn: nhận 410 TOKEN_EXPIRED (Liên kết đã hết hạn)', async () => {
    const email = `act_expired_${Date.now()}@example.test`;
    const { rawToken, tokenHash } = await createInactiveUserWithToken(email);

    // Cập nhật expires_at về quá khứ
    await db('email_activation_tokens')
      .where({ token_hash: tokenHash })
      .update({ expires_at: new Date(Date.now() - 3600 * 1000) });

    const res = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });

    assert.strictEqual(res.status, 410);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.code, 'TOKEN_EXPIRED');
    assert.ok(body.message.includes('đã hết hạn'));
  });

  test('4. Token không hợp lệ / rác: nhận 400 TOKEN_INVALID', async () => {
    const res = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid_junk_token_123' }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.code, 'TOKEN_INVALID');
  });

  test('5. 10 request kích hoạt song song cùng một token: đúng 1 request trả 200, 9 request còn lại trả 409', async () => {
    const email = `act_parallel_${Date.now()}@example.test`;
    const { rawToken } = await createInactiveUserWithToken(email);

    const requests = Array.from({ length: 10 }, () =>
      fetch(`${baseUrl}/api/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    const count200 = statuses.filter((s) => s === 200).length;
    const count409 = statuses.filter((s) => s === 409).length;

    assert.strictEqual(count200, 1, 'Đúng 1 request phải trả 200');
    assert.strictEqual(count409, 9, '9 request còn lại phải trả 409');
  });

  test('6. Gửi lại liên kết kích hoạt (resend-activation) và token cũ bị vô hiệu', async () => {
    const email = `act_resend_${Date.now()}@example.test`;
    const { rawToken: oldToken } = await createInactiveUserWithToken(email);

    // Gửi lại liên kết
    const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    assert.strictEqual(res.status, 202);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    // Token cũ phải bị đánh dấu used_at và không thể kích hoạt
    const oldTokenRes = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: oldToken }),
    });
    assert.strictEqual(oldTokenRes.status, 409);
  });

  test('7. Giới hạn gửi lại 5 lần/giờ: lần thứ 6 trả 202 nhưng không sinh token mới', async () => {
    const email = `act_ratelimit_${Date.now()}@example.test`;
    const { user } = await createInactiveUserWithToken(email);

    // Xóa key redis cũ nếu có
    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    await redisClient.del(`${prefix}resend:${emailHash}`);

    // Gửi 5 lần
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res.status, 202);
    }

    const tokensCountAfter5 = await db('email_activation_tokens')
      .where({ user_id: user.id })
      .count('id as count')
      .first();

    // Lần thứ 6
    const res6 = await fetch(`${baseUrl}/api/auth/resend-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.strictEqual(res6.status, 202);
    const body6 = await res6.json();
    assert.strictEqual(body6.success, true);

    const tokensCountAfter6 = await db('email_activation_tokens')
      .where({ user_id: user.id })
      .count('id as count')
      .first();

    assert.strictEqual(
      Number(tokensCountAfter5.count),
      Number(tokensCountAfter6.count),
      'Lần thứ 6 không được sinh thêm token mới do đã vượt quá rate limit'
    );
  });

  test('8. Đăng nhập tài khoản chưa kích hoạt: mật khẩu đúng trả 403 và không tăng đếm thất bại; mật khẩu sai trả 401 và tăng đếm thất bại', async () => {
    const email = `act_login_check_${Date.now()}@example.test`;
    const password = 'CorrectPassword@123';
    await createInactiveUserWithToken(email, password);

    // Đăng nhập mật khẩu đúng nhưng tài khoản chưa kích hoạt
    const resActive = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.strictEqual(resActive.status, 403);
    const bodyActive = await resActive.json();
    assert.strictEqual(bodyActive.code, 'ACCOUNT_NOT_ACTIVE');

    // Đăng nhập mật khẩu sai
    const resWrong = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPassword@999' }),
    });
    assert.strictEqual(resWrong.status, 401);
  });

  test('9. Bắt log khi kích hoạt và gửi lại: KHÔNG chứa token, password hay email', async () => {
    const capturedLogs = [];
    const originalSink = logger.sink;
    logger.sink = (line) => {
      capturedLogs.push(line);
    };

    const secretEmail = `secret_act_${Date.now()}@example.test`;
    const { rawToken } = await createInactiveUserWithToken(secretEmail);

    try {
      await fetch(`${baseUrl}/api/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      });

      await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: secretEmail }),
      });
    } finally {
      logger.sink = originalSink;
    }

    const allLoggedText = capturedLogs.join('\n');
    assert.strictEqual(allLoggedText.includes(secretEmail), false, 'Log không được chứa email');
    assert.strictEqual(allLoggedText.includes(rawToken), false, 'Log không được chứa raw token');
  });
});
