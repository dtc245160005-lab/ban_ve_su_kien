const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const argon2 = require('argon2');

const testPrefix = `bvsk-startup-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;
process.env.TRUST_PROXY = 'false';

const { start } = require('../index');
const createApp = require('../app');
const db = require('../db');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');
const {
  createAuthService,
  emailKey,
  ipKey,
} = require('../services/authService');
const { createRedisAuthStore, sha256 } = require('../services/redisAuthStore');
const { createAuthRouter } = require('../routes/auth');
const { getSafeRedirectUrl } = require('../public/login');

function getRandomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

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

describe('T-05 Startup, Regression & Client-Side Security Tests', () => {
  const startupUserEmail = 'startup_verified_user@example.test';
  const startupPassword = 'Password123!@#';

  before(async () => {
    await getRedis();

    // Đảm bảo role buyer tồn tại
    let buyerRole = await db('roles').where({ name: 'buyer' }).first();
    if (!buyerRole) {
      const [inserted] = await db('roles').insert({ name: 'buyer' }).returning('*');
      buyerRole = inserted;
    }

    // Seed test user
    const passwordHash = await argon2.hash(startupPassword, { type: argon2.argon2id });
    let user = await db('users').where({ email: startupUserEmail }).first();
    if (!user) {
      const [inserted] = await db('users')
        .insert({ email: startupUserEmail, password_hash: passwordHash, is_active: true })
        .returning('*');
      user = inserted;
    }
    await db('user_roles')
      .insert({ user_id: user.id, role_id: buyerRole.id })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  });

  after(async () => {
    await cleanTestKeys(redisClient);
    await closeRedis();
    await db.destroy();
  });

  beforeEach(async () => {
    await cleanTestKeys(redisClient);
  });

  test('1. Khởi động nguội cô lập: child_process.spawn gọi node index.js với PORT ngẫu nhiên, bắn 20 POST /api/auth/login song song không nhận 500', async () => {
    const childPort = await getRandomPort();
    const childPrefix = `${testPrefix}cold:${childPort}:`;

    // Khởi chạy tiến trình con mới độc lập hoàn toàn, không dùng client đã kết nối sẵn
    const child = spawn(process.execPath, [path.resolve(__dirname, '../index.js')], {
      env: {
        ...process.env,
        PORT: String(childPort),
        REDIS_KEY_PREFIX: childPrefix,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      // Chờ tiến trình con in dòng "Server API đang chạy" hoặc thăm dò /health trả về 200
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Hết thời gian chờ tiến trình con khởi động (10s)'));
        }, 10000);

        let resolved = false;
        const markReady = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve();
          }
        };

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('Server API đang chạy') || text.includes('listening')) {
            markReady();
          }
        });

        child.stderr.on('data', () => {});

        child.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        child.once('exit', (code) => {
          if (!resolved) {
            clearTimeout(timeout);
            reject(new Error(`Tiến trình con thoát sớm với mã: ${code}`));
          }
        });

        // Thăm dò /health dự phòng
        const interval = setInterval(async () => {
          if (resolved) {
            clearInterval(interval);
            return;
          }
          try {
            const res = await fetch(`http://127.0.0.1:${childPort}/health`);
            if (res.status === 200) {
              clearInterval(interval);
              markReady();
            }
          } catch {
            // Chưa sẵn sàng
          }
        }, 50);
      });

      // Bắn ngay 20 POST /api/auth/login song song
      const requests = Array.from({ length: 20 }, (_, i) =>
        fetch(`http://127.0.0.1:${childPort}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `cold_startup_${i}@example.test`,
            password: 'WrongPassword!',
          }),
        })
      );

      const responses = await Promise.all(requests);
      assert.strictEqual(responses.length, 20);
      for (const res of responses) {
        assert.notStrictEqual(res.status, 500, `Không request nào được phép trả về 500 (nhận ${res.status})`);
        assert.ok(
          res.status === 401 || res.status === 429,
          `Phải trả về 401 hoặc 429, nhận ${res.status}`
        );
      }
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
  });

  test('2. start() với REDIS_URL sai (ví dụ redis://127.0.0.1:1) phải reject và KHÔNG mở cổng', async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    let serverStarted = null;
    try {
      process.env.REDIS_URL = 'redis://127.0.0.1:1';
      await assert.rejects(
        async () => {
          serverStarted = await start({ port: 0 });
        },
        /Redis connection failed/
      );
      assert.strictEqual(serverStarted, null, 'Server không được mở khi Redis lỗi');
    } finally {
      if (serverStarted) {
        await new Promise((r) => serverStarted.close(r));
      }
      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalRedisUrl;
      }
      await closeRedis();
    }
  });

  test('3. Test hết hạn phiên (xoá key Redis hoặc TTL hết hạn) -> GET /api/auth/session trả 401', async () => {
    const server = await start({ port: 0 });
    const port = server.address().port;
    try {
      // Đăng nhập thành công để nhận cookie session
      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: startupUserEmail,
          password: startupPassword,
        }),
      });

      assert.strictEqual(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie, 'Phải có header set-cookie');
      const tokenMatch = setCookie.match(/session_token=([^;]+)/);
      assert.ok(tokenMatch);
      const token = tokenMatch[1];
      const cookieHeader = `session_token=${token}`;

      // Xác minh phiên ban đầu hợp lệ
      const validSessionRes = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
        headers: { Cookie: cookieHeader },
      });
      assert.strictEqual(validSessionRes.status, 200);

      // Xoá key phiên trong Redis để mô phỏng hết hạn
      const hashedKey = `${testPrefix}session:${sha256(token)}`;
      await redisClient.del(hashedKey);

      // Kiểm tra lại phiên: phải trả 401
      const expiredSessionRes = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
        headers: { Cookie: cookieHeader },
      });
      assert.strictEqual(expiredSessionRes.status, 401);
      const expiredBody = await expiredSessionRes.json();
      assert.strictEqual(expiredBody.success, false);
      assert.strictEqual(expiredBody.message, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('4. Test lỗi repository ở tầng DB trả 500 nhưng KHÔNG tăng đếm thất bại (cả email LẪN IP đều không tồn tại trong Redis)', async () => {
    const failingDbEmail = 'db_error_check@example.test';
    const store = createRedisAuthStore(redisClient, { prefix: testPrefix });

    const failingRepo = {
      async findByEmail() {
        throw new Error('PostgreSQL database query failure');
      },
    };

    const failingService = createAuthService({
      userRepository: failingRepo,
      attemptStore: store.attemptStore,
      sessionStore: store.sessionStore,
    });

    const testApp = createApp({
      authRouter: createAuthRouter({
        authService: failingService,
        authStore: store,
      }),
    });

    const s = testApp.listen(0);
    try {
      const port = s.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.195',
        },
        body: JSON.stringify({
          email: failingDbEmail,
          password: 'Password123!',
        }),
      });

      assert.strictEqual(res.status, 500, 'Lỗi DB phải trả về HTTP 500');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Hệ thống đang bận. Vui lòng thử lại sau.');

      // 1. Assert key bộ đếm theo email KHÔNG tồn tại trong Redis
      const eKey = emailKey(failingDbEmail);
      const emailCount = await redisClient.get(`${testPrefix}auth:failed:${eKey}`);
      assert.strictEqual(emailCount, null, 'Key bộ đếm thất bại theo email không được tồn tại trong Redis');

      // 2. Assert key bộ đếm theo IP KHÔNG tồn tại trong Redis (kể cả client IP kết nối lẫn IP trong header)
      const ip4Key = ipKey('127.0.0.1');
      const ip6Key = ipKey('::1');
      const ipV4MappedKey = ipKey('::ffff:127.0.0.1');
      const headerIpKey = ipKey('203.0.113.195');

      assert.strictEqual(await redisClient.get(`${testPrefix}auth:failed:${ip4Key}`), null, 'Key bộ đếm thất bại theo IPv4 không tồn tại');
      assert.strictEqual(await redisClient.get(`${testPrefix}auth:failed:${ip6Key}`), null, 'Key bộ đếm thất bại theo IPv6 không tồn tại');
      assert.strictEqual(await redisClient.get(`${testPrefix}auth:failed:${ipV4MappedKey}`), null, 'Key bộ đếm thất bại theo IPv4-mapped không tồn tại');
      assert.strictEqual(await redisClient.get(`${testPrefix}auth:failed:${headerIpKey}`), null, 'Key bộ đếm thất bại theo header IP không tồn tại');

      // 3. Quét tổng thể toàn bộ prefix xem có bất kỳ key auth:failed nào không
      const replyFailed = await redisClient.scan(0, { MATCH: `${testPrefix}auth:failed:*`, COUNT: 100 });
      assert.strictEqual(replyFailed.keys.length, 0, 'Cả bộ đếm theo email và IP đều không có bất kỳ key auth:failed nào trong Redis');

      const lockSeconds = await store.attemptStore.getRemainingLockSeconds(eKey);
      assert.strictEqual(lockSeconds, 0, 'Tài khoản không được bị khoá');
    } finally {
      await new Promise((r) => s.close(r));
    }
  });

  test('5. Bảo mật chuyển hướng an toàn: hàm getSafeRedirectUrl chống open redirect', () => {
    // Trường hợp an toàn (bắt đầu bằng single / và không bắt đầu bằng //)
    assert.strictEqual(getSafeRedirectUrl('/app.html'), '/app.html');

    // Giả lập môi trường URLSearchParams
    const originalWindow = global.window;
    try {
      global.window = {
        location: {
          search: '?next=/events/123?tab=tickets',
        },
      };
      assert.strictEqual(getSafeRedirectUrl(), '/events/123?tab=tickets');

      // Tấn công Open Redirect qua protocol-relative URL: //evil.com
      global.window.location.search = '?next=//evil.com';
      assert.strictEqual(getSafeRedirectUrl(), '/app.html');

      // Tấn công Open Redirect qua absolute URL: https://attacker.com
      global.window.location.search = '?next=https://attacker.com';
      assert.strictEqual(getSafeRedirectUrl(), '/app.html');

      // Tấn công Open Redirect qua backslash: /\evil.com
      global.window.location.search = '?next=/\\evil.com';
      assert.strictEqual(getSafeRedirectUrl(), '/app.html');

      // Không truyền tham số next
      global.window.location.search = '';
      assert.strictEqual(getSafeRedirectUrl(), '/app.html');
    } finally {
      global.window = originalWindow;
    }
  });
});
