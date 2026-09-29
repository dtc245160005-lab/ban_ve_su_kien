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
    healthyApp = createApp({ revision: 'a'.repeat(40) });
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
    assert.equal(body.revision, 'a'.repeat(40));
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

  test('Health revision ưu tiên Render, bỏ qua unknown và hỗ trợ SHA của Docker', async () => {
    const saved = { APP_REVISION: process.env.APP_REVISION, RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT };
    const s = createApp().listen(0);
    const url = `http://127.0.0.1:${s.address().port}/health`;
    try {
      process.env.APP_REVISION = 'unknown';
      process.env.RENDER_GIT_COMMIT = 'b'.repeat(40);
      assert.equal((await (await fetch(url)).json()).revision, 'b'.repeat(40));
      delete process.env.RENDER_GIT_COMMIT;
      assert.equal((await (await fetch(url)).json()).revision, null);
      process.env.APP_REVISION = 'c'.repeat(40);
      assert.equal((await (await fetch(url)).json()).revision, 'c'.repeat(40));
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await new Promise((resolve) => s.close(resolve));
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
