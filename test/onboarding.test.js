const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { inspectEnvironment } = require('../scripts/doctor');
const { setup } = require('../scripts/setup');
const { checkStaging } = require('../scripts/check-staging');
require('dotenv').config({ quiet: true });

test('Onboarding: fresh database, repeatable setup, healthy server and both demo logins', { timeout: 60000 }, async () => {
  const database = `ban_ve_onboarding_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const adminUrl = new URL(process.env.DB_CONNECTION_STRING);
  adminUrl.pathname = '/postgres';
  const target = new URL(adminUrl);
  target.pathname = `/${database}`;
  const saved = { DB_CONNECTION_STRING: process.env.DB_CONNECTION_STRING,
    NODE_ENV: process.env.NODE_ENV, MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
    REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX };
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  let created = false;
  let server;
  let db;
  let redisModule;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    Object.assign(process.env, { DB_CONNECTION_STRING: target.toString(), NODE_ENV: 'test',
      MAIL_TRANSPORT: 'dev', REDIS_KEY_PREFIX: `bvsk-onboarding:${crypto.randomUUID()}:` });
    const fresh = await inspectEnvironment();
    assert.equal(fresh.errors.length, 0, 'Fresh database preflight must pass.');
    assert.ok(fresh.pending.length > 0, 'Fresh database must have migrations pending.');
    const run = (command, args, options) => spawnSync(command, args,
      { ...options, stdio: 'pipe', encoding: 'utf8', timeout: 20000 });
    await setup({ run });
    await setup({ run });
    const ready = await inspectEnvironment({ requireConfiguredDatabase: true });
    assert.equal(ready.errors.length, 0);
    assert.equal(ready.pending.length, 0);
    db = require('../db');
    redisModule = require('../lib/redis');
    server = await require('../index').start({ port: 0, revision: 'a'.repeat(40) });
    const url = `http://127.0.0.1:${server.address().port}`;
    const health = await checkStaging({ url, expectedRevision: 'a'.repeat(40) });
    assert.equal(health.health, 'PASS');
    assert.equal(health.pages, 'PASS');
    for (const role of ['ADMIN', 'ORGANIZER']) {
      const login = await fetch(`${url}/api/auth/login`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          email: process.env[`DEMO_${role}_EMAIL`], password: process.env[`DEMO_${role}_PASSWORD`],
        }) });
      assert.equal(login.status, 200, `${role} demo login must succeed.`);
      assert.ok(login.headers.get('set-cookie'), 'Login must issue a session cookie.');
      await login.body.cancel();
    }
    assert.equal(Number((await db('users').count('* as count').first()).count), 2);
    assert.equal(Number((await db('roles').count('* as count').first()).count), 5);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (redisModule) {
      const redis = await redisModule.getRedis();
      try {
        for await (const key of redis.scanIterator({ MATCH: `${process.env.REDIS_KEY_PREFIX}*`, COUNT: 100 })) {
          await redis.del(key);
        }
      } finally { await redisModule.closeRedis(); }
    }
    if (db) await db.destroy();
    try { if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
    finally {
      await admin.end().catch(() => {});
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
});
