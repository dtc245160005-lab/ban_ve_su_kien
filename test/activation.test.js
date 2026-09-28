const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');
const { start } = require('../index');
const activationService = require('../services/activationService');
const { redisClient, closeRedis } = require('../lib/redis');
const logger = require('../lib/logger');
const resendLimiter = require('../services/resendLimiter');

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
        purpose: 'register',
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

  test('5a. Redis lỗi: truyền vào limiter một client giả, mọi lệnh đều ném lỗi. Gọi resend 6 lần: 0 token mới, 0 [DEV MAIL], cả 6 lần đều nhận 202 với body giống hệt nhau', async () => {
    const email = `act_redis_err_${Date.now()}@example.test`;
    const { user } = await createInactiveUserWithToken(email);

    const initialTokenCount = await db('email_activation_tokens')
      .where({ user_id: user.id })
      .count('id as count')
      .first();

    const fakeErrorRedis = {
      isOpen: true,
      multi() {
        throw new Error('Redis failure: connection refused');
      },
      async incr() {
        throw new Error('Redis failure');
      },
    };

    resendLimiter.setRedisClient(fakeErrorRedis);

    let devMailCount = 0;
    const originalLog = console.log;
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[DEV MAIL]')) {
        devMailCount++;
      }
      originalLog(...args);
    };

    const responses = [];
    try {
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        assert.strictEqual(res.status, 202);
        const body = await res.json();
        responses.push(body);
      }
    } finally {
      resendLimiter.resetRedisClient();
      console.log = originalLog;
    }

    // Cả 6 lần đều nhận 202 với body giống hệt nhau
    assert.strictEqual(responses.length, 6);
    const expectedBody = {
      success: true,
      message: 'Nếu email hợp lệ và chưa kích hoạt, bạn sẽ nhận được hướng dẫn trong hộp thư.',
    };
    for (const body of responses) {
      assert.deepStrictEqual(body, expectedBody);
    }

    // 0 [DEV MAIL]
    assert.strictEqual(devMailCount, 0, 'Không được gửi bất kỳ email nào khi Redis lỗi');

    // 0 token mới
    const finalTokenCount = await db('email_activation_tokens')
      .where({ user_id: user.id })
      .count('id as count')
      .first();
    assert.strictEqual(
      Number(finalTokenCount.count),
      Number(initialTokenCount.count),
      'Không được sinh thêm token mới trong DB khi Redis lỗi'
    );
  });

  test('5b. Redis bình thường: lần 1 đến 5 tạo token và gửi mail; lần 6 thì không', async () => {
    const email = `act_redis_normal_${Date.now()}@example.test`;
    const { user } = await createInactiveUserWithToken(email);

    // Không xoá token ban đầu (giữ nguyên token register)
    const initialTokens = await db('email_activation_tokens').where({ user_id: user.id });
    assert.strictEqual(initialTokens.length, 1, 'Phải có 1 token ban đầu lúc tạo user');

    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    await redisClient.del(`${prefix}resend:${emailHash}`);

    let devMailCount = 0;
    const originalLog = console.log;
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[DEV MAIL]')) {
        devMailCount++;
      }
      originalLog(...args);
    };

    try {
      // Lần 1 đến 5: tạo token và gửi mail
      for (let i = 1; i <= 5; i++) {
        const mailBefore = devMailCount;
        const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        assert.strictEqual(res.status, 202);
        assert.strictEqual(devMailCount, mailBefore + 1, `Lần ${i} phải gửi email`);
      }

      const resendTokensAfter5 = await db('email_activation_tokens')
        .where({ user_id: user.id, purpose: 'resend' })
        .count('id as count')
        .first();
      assert.strictEqual(Number(resendTokensAfter5.count), 5, 'Sau 5 lần phải tạo đúng 5 token resend');

      const allTokensAfter5 = await db('email_activation_tokens')
        .where({ user_id: user.id })
        .count('id as count')
        .first();
      assert.strictEqual(Number(allTokensAfter5.count), 6, 'Tổng số token là 6 (1 register + 5 resend)');

      // Lần 6: KHÔNG tạo token và KHÔNG gửi mail
      const mailBefore6 = devMailCount;
      const res6 = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res6.status, 202);
      assert.strictEqual(devMailCount, mailBefore6, 'Lần 6 không được gửi email');

      const allTokensAfter6 = await db('email_activation_tokens')
        .where({ user_id: user.id })
        .count('id as count')
        .first();
      assert.strictEqual(Number(allTokensAfter6.count), 6, 'Lần 6 không được tạo thêm token');
    } finally {
      console.log = originalLog;
    }
  });

  test('5c. Redis bị xoá key giữa chừng (mô phỏng Redis khởi động lại mất dữ liệu): sau 5 lần, xoá key bộ đếm, gọi lần 6 thì chốt chặn DB vẫn chặn', async () => {
    const email = `act_redis_reset_${Date.now()}@example.test`;
    const { user } = await createInactiveUserWithToken(email);

    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    const rateLimitKey = `${prefix}resend:${emailHash}`;
    await redisClient.del(rateLimitKey);

    // Gửi 5 lần bình thường
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res.status, 202);
    }

    const countAfter5 = await db('email_activation_tokens')
      .where({ user_id: user.id, purpose: 'resend' })
      .count('id as count')
      .first();
    assert.strictEqual(Number(countAfter5.count), 5, 'Phải có 5 token resend');

    // Mô phỏng Redis khởi động lại mất dữ liệu: xoá key bộ đếm
    await redisClient.del(rateLimitKey);
    const keyExists = await redisClient.exists(rateLimitKey);
    assert.strictEqual(keyExists, 0, 'Key Redis đã bị xoá hoàn toàn');

    let devMailCount = 0;
    const originalLog = console.log;
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[DEV MAIL]')) {
        devMailCount++;
      }
      originalLog(...args);
    };

    try {
      // Gọi lần 6: Redis cho qua (bộ đếm = 1) nhưng chốt chặn DB (nguồn sự thật) phải chặn!
      const res6 = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res6.status, 202);
      assert.strictEqual(devMailCount, 0, 'Chốt chặn DB chặn nên không được gửi email');

      const countAfter6 = await db('email_activation_tokens')
        .where({ user_id: user.id, purpose: 'resend' })
        .count('id as count')
        .first();
      assert.strictEqual(
        Number(countAfter6.count),
        5,
        'Chốt chặn DB chặn nên không được sinh thêm token mới'
      );
    } finally {
      console.log = originalLog;
    }
  });

  test('5d. 10 request resend song song cho cùng một email: tổng số token tạo ra trong giờ không vượt quá 5', async () => {
    const email = `act_parallel_${Date.now()}@example.test`;
    const { user } = await createInactiveUserWithToken(email);

    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    await redisClient.del(`${prefix}resend:${emailHash}`);

    // Bắn 10 request resend song song
    const reqs = Array.from({ length: 10 }, () =>
      fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );

    const responses = await Promise.all(reqs);
    for (const res of responses) {
      assert.strictEqual(res.status, 202);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    }

    // Đếm số token resend tạo ra trong giờ
    const countResult = await db('email_activation_tokens')
      .where({ user_id: user.id, purpose: 'resend' })
      .whereRaw("created_at > (now() - interval '1 hour')")
      .count('* as count')
      .first();

    const totalCreated = Number(countResult.count);
    assert.ok(
      totalCreated <= 5,
      `Tổng số token resend tạo ra trong giờ phải <= 5, thực tế là ${totalCreated}`
    );
  });

  test('5f. Luồng thật: POST /api/auth/register -> gửi lại lần 1 đến 5 tạo token và có [DEV MAIL] -> lần 6 bị chặn -> tổng số token = 1 register + 5 resend', async () => {
    const email = `act_real_flow_${Date.now()}@example.test`;
    const password = 'Password@123';
    const fullName = 'Real Flow User';

    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    await redisClient.del(`${prefix}resend:${emailHash}`);

    let devMailCount = 0;
    const originalLog = console.log;
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[DEV MAIL]')) {
        devMailCount++;
      }
      originalLog(...args);
    };

    try {
      // 1. Đăng ký tài khoản qua POST /api/auth/register
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      assert.strictEqual(regRes.status, 202);
      assert.strictEqual(devMailCount, 1, 'Đăng ký phải gửi 1 email kích hoạt');

      const user = await db('users').where({ email }).first();
      assert.ok(user, 'User phải được tạo trong CSDL');

      const initialTokens = await db('email_activation_tokens').where({ user_id: user.id });
      assert.strictEqual(initialTokens.length, 1);
      assert.strictEqual(initialTokens[0].purpose, 'register');

      // 2. Gửi lại lần 1 đến 5: mỗi lần đều tạo token mới và có [DEV MAIL]
      for (let i = 1; i <= 5; i++) {
        const mailBefore = devMailCount;
        const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        assert.strictEqual(res.status, 202);
        assert.strictEqual(devMailCount, mailBefore + 1, `Gửi lại lần ${i} phải gửi email`);
      }

      // 3. Gửi lại lần 6: không có token mới, không có mail, body giống hệt các lần trước
      const mailBefore6 = devMailCount;
      const res6 = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res6.status, 202);
      const body6 = await res6.json();
      assert.deepStrictEqual(body6, {
        success: true,
        message: 'Nếu email hợp lệ và chưa kích hoạt, bạn sẽ nhận được hướng dẫn trong hộp thư.',
      });
      assert.strictEqual(devMailCount, mailBefore6, 'Gửi lại lần 6 không được gửi thêm email');

      // 4. Tổng số token của user = 1 token 'register' + 5 token 'resend'
      const allTokens = await db('email_activation_tokens')
        .where({ user_id: user.id })
        .orderBy('created_at', 'asc');

      assert.strictEqual(allTokens.length, 6, 'Tổng cộng phải có đúng 6 token (1 register + 5 resend)');

      const registerTokens = allTokens.filter((t) => t.purpose === 'register');
      const resendTokens = allTokens.filter((t) => t.purpose === 'resend');
      assert.strictEqual(registerTokens.length, 1, 'Phải có đúng 1 token purpose register');
      assert.strictEqual(resendTokens.length, 5, 'Phải có đúng 5 token purpose resend');
    } finally {
      console.log = originalLog;
    }
  });

  test('5g. Đăng ký rồi gửi lại 5 lần, sau đó token register ban đầu không còn dùng được (đã bị vô hiệu khi gửi lại)', async () => {
    const email = `act_inval_reg_${Date.now()}@example.test`;
    const password = 'Password@123';
    const { user, rawToken: registerToken } = await createInactiveUserWithToken(email, password);

    const prefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex');
    await redisClient.del(`${prefix}resend:${emailHash}`);

    // Gửi lại 5 lần
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res.status, 202);
    }

    // Kiểm tra token register ban đầu đã có used_at chưa
    const originalTokenRow = await db('email_activation_tokens')
      .where({ user_id: user.id, purpose: 'register' })
      .first();
    assert.ok(originalTokenRow.used_at !== null, 'Token register ban đầu phải được đánh dấu used_at');

    // Thử kích hoạt bằng token register ban đầu
    const activateRes = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: registerToken }),
    });

    assert.strictEqual(activateRes.status, 409, 'Token register đã bị vô hiệu nên phải trả 409');
    const activateBody = await activateRes.json();
    assert.strictEqual(activateBody.code, 'TOKEN_USED');
    assert.strictEqual(activateBody.message, 'Liên kết đã được sử dụng.');

    // User vẫn chưa kích hoạt
    const userInDb = await db('users').where({ id: user.id }).first();
    assert.strictEqual(userInDb.is_active, false);
  });

  test('5e. Output log của ca (a) không chứa email', async () => {
    const email = `act_secret_log_${Date.now()}@example.test`;
    await createInactiveUserWithToken(email);

    const fakeErrorRedis = {
      isOpen: true,
      multi() {
        throw new Error('Redis connection down');
      },
      async incr() {
        throw new Error('Redis connection down');
      },
    };

    resendLimiter.setRedisClient(fakeErrorRedis);

    const capturedLogs = [];
    const originalSink = logger.sink;
    logger.sink = (line) => {
      capturedLogs.push(line);
    };

    try {
      const res = await fetch(`${baseUrl}/api/auth/resend-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.strictEqual(res.status, 202);
    } finally {
      resendLimiter.resetRedisClient();
      logger.sink = originalSink;
    }

    assert.ok(capturedLogs.length > 0, 'Phải có log được ghi nhận');
    const combinedLog = capturedLogs.join('\n');
    assert.strictEqual(
      combinedLog.includes(email),
      false,
      'Log khi Redis lỗi tuyệt đối không được chứa email người dùng'
    );

    // Đảm bảo có log sự kiện resend_blocked với reason limiter_unavailable
    const blockedEntry = capturedLogs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return {};
        }
      })
      .find((entry) => entry.event === 'resend_blocked');

    assert.ok(blockedEntry, 'Phải ghi logEvent resend_blocked');
    assert.strictEqual(blockedEntry.reason, 'limiter_unavailable');
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
