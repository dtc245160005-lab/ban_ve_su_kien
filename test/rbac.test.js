const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const express = require('express');
const argon2 = require('argon2');

const testPrefix = `bvsk-rbac-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;

const createApp = require('../app');
const db = require('../db');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');
const { sha256 } = require('../services/redisAuthStore');
const { parseCookies } = require('../lib/cookies');
const routeRegistry = require('../middleware/routeRegistry');
const { findUnsecuredApiRoutes } = routeRegistry;

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

async function loginAndGetCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const cookie = res.headers.get('set-cookie');
  const body = await res.json();
  return { status: res.status, cookie, body };
}

describe('T-06 Role-Based Access Control (RBAC) & Route Registry Tests', () => {
  const defaultPassword = 'Password123!@#';
  const buyerEmail = `buyer_${process.pid}@example.test`;
  const organizerEmail = `organizer_${process.pid}@example.test`;
  const adminEmail = `admin_${process.pid}@example.test`;
  const multiEmail = `multi_${process.pid}@example.test`;

  let app;
  let server;
  let baseUrl;
  let buyerUser;
  let organizerUser;
  let adminUser;
  let multiUser;

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();
    await cleanTestKeys(redisClient);

    // 1. Đảm bảo 5 roles chuẩn có trong DB
    const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
    for (const name of requiredRoles) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const rolesFromDb = await db('roles').select('id', 'name');
    const roleMap = new Map(rolesFromDb.map((r) => [r.name, r.id]));

    const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

    // 2. Tạo tài khoản Buyer
    [buyerUser] = await db('users')
      .insert({ email: buyerEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: buyerUser.id, role_id: roleMap.get('buyer') });

    // 3. Tạo tài khoản Organizer
    [organizerUser] = await db('users')
      .insert({ email: organizerEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerUser.id, role_id: roleMap.get('organizer') });

    // 4. Tạo tài khoản Admin
    [adminUser] = await db('users')
      .insert({ email: adminEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: adminUser.id, role_id: roleMap.get('admin') });

    // 5. Tạo tài khoản có hai vai trò buyer và organizer
    [multiUser] = await db('users')
      .insert({ email: multiEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert([
      { user_id: multiUser.id, role_id: roleMap.get('buyer') },
      { user_id: multiUser.id, role_id: roleMap.get('organizer') },
    ]);

    // 6. Khởi động HTTP server test
    app = createApp();
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanTestKeys(redisClient);
    await closeRedis();

    // Dọn dẹp users test
    const testEmails = [buyerEmail, organizerEmail, adminEmail, multiEmail];
    const testUsers = await db('users').whereIn('email', testEmails).select('id');
    const userIds = testUsers.map((u) => u.id);
    if (userIds.length > 0) {
      await db('user_roles').whereIn('user_id', userIds).del();
      await db('users').whereIn('id', userIds).del();
    }
    await db.destroy();
  });

  test('1. Người mua gọi POST /api/events bằng HTTP trực tiếp: nhận 403, và có đúng một dòng log forbidden', async () => {
    const loginRes = await loginAndGetCookie(baseUrl, buyerEmail, defaultPassword);
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.cookie);

    const capturedLogs = [];
    const originalWarn = console.warn;
    console.warn = (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'forbidden') {
          capturedLogs.push({ raw: line, parsed });
        }
      } catch {
        // bỏ qua các log không phải JSON
      }
      originalWarn(line);
    };

    try {
      const res = await fetch(`${baseUrl}/api/events?email=a@b.com&token=abc123`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: loginRes.cookie,
        },
        body: JSON.stringify({
          title: 'Sự kiện trái phép của Buyer',
          description: 'Không được phép tạo',
          price: 100000,
          total_tickets: 50,
        }),
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Bạn không có quyền thực hiện thao tác này.');

      // Bắt đúng một dòng log JSON
      assert.strictEqual(capturedLogs.length, 1, 'Phải có đúng một dòng log forbidden');
      const rawLog = capturedLogs[0].raw;
      const logEntry = capturedLogs[0].parsed;
      assert.strictEqual(logEntry.event, 'forbidden');
      assert.strictEqual(logEntry.userId, buyerUser.id);
      assert.strictEqual(logEntry.method, 'POST');
      assert.strictEqual(logEntry.path, '/api/events');
      assert.ok(logEntry.at);
      assert.ok(!Number.isNaN(Date.parse(logEntry.at)));

      // Bảo mật: không chứa email, token trong URL query hoặc trong trường log
      assert.ok(!rawLog.includes('a@b.com'), 'Log không được chứa email query');
      assert.ok(!rawLog.includes('abc123'), 'Log không được chứa token query');
      assert.ok(!rawLog.includes('email='), 'Log không được chứa param email=');
      assert.ok(!rawLog.includes('token='), 'Log không được chứa param token=');
      assert.strictEqual(logEntry.email, undefined);
      assert.strictEqual(logEntry.cookie, undefined);
      assert.strictEqual(logEntry.token, undefined);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('2. Chưa đăng nhập gọi POST /api/events: 401', async () => {
    const res = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Sự kiện không đăng nhập',
        price: 50000,
        total_tickets: 10,
      }),
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  });

  test('3. Organizer gọi POST /api/events: 201. Admin: 201', async () => {
    // Organizer tạo sự kiện
    const orgLogin = await loginAndGetCookie(baseUrl, organizerEmail, defaultPassword);
    assert.strictEqual(orgLogin.status, 200);
    assert.ok(orgLogin.cookie);

    const orgRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: orgLogin.cookie,
      },
      body: JSON.stringify({
        title: 'Đêm nhạc acoustic Organizer',
        description: 'Nhạc trẻ',
        price: 200000,
        total_tickets: 100,
      }),
    });

    assert.strictEqual(orgRes.status, 201);
    const orgBody = await orgRes.json();
    assert.strictEqual(orgBody.success, true);
    assert.strictEqual(orgBody.data.title, 'Đêm nhạc acoustic Organizer');

    // Admin tạo sự kiện
    const adminLogin = await loginAndGetCookie(baseUrl, adminEmail, defaultPassword);
    assert.strictEqual(adminLogin.status, 200);
    assert.ok(adminLogin.cookie);

    const adminRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: adminLogin.cookie,
      },
      body: JSON.stringify({
        title: 'Hội thảo công nghệ Admin',
        description: 'Sự kiện cấp cao',
        price: 350000,
        total_tickets: 200,
      }),
    });

    assert.strictEqual(adminRes.status, 201);
    const adminBody = await adminRes.json();
    assert.strictEqual(adminBody.success, true);
    assert.strictEqual(adminBody.data.title, 'Hội thảo công nghệ Admin');
  });

  test('4. Gọi /api/khong-ton-tai: 403', async () => {
    const res = await fetch(`${baseUrl}/api/khong-ton-tai`);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Truy cập bị từ chối.');

    const resPost = await fetch(`${baseUrl}/api/khong-ton-tai`, { method: 'POST' });
    assert.strictEqual(resPost.status, 403);
    const bodyPost = await resPost.json();
    assert.strictEqual(bodyPost.success, false);
    assert.strictEqual(bodyPost.message, 'Truy cập bị từ chối.');
  });

  test('5. Một test duyệt toàn bộ router của createApp() và FAIL nếu có route /api/* chưa đi qua secure()', async () => {
    // 5.1 App chuẩn: mọi route /api/* đều đã đi qua secure(), danh sách chưa bảo vệ phải rỗng
    const standardApp = createApp();
    const unsecuredRoutes = findUnsecuredApiRoutes(standardApp);
    assert.deepStrictEqual(unsecuredRoutes, [], 'createApp() không được có bất kỳ route /api/* nào chưa qua secure()');

    // 5.2 Kiểm chứng bộ test: nếu cố tình tạo một app có route /api/* chưa qua secure() thì phải FAIL
    const testApp = createApp();
    testApp.get('/api/unsecured-test-route', (req, res) => res.send('unsecured'));
    const testAuthRouter = express.Router();
    testAuthRouter.post('/unsecured-nested', (req, res) => res.send('nested'));
    testApp.use('/api/auth', testAuthRouter);

    const detectedUnsecured = findUnsecuredApiRoutes(testApp);
    assert.ok(detectedUnsecured.length >= 2, 'Phải phát hiện ít nhất 2 route chưa qua secure()');
    const detectedPaths = detectedUnsecured.map((r) => r.path);
    assert.ok(detectedPaths.includes('/api/unsecured-test-route'));
    assert.ok(detectedPaths.includes('/api/auth/unsecured-nested'));
  });

  test('6. User có hai vai trò buyer và organizer: được phép tạo sự kiện', async () => {
    const multiLogin = await loginAndGetCookie(baseUrl, multiEmail, defaultPassword);
    assert.strictEqual(multiLogin.status, 200);
    assert.ok(multiLogin.cookie);

    const userRoles = multiLogin.body.user.roles;
    assert.ok(userRoles.includes('buyer'));
    assert.ok(userRoles.includes('organizer'));

    const res = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: multiLogin.cookie,
      },
      body: JSON.stringify({
        title: 'Sự kiện của tài khoản hai vai trò',
        description: 'Vừa là người mua vừa là ban tổ chức',
        price: 120000,
        total_tickets: 60,
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.title, 'Sự kiện của tài khoản hai vai trò');
  });

  test('7. Phiên đã bị xoá khỏi Redis: 401', async () => {
    const orgLogin = await loginAndGetCookie(baseUrl, organizerEmail, defaultPassword);
    assert.strictEqual(orgLogin.status, 200);
    assert.ok(orgLogin.cookie);

    const cookieName = process.env.SESSION_COOKIE_NAME || 'session_token';
    const cookies = parseCookies(orgLogin.cookie);
    const token = cookies[cookieName];
    assert.ok(token);

    // Xoá trực tiếp phiên khỏi Redis
    const sessionKey = `${testPrefix}session:${sha256(token)}`;
    await redisClient.del(sessionKey);

    // Gửi request với cookie cũ sau khi session đã bị xoá
    const res = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: orgLogin.cookie,
      },
      body: JSON.stringify({
        title: 'Sự kiện sau khi xoá phiên',
        price: 150000,
        total_tickets: 40,
      }),
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  });

  test('8. Thêm test cho mục NÊN SỬA của T-05: start() với Redis chết thì tiến trình con thoát với exit code 1', async () => {
    const exitCode = await new Promise((resolve) => {
      const cp = spawn(process.execPath, ['index.js'], {
        env: {
          ...process.env,
          REDIS_URL: 'redis://127.0.0.1:64999',
          PORT: '0',
        },
        stdio: 'pipe',
      });

      cp.on('exit', (code) => {
        resolve(code);
      });
    });

    assert.strictEqual(exitCode, 1, 'Tiến trình con phải thoát với exit code 1 khi Redis không kết nối được');
  });
});
