const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const argon2 = require('argon2');
const app = require('../index');
const db = require('../db');
const redisClient = require('../lib/redis');
const { createAuthService, GENERIC_LOGIN_ERROR, LOCKED_LOGIN_ERROR } = require('../services/authService');
const { createRedisAuthStore } = require('../services/redisAuthStore');
const { createUserRepository } = require('../services/userRepository');

describe('T-05 Authentication Service & Endpoints', () => {
  let server;
  let baseUrl;

  const testPassword = 'SecurePassword@123';
  const activeUserEmail = 'active_test_user@example.test';
  const inactiveUserEmail = 'inactive_test_user@example.test';
  const bruteForceUserEmail = 'brute_force_user@example.test';

  before(async () => {
    // 1. Connect Redis
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    // 2. Start HTTP server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // 3. Ensure roles exist
    const buyerRole = await db('roles').where({ name: 'buyer' }).first();
    let roleId = buyerRole?.id;
    if (!roleId) {
      const [newRole] = await db('roles').insert({ name: 'buyer' }).returning('id');
      roleId = typeof newRole === 'object' ? newRole.id : newRole;
    }

    // 4. Hash password with argon2id
    const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });

    // 5. Seed test active user
    let activeUser = await db('users').where({ email: activeUserEmail }).first();
    if (!activeUser) {
      const [inserted] = await db('users')
        .insert({
          email: activeUserEmail,
          password_hash: passwordHash,
          is_active: true,
        })
        .returning('*');
      activeUser = inserted;
    } else {
      await db('users').where({ id: activeUser.id }).update({
        password_hash: passwordHash,
        is_active: true,
      });
    }

    await db('user_roles')
      .insert({ user_id: activeUser.id, role_id: roleId })
      .onConflict(['user_id', 'role_id'])
      .ignore();

    // 6. Seed test inactive user
    let inactiveUser = await db('users').where({ email: inactiveUserEmail }).first();
    if (!inactiveUser) {
      const [inserted] = await db('users')
        .insert({
          email: inactiveUserEmail,
          password_hash: passwordHash,
          is_active: false,
        })
        .returning('*');
      inactiveUser = inserted;
    } else {
      await db('users').where({ id: inactiveUser.id }).update({
        password_hash: passwordHash,
        is_active: false,
      });
    }

    await db('user_roles')
      .insert({ user_id: inactiveUser.id, role_id: roleId })
      .onConflict(['user_id', 'role_id'])
      .ignore();

    // 7. Seed brute force test user
    let bruteUser = await db('users').where({ email: bruteForceUserEmail }).first();
    if (!bruteUser) {
      const [inserted] = await db('users')
        .insert({
          email: bruteForceUserEmail,
          password_hash: passwordHash,
          is_active: true,
        })
        .returning('*');
      bruteUser = inserted;
    } else {
      await db('users').where({ id: bruteUser.id }).update({
        password_hash: passwordHash,
        is_active: true,
      });
    }

    await db('user_roles')
      .insert({ user_id: bruteUser.id, role_id: roleId })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up test keys from redis
    if (redisClient.isOpen) {
      await redisClient.flushAll();
      await redisClient.quit();
    }
    await db.destroy();
  });

  beforeEach(async () => {
    // Flush redis before each test to maintain clean test state
    if (redisClient.isOpen) {
      await redisClient.flushAll();
    }
  });

  test('1. Đăng nhập đúng: trả về 200 và cookie phiên HttpOnly', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.email, activeUserEmail);
    assert.strictEqual(body.user.role, 'buyer');
    assert.strictEqual(body.redirectTo, '/app.html');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Header set-cookie phải tồn tại');
    assert.match(setCookie, /session_token=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  });

  test('2. Sai email và sai mật khẩu nhận cùng một thông báo lỗi', async () => {
    const resMissingEmail = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent_account@example.test',
        password: 'SomeRandomPassword999!',
      }),
    });

    const resWrongPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeUserEmail,
        password: 'IncorrectPassword999!',
      }),
    });

    assert.strictEqual(resMissingEmail.status, 401);
    assert.strictEqual(resWrongPassword.status, 401);

    const bodyMissing = await resMissingEmail.json();
    const bodyWrong = await resWrongPassword.json();

    assert.strictEqual(bodyMissing.success, false);
    assert.strictEqual(bodyWrong.success, false);
    assert.strictEqual(bodyMissing.message, GENERIC_LOGIN_ERROR);
    assert.strictEqual(bodyWrong.message, GENERIC_LOGIN_ERROR);
  });

  test('3. Sai 5 lần thì lần thứ 6 nhận 429 có retryAfterSeconds', async () => {
    const clientIp = '192.168.10.10';

    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIp,
        },
        body: JSON.stringify({
          email: bruteForceUserEmail,
          password: `WrongPassword_${i}`,
        }),
      });
      assert.strictEqual(res.status, 401, `Lần thử ${i} phải trả 401`);
    }

    // Lần thứ 6 phải nhận 429
    const sixthRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
      },
      body: JSON.stringify({
        email: bruteForceUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(sixthRes.status, 429);
    const body = await sixthRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, LOCKED_LOGIN_ERROR);
    assert.ok(typeof body.retryAfterSeconds === 'number', 'retryAfterSeconds phải là số');
    assert.ok(body.retryAfterSeconds > 0 && body.retryAfterSeconds <= 900);

    const retryAfterHeader = sixthRes.headers.get('retry-after');
    assert.ok(retryAfterHeader, 'Header Retry-After phải tồn tại');
  });

  test('4. Khởi động lại service (tạo instance mới) vẫn còn khoá trong Redis', async () => {
    // Khóa tài khoản qua 5 lần thử thất bại
    for (let i = 1; i <= 5; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: bruteForceUserEmail,
          password: `WrongPassword_${i}`,
        }),
      });
    }

    // Tạo một instance mới hoàn toàn của authService kết nối tới cùng Redis
    const newStore = createRedisAuthStore(redisClient);
    const freshAuthService = createAuthService({
      userRepository: createUserRepository(db),
      attemptStore: newStore.attemptStore,
      sessionStore: newStore.sessionStore,
    });

    // Thử đăng nhập trên instance mới
    const result = await freshAuthService.login({
      email: bruteForceUserEmail,
      password: testPassword,
    });

    assert.strictEqual(result.status, 429, 'Instance mới phải giữ trạng thái khóa từ Redis');
    assert.strictEqual(result.body.success, false);
    assert.strictEqual(result.body.message, LOCKED_LOGIN_ERROR);
    assert.ok(result.body.retryAfterSeconds > 0);
  });

  test('5. Tài khoản chưa kích hoạt (is_active = false) không đăng nhập được', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inactiveUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, GENERIC_LOGIN_ERROR);
    assert.strictEqual(res.headers.get('set-cookie'), null);
  });

  test('6. Đăng xuất xong thì /api/auth/session trả 401', async () => {
    // 1. Đăng nhập để lấy cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader);

    // Lấy chuỗi cookie token để gửi ở các request tiếp theo
    const cookieToken = cookieHeader.split(';')[0];

    // 2. Kiểm tra session trả về 200 khi có cookie hợp lệ
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(sessionRes.status, 200);
    const sessionBody = await sessionRes.json();
    assert.strictEqual(sessionBody.success, true);
    assert.strictEqual(sessionBody.user.email, activeUserEmail);

    // 3. Gọi đăng xuất
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(logoutRes.status, 200);

    // 4. Gọi lại session với cookie cũ phải nhận 401
    const sessionAfterLogout = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(sessionAfterLogout.status, 401);
    const afterLogoutBody = await sessionAfterLogout.json();
    assert.strictEqual(afterLogoutBody.success, false);
  });

  test('7. Khoá theo IP khi vượt ngưỡng 20 lần sai từ cùng một IP', async () => {
    const attackerIp = '203.0.113.199';

    // 20 lần thử sai từ cùng IP nhưng khác email
    for (let i = 1; i <= 20; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': attackerIp,
        },
        body: JSON.stringify({
          email: `attacker_target_${i}@example.test`,
          password: 'WrongPassword!',
        }),
      });
      assert.strictEqual(res.status, 401);
    }

    // Lần thứ 21 với email hoàn toàn mới từ IP đó phải bị 429
    const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': attackerIp,
      },
      body: JSON.stringify({
        email: 'brand_new_user@example.test',
        password: 'Password123!',
      }),
    });

    assert.strictEqual(blockedRes.status, 429);
    const body = await blockedRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, LOCKED_LOGIN_ERROR);
    assert.ok(body.retryAfterSeconds > 0);
  });
});
