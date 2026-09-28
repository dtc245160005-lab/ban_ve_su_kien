const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const createApp = require('../app');
const db = require('../db');
const { getRedis, closeRedis } = require('../lib/redis');

describe('Health Check API (/health)', () => {
  let healthyApp;
  let healthyServer;
  let baseUrl;

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();
    healthyApp = createApp();
    healthyServer = healthyApp.listen(0);
    const port = healthyServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (healthyServer) {
      await new Promise((resolve) => healthyServer.close(resolve));
    }
    await closeRedis();
    await db.destroy();
  });

  test('DB và Redis sống: trả về 200 { status: "ok" }', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.timestamp);
  });

  test('Redis chết: trả về 503, body không chứa thông báo lỗi kỹ thuật', async () => {
    const deadRedisApp = createApp({
      redis: {
        ping: async () => {
          throw new Error('Connection refused to redis://127.0.0.1:6379');
        },
      },
    });

    const s = deadRedisApp.listen(0);
    try {
      const port = s.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(body.status, 'error');
      assert.strictEqual(body.message, 'Dịch vụ tạm thời không khả dụng');
      assert.strictEqual(body.error, undefined);
      assert.strictEqual(JSON.stringify(body).includes('Connection refused'), false);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });

  test('DB chết (db giả có raw() ném lỗi): trả về 503, body không chứa thông báo lỗi kỹ thuật', async () => {
    const deadDbApp = createApp({
      db: {
        raw: async () => {
          throw new Error('PostgreSQL database query failure');
        },
      },
    });

    const s = deadDbApp.listen(0);
    try {
      const port = s.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(body.status, 'error');
      assert.strictEqual(body.message, 'Dịch vụ tạm thời không khả dụng');
      assert.strictEqual(body.error, undefined);
      assert.strictEqual(JSON.stringify(body).includes('PostgreSQL database query failure'), false);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});
