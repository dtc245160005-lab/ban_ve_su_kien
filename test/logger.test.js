const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { logEvent, sanitizePath } = require('../lib/logger');

describe('Logger Sanitization & Event Logging (lib/logger.js)', () => {
  test('sanitizePath: loại bỏ query string và hash fragment', () => {
    assert.strictEqual(sanitizePath('/api/events?email=a@b.com&token=secret'), '/api/events');
    assert.strictEqual(sanitizePath('/api/users#profile'), '/api/users');
    assert.strictEqual(sanitizePath('/health'), '/health');
    assert.strictEqual(sanitizePath(null), '');
    assert.strictEqual(sanitizePath(undefined), '');
  });

  test('logEvent: chỉ ghi các trường cho phép và tự bỏ trường nhạy cảm (email, password, token, cookie, authorization)', () => {
    const captured = [];
    const originalWarn = console.warn;
    console.warn = (msg) => {
      captured.push(JSON.parse(msg));
    };

    try {
      const payload = logEvent('test_event', {
        userId: 42,
        method: 'post',
        path: '/api/events?email=user@test.com&token=xyz',
        status: 403,
        count: 17,
        at: '2026-09-28T12:00:00.000Z',
        // Các trường nhạy cảm cần bị loại bỏ:
        email: 'user@test.com',
        user_email: 'user@test.com',
        password: 'password123',
        password_hash: 'hash...',
        token: 'secret-token',
        session_token: 'secret-session',
        cookie: 'session_token=123',
        authorization: 'Bearer 123',
        extra_arbitrary_field: 'ignored',
      });

      assert.strictEqual(captured.length, 1);
      const entry = captured[0];

      // Chỉ có các trường trong allowed list
      assert.strictEqual(entry.event, 'test_event');
      assert.strictEqual(entry.userId, 42);
      assert.strictEqual(entry.method, 'POST');
      assert.strictEqual(entry.path, '/api/events');
      assert.strictEqual(entry.status, 403);
      assert.strictEqual(entry.count, 17);
      assert.strictEqual(entry.at, '2026-09-28T12:00:00.000Z');

      // Đảm bảo không có trường nhạy cảm nào lọt vào
      assert.strictEqual(entry.email, undefined);
      assert.strictEqual(entry.user_email, undefined);
      assert.strictEqual(entry.password, undefined);
      assert.strictEqual(entry.password_hash, undefined);
      assert.strictEqual(entry.token, undefined);
      assert.strictEqual(entry.session_token, undefined);
      assert.strictEqual(entry.cookie, undefined);
      assert.strictEqual(entry.authorization, undefined);
      assert.strictEqual(entry.extra_arbitrary_field, undefined);

      assert.deepStrictEqual(payload, entry);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('logEvent: tự trích xuất path từ req nếu được truyền vào', () => {
    const captured = [];
    const originalWarn = console.warn;
    console.warn = (msg) => {
      captured.push(JSON.parse(msg));
    };

    try {
      const mockReq = {
        baseUrl: '/api',
        path: '/events',
        url: '/events?token=123',
        originalUrl: '/api/events?token=123',
      };

      logEvent('forbidden', {
        userId: 10,
        method: 'POST',
        req: mockReq,
      });

      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].path, '/api/events');
      assert.strictEqual(captured[0].event, 'forbidden');
      assert.strictEqual(captured[0].userId, 10);
    } finally {
      console.warn = originalWarn;
    }
  });
});
