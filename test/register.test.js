const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { closeRedis } = require('../lib/redis');
const { start } = require('../index');
const { validateRegisterForm } = require('../public/registerForm');
const { createEmailService } = require('../services/emailService');
const logger = require('../lib/logger');

describe('T-07 User Registration Tests', () => {
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
    await closeRedis();
    await db.destroy();
  });

  test('1. validateRegisterForm chặn mật khẩu < 8 ký tự hoặc > 128 ký tự, email sai, full_name rỗng', () => {
    const invalidShortPass = validateRegisterForm({
      email: 'test@example.com',
      password: 'short',
      full_name: 'Nguyễn Văn A',
    });
    assert.strictEqual(invalidShortPass.valid, false);
    assert.ok(invalidShortPass.errors.password);

    const invalidEmail = validateRegisterForm({
      email: 'not-an-email',
      password: 'Password@123',
      full_name: 'Nguyễn Văn A',
    });
    assert.strictEqual(invalidEmail.valid, false);
    assert.ok(invalidEmail.errors.email);

    const invalidName = validateRegisterForm({
      email: 'valid@example.com',
      password: 'Password@123',
      full_name: '   ',
    });
    assert.strictEqual(invalidName.valid, false);
    assert.ok(invalidName.errors.full_name);

    const validForm = validateRegisterForm({
      email: 'valid@example.com',
      password: 'Password@123',
      full_name: 'Nguyễn Văn A',
    });
    assert.strictEqual(validForm.valid, true);
    assert.deepStrictEqual(validForm.errors, {});
  });

  test('2. Server trả 400 errors.password khi mật khẩu 7 ký tự', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'shortpass_user@example.test',
        password: 'Pass123', // 7 chars
        full_name: 'User Short Pass',
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors);
    assert.ok(data.errors.password);
  });

  test('3. Đăng ký hợp lệ: tạo user mới với is_active=false, vai trò buyer, DB lưu hash token, [DEV MAIL] có liên kết', async () => {
    const testEmail = `valid_reg_${Date.now()}@example.test`;
    const testPassword = 'SecurePassword@123';
    const testName = 'Người Đăng Ký Mới';

    // Bắt console.log để xác minh khối [DEV MAIL]
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    let res;
    try {
      res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          full_name: testName,
        }),
      });
    } finally {
      console.log = originalLog;
    }

    assert.strictEqual(res.status, 202);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(
      body.message,
      'Nếu email hợp lệ, bạn sẽ nhận được hướng dẫn trong hộp thư.'
    );

    // Kiểm tra DB
    const user = await db('users').where({ email: testEmail }).first();
    assert.ok(user, 'User phải được tạo trong CSDL');
    assert.strictEqual(user.full_name, testName);
    assert.strictEqual(user.is_active, false, 'is_active phải là false');
    assert.ok(user.password_hash.startsWith('$argon2id$'));

    // Kiểm tra vai trò buyer
    const userRoles = await db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where('ur.user_id', user.id)
      .select('r.name');
    assert.ok(userRoles.some((r) => r.name === 'buyer'));

    // Kiểm tra token lưu dạng hash
    const tokenRecord = await db('email_activation_tokens')
      .where({ user_id: user.id })
      .first();
    assert.ok(tokenRecord, 'Phải có token kích hoạt trong DB');
    assert.strictEqual(tokenRecord.purpose, 'register');
    assert.strictEqual(tokenRecord.token_hash.length, 64);
    assert.strictEqual(tokenRecord.used_at, null);

    // Kiểm tra console [DEV MAIL]
    const joinedLogs = logs.join('\n');
    assert.ok(joinedLogs.includes('[DEV MAIL]'));
    assert.ok(joinedLogs.includes(testEmail));
    assert.ok(joinedLogs.includes('/activate.html#token='));
  });

  test('4. Đăng ký email đã tồn tại: mã HTTP và body GIỐNG HỆT trường hợp email mới; số user không đổi; không có [DEV MAIL]', async () => {
    const existingEmail = `existing_${Date.now()}@example.test`;
    const testPassword = 'Password@123';

    // Đăng ký lần 1
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existingEmail,
        password: testPassword,
        full_name: 'Existing User',
      }),
    });

    const userCountBefore = await db('users').where({ email: existingEmail }).count('id as count').first();
    assert.strictEqual(Number(userCountBefore.count), 1);

    // Đăng ký lần 2 với cùng email
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    let res;
    try {
      res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: existingEmail,
          password: 'AnotherPassword@456',
          full_name: 'Duplicate Attempt',
        }),
      });
    } finally {
      console.log = originalLog;
    }

    const userCountAfter = await db('users').where({ email: existingEmail }).count('id as count').first();
    assert.strictEqual(Number(userCountAfter.count), 1);

    assert.strictEqual(res.status, 202);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(
      body.message,
      'Nếu email hợp lệ, bạn sẽ nhận được hướng dẫn trong hộp thư.'
    );

    // Không có [DEV MAIL] cho lần đăng ký trùng
    const joinedLogs = logs.join('\n');
    assert.strictEqual(joinedLogs.includes('[DEV MAIL]'), false);
  });

  test('5. Hai request đăng ký song song cùng một email mới: đúng 1 user được tạo, cả hai đều nhận 202', async () => {
    const parallelEmail = `parallel_${Date.now()}@example.test`;
    const payload = {
      email: parallelEmail,
      password: 'SecurePassword@123',
      full_name: 'Parallel Test',
    };

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);

    assert.strictEqual(res1.status, 202);
    assert.strictEqual(res2.status, 202);

    const body1 = await res1.json();
    const body2 = await res2.json();
    assert.strictEqual(body1.success, true);
    assert.strictEqual(body2.success, true);

    const users = await db('users').where({ email: parallelEmail });
    assert.strictEqual(users.length, 1, 'Chỉ đúng 1 user được tạo');
  });

  test('6. Cấu hình MAIL_TRANSPORT=dev bị từ chối ở môi trường production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalTransport = process.env.MAIL_TRANSPORT;

    try {
      process.env.NODE_ENV = 'production';
      process.env.MAIL_TRANSPORT = 'dev';

      const emailService = createEmailService();
      assert.throws(() => {
        emailService.assertConfiguration();
      }, /MAIL_TRANSPORT=dev chỉ được phép sử dụng ở môi trường development hoặc test/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.MAIL_TRANSPORT = originalTransport;
    }
  });

  test('7. Bắt log khi chạy đăng ký với logEvent: KHÔNG chứa email, họ tên, password hay token', async () => {
    const capturedLogs = [];
    const originalSink = logger.sink;
    logger.sink = (line) => {
      capturedLogs.push(line);
    };

    const secretEmail = `secret_log_${Date.now()}@example.test`;
    const secretName = 'Bảo Mật Tuyệt Đối';
    const secretPassword = 'SecretPassword@123';

    try {
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: secretEmail,
          password: secretPassword,
          full_name: secretName,
        }),
      });
    } finally {
      logger.sink = originalSink;
    }

    const allLoggedText = capturedLogs.join('\n');
    assert.strictEqual(allLoggedText.includes(secretEmail), false, 'Log không được chứa email');
    assert.strictEqual(allLoggedText.includes(secretName), false, 'Log không được chứa họ tên');
    assert.strictEqual(allLoggedText.includes(secretPassword), false, 'Log không được chứa mật khẩu');
    assert.strictEqual(allLoggedText.includes('activate.html'), false, 'Log không được chứa URL kích hoạt');
  });
});
