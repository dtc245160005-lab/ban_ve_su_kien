const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const argon2 = require('argon2');

// Đặt tiền tố Redis riêng biệt cho tiến trình test theo yêu cầu (bvsk-test:<pid>:)
const testPrefix = `bvsk-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;
process.env.TRUST_PROXY = 'false';

const { start } = require('../index');
const db = require('../db');
const { redisClient } = require('../lib/redis');
const {
  createAuthService,
  GENERIC_LOGIN_ERROR,
  LOCKED_LOGIN_ERROR,
  emailKey,
} = require('../services/authService');
const { createRedisAuthStore, sha256 } = require('../services/redisAuthStore');
const { createUserRepository } = require('../services/userRepository');
const { createAuthRouter } = require('../routes/auth');

async function cleanTestKeys(client) {
  if (!client || !client.isOpen) return;
  let cursor = 0;
  do {
    const reply = await client.scan(cursor, {
      MATCH: `${testPrefix}*`,
      COUNT: 100,
    });
    cursor = reply.cursor;
    if (reply.keys.length > 0) {
      await client.del(reply.keys);
    }
  } while (cursor !== 0);
}

describe('T-05 Authentication Hardening & Endpoints', () => {
  let server;
  let baseUrl;

  const testPassword = 'SecurePassword@123';
  const activeUserEmail = 'active_test_user@example.test';
  const multiRoleUserEmail = 'multi_role_user@example.test';
  const inactiveUserEmail = 'inactive_test_user@example.test';
  const bruteForceUserEmail = 'brute_force_user@example.test';

  before(async () => {
    // 1. Khởi động server thông qua start({ port: 0 })
    server = await start({ port: 0 });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // 3. Đảm bảo các roles tồn tại
    const rolesToEnsure = ['buyer', 'organizer', 'admin'];
    const roleMap = new Map();
    for (const name of rolesToEnsure) {
      let r = await db('roles').where({ name }).first();
      if (!r) {
        const [inserted] = await db('roles').insert({ name }).returning('*');
        r = inserted;
      }
      roleMap.set(name, r.id);
    }

    const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });

    // 4. Seed user với 1 vai trò (buyer)
    let activeUser = await db('users').where({ email: activeUserEmail }).first();
    if (!activeUser) {
      const [inserted] = await db('users')
        .insert({ email: activeUserEmail, password_hash: passwordHash, is_active: true })
        .returning('*');
      activeUser = inserted;
    }
    await db('user_roles')
      .insert({ user_id: activeUser.id, role_id: roleMap.get('buyer') })
      .onConflict(['user_id', 'role_id'])
      .ignore();

    // 5. Seed user với 2 vai trò (buyer & organizer)
    let multiUser = await db('users').where({ email: multiRoleUserEmail }).first();
    if (!multiUser) {
      const [inserted] = await db('users')
        .insert({ email: multiRoleUserEmail, password_hash: passwordHash, is_active: true })
        .returning('*');
      multiUser = inserted;
    }
    await db('user_roles')
      .insert({ user_id: multiUser.id, role_id: roleMap.get('buyer') })
      .onConflict(['user_id', 'role_id'])
      .ignore();
    await db('user_roles')
      .insert({ user_id: multiUser.id, role_id: roleMap.get('organizer') })
      .onConflict(['user_id', 'role_id'])
      .ignore();

    // 6. Seed user chưa kích hoạt (is_active = false)
    let inactiveUser = await db('users').where({ email: inactiveUserEmail }).first();
    if (!inactiveUser) {
      const [inserted] = await db('users')
        .insert({ email: inactiveUserEmail, password_hash: passwordHash, is_active: false })
        .returning('*');
      inactiveUser = inserted;
    }
    await db('user_roles')
      .insert({ user_id: inactiveUser.id, role_id: roleMap.get('buyer') })
      .onConflict(['user_id', 'role_id'])
      .ignore();

    // 7. Seed brute force user
    let bruteUser = await db('users').where({ email: bruteForceUserEmail }).first();
    if (!bruteUser) {
      const [inserted] = await db('users')
        .insert({ email: bruteForceUserEmail, password_hash: passwordHash, is_active: true })
        .returning('*');
      bruteUser = inserted;
    }
    await db('user_roles')
      .insert({ user_id: bruteUser.id, role_id: roleMap.get('buyer') })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Dọn dẹp key có tiền tố test, không dùng flushAll/flushDb
    await cleanTestKeys(redisClient);
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    await db.destroy();
  });

  beforeEach(async () => {
    // Dọn dẹp key của test hiện tại trước mỗi ca kiểm thử bằng SCAN + DEL
    await cleanTestKeys(redisClient);
  });

  test('1. Đăng nhập đúng: trả về 200, user.roles là mảng, session lưu { userId, roles } bằng sha256 token', async () => {
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
    assert.deepStrictEqual(body.user.roles, ['buyer']);
    assert.strictEqual(body.redirectTo, '/app.html');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Header set-cookie phải tồn tại');
    assert.match(setCookie, /session_token=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    // Kiểm tra token lưu trong Redis theo key sha256(token)
    const tokenMatch = setCookie.match(/session_token=([^;]+)/);
    assert.ok(tokenMatch);
    const rawToken = tokenMatch[1];
    const hashedKey = `${testPrefix}session:${sha256(rawToken)}`;
    const storedSessionRaw = await redisClient.get(hashedKey);
    assert.ok(storedSessionRaw, 'Phiên phải lưu trong Redis dưới key hash sha256');
    const storedSession = JSON.parse(storedSessionRaw);
    assert.strictEqual(typeof storedSession.userId, 'number');
    assert.deepStrictEqual(storedSession.roles, ['buyer']);
  });

  test('2. User có 2 vai trò thì nhận đủ 2 vai trò trong phản hồi và phiên Redis', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: multiRoleUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.user.roles), 'user.roles phải là mảng');
    assert.strictEqual(body.user.roles.length, 2);
    assert.ok(body.user.roles.includes('buyer'));
    assert.ok(body.user.roles.includes('organizer'));

    const setCookie = res.headers.get('set-cookie');
    const tokenMatch = setCookie.match(/session_token=([^;]+)/);
    const rawToken = tokenMatch[1];
    const storedSessionRaw = await redisClient.get(`${testPrefix}session:${sha256(rawToken)}`);
    const storedSession = JSON.parse(storedSessionRaw);
    assert.strictEqual(storedSession.roles.length, 2);
    assert.ok(storedSession.roles.includes('buyer'));
    assert.ok(storedSession.roles.includes('organizer'));
  });

  test('3. Sai email và sai mật khẩu nhận cùng một thông báo lỗi', async () => {
    const resMissing = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not_exist@example.test',
        password: 'Password999!',
      }),
    });

    const resWrong = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeUserEmail,
        password: 'WrongPassword999!',
      }),
    });

    assert.strictEqual(resMissing.status, 401);
    assert.strictEqual(resWrong.status, 401);

    const bodyMissing = await resMissing.json();
    const bodyWrong = await resWrong.json();

    assert.strictEqual(bodyMissing.message, GENERIC_LOGIN_ERROR);
    assert.strictEqual(bodyWrong.message, GENERIC_LOGIN_ERROR);
  });

  test('4. Sai 5 lần thì lần thứ 6 nhận 429 có retryAfterSeconds và header Retry-After', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: bruteForceUserEmail,
          password: `Wrong_${i}`,
        }),
      });
      assert.strictEqual(res.status, 401);
    }

    const sixthRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: bruteForceUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(sixthRes.status, 429);
    const body = await sixthRes.json();
    assert.strictEqual(body.message, LOCKED_LOGIN_ERROR);
    assert.ok(typeof body.retryAfterSeconds === 'number');
    assert.ok(body.retryAfterSeconds > 0 && body.retryAfterSeconds <= 900);
    assert.ok(sixthRes.headers.get('retry-after'));
  });

  test('5. Khởi động lại service (tạo instance mới) vẫn còn khoá trong Redis', async () => {
    for (let i = 1; i <= 5; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: bruteForceUserEmail,
          password: `Wrong_${i}`,
        }),
      });
    }

    const newStore = createRedisAuthStore(redisClient, { prefix: testPrefix });
    const freshAuthService = createAuthService({
      userRepository: createUserRepository(db),
      attemptStore: newStore.attemptStore,
      sessionStore: newStore.sessionStore,
    });

    const result = await freshAuthService.login({
      email: bruteForceUserEmail,
      password: testPassword,
    });

    assert.strictEqual(result.status, 429);
    assert.strictEqual(result.body.message, LOCKED_LOGIN_ERROR);
    assert.ok(result.body.retryAfterSeconds > 0);
  });

  test('6. Tài khoản chưa kích hoạt (is_active = false) nhận 403 ACCOUNT_NOT_ACTIVE khi mật khẩu đúng', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inactiveUserEmail,
        password: testPassword,
      }),
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'ACCOUNT_NOT_ACTIVE');
    assert.ok(body.message.includes('chưa được kích hoạt'));
    assert.strictEqual(res.headers.get('set-cookie'), null);
  });

  test('7. Đăng xuất xong thì /api/auth/session trả 401', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeUserEmail,
        password: testPassword,
      }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie');
    const cookieToken = cookieHeader.split(';')[0];

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(sessionRes.status, 200);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(logoutRes.status, 200);

    const sessionAfter = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieToken },
    });
    assert.strictEqual(sessionAfter.status, 401);
  });

  test('8. Khoá theo IP: gọi authService.login({ ..., ip }) trực tiếp ở tầng service', async () => {
    const store = createRedisAuthStore(redisClient, { prefix: testPrefix });
    const service = createAuthService({
      userRepository: createUserRepository(db),
      attemptStore: store.attemptStore,
      sessionStore: store.sessionStore,
    });

    const targetIp = '198.51.100.88';

    // 20 lần thử sai từ cùng IP nhưng khác email
    for (let i = 1; i <= 20; i++) {
      const res = await service.login({
        email: `service_attacker_${i}@example.test`,
        password: 'WrongPassword!',
        ip: targetIp,
      });
      assert.strictEqual(res.status, 401);
    }

    // Lần thứ 21 với email mới từ targetIp phải bị 429
    const blockedRes = await service.login({
      email: 'fresh_user_from_ip@example.test',
      password: testPassword,
      ip: targetIp,
    });

    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.body.message, LOCKED_LOGIN_ERROR);
    assert.ok(blockedRes.body.retryAfterSeconds > 0);
  });

  test('9. Gửi X-Forwarded-For giả KHÔNG vượt được khoá khi TRUST_PROXY=false', async () => {
    // Khi app có TRUST_PROXY=false (đã set ở đầu test), req.ip sẽ luôn là địa chỉ socket (127.0.0.1)
    // Mô phỏng 20 request sai gửi kèm các header X-Forwarded-For ngẫu nhiên khác nhau
    for (let i = 1; i <= 20; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `203.0.113.${i}`, // Fake IP header
        },
        body: JSON.stringify({
          email: `spoof_target_${i}@example.test`,
          password: 'WrongPassword!',
        }),
      });
      assert.strictEqual(res.status, 401);
    }

    // Lần thứ 21 gửi với một IP giả mạo hoàn toàn mới nhằm vượt khoá
    const spoofRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.99', // Cố tình đổi fake header
      },
      body: JSON.stringify({
        email: 'another_user@example.test',
        password: testPassword,
      }),
    });

    // Vì TRUST_PROXY=false, Express dùng req.ip (127.0.0.1), header giả bị bỏ qua và request bị khoá
    assert.strictEqual(spoofRes.status, 429, 'X-Forwarded-For giả không được phép qua mặt khoá IP khi TRUST_PROXY=false');
    const body = await spoofRes.json();
    assert.strictEqual(body.message, LOCKED_LOGIN_ERROR);
  });

  test('10. Lỗi DB: nếu findByEmail ném lỗi thì nhận 500 và KHÔNG ghi nhận lần sai vào bộ đếm Redis', async () => {
    const failingDbEmail = 'db_fail_user@example.test';
    const store = createRedisAuthStore(redisClient, { prefix: testPrefix });

    // Mock repository ném lỗi cơ sở dữ liệu
    const failingRepo = {
      async findByEmail() {
        throw new Error('Database connection lost unexpectedly');
      },
    };

    const failingService = createAuthService({
      userRepository: failingRepo,
      attemptStore: store.attemptStore,
      sessionStore: store.sessionStore,
    });

    // Tạo router với failingService để test qua tầng HTTP endpoint
    const express = require('express');
    const testApp = express();
    testApp.use(express.json());
    testApp.use(
      '/api/auth',
      createAuthRouter({
        authService: failingService,
        authStore: store,
      }),
    );

    const testServer = http.createServer(testApp);
    await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
    const testPort = testServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: failingDbEmail,
          password: 'AnyPassword123!',
        }),
      });

      assert.strictEqual(res.status, 500, 'Lỗi DB phải trả về HTTP 500');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Hệ thống đang bận. Vui lòng thử lại sau.');

      // Kiểm tra bộ đếm thất bại trong Redis: KHÔNG được tăng
      const eKey = emailKey(failingDbEmail);
      const failedKey = `${testPrefix}auth:failed:${eKey}`;
      const failCount = await redisClient.get(failedKey);
      assert.strictEqual(failCount, null, 'Bộ đếm thất bại trong Redis KHÔNG được phép ghi nhận khi lỗi DB');

      const lockSeconds = await store.attemptStore.getRemainingLockSeconds(eKey);
      assert.strictEqual(lockSeconds, 0, 'Tài khoản không được bị khóa khi xảy ra lỗi DB');
    } finally {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });
});
