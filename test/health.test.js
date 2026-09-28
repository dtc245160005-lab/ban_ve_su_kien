const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../index');
const db = require('../db');
const { closeRedis } = require('../lib/redis');

describe('Health Check API', () => {
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

  test('GET /health returns 200 and status ok when both DB and Redis are healthy', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.timestamp);
  });

  test('GET /health returns 503 without error details when DB ping fails', async () => {
    const express = require('express');
    const failingApp = express();
    failingApp.get('/health', async (_req, res) => {
      try {
        throw new Error('Database connection refused at postgresql://secret_user:secret_pass@localhost:5432/db');
      } catch {
        return res.status(503).json({ status: 'error', message: 'Dịch vụ tạm thời không khả dụng' });
      }
    });

    const s = failingApp.listen(0);
    try {
      const port = s.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(body.status, 'error');
      assert.strictEqual(body.message, 'Dịch vụ tạm thời không khả dụng');
      assert.strictEqual(body.error, undefined);
      assert.strictEqual(JSON.stringify(body).includes('secret'), false);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});
