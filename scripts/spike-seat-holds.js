// K-01: experiment only. This is not the production seat-hold service.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { Client, Pool } = require('pg');
const { createClient } = require('redis');

const REQUESTS = 200;
const LEASE_MS = 10 * 60 * 1000;
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)].toFixed(3));
}
async function race(acquire, count = REQUESTS) {
  const started = performance.now();
  // All 200 promises are submitted before waiting; PostgreSQL uses a pool of 20.
  const results = await Promise.all(Array.from({ length: count }, async (_, owner) => {
    const before = performance.now();
    try { return { won: await acquire(String(owner)), latency: performance.now() - before }; }
    catch { return { error: true, latency: performance.now() - before }; }
  }));
  const sample = {
    requests: count,
    successes: results.filter((r) => r.won).length,
    conflicts: results.filter((r) => !r.error && !r.won).length,
    errors: results.filter((r) => r.error).length,
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    p50Ms: percentile(results.map((r) => r.latency), 0.5),
    p95Ms: percentile(results.map((r) => r.latency), 0.95),
  };
  assert.equal(sample.successes, 1, 'One seat must have exactly one winner.');
  assert.equal(sample.conflicts, count - 1);
  assert.equal(sample.errors, 0);
  return sample;
}
function newRedis(url) {
  const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => {});
  return client;
}
async function runSpike({ connectionString = process.env.DB_CONNECTION_STRING,
  redisUrl = process.env.REDIS_URL || 'redis://localhost:6379', trials = 5 } = {}) {
  const adminUrl = new URL(connectionString);
  const redisAddress = new URL(redisUrl);
  const local = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!local.has(adminUrl.hostname) || !local.has(redisAddress.hostname)) {
    throw new Error('K-01 chỉ chạy với PostgreSQL/Redis localhost; không chạy trên staging/production.');
  }
  if (!Number.isInteger(trials) || trials < 2) throw new Error('K-01 requires at least two trials.');
  adminUrl.pathname = '/postgres';
  const database = `ban_ve_k01_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${database}`;
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  const poolConfig = { connectionString: testUrl.toString(), max: 20, connectionTimeoutMillis: 5000 };
  let pool;
  let redis;
  let created = false;
  const keys = [];
  const prefix = `bvsk-k01:${crypto.randomUUID()}:`;
  let completed;
  const failures = [];
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    pool = new Pool(poolConfig);
    const version = (await pool.query('SHOW server_version')).rows[0].server_version;
    await pool.query(`CREATE TABLE seat_holds (
      showtime_id integer NOT NULL,
      seat_id integer NOT NULL,
      owner_id text NOT NULL,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (showtime_id, seat_id)
    )`);
    redis = newRedis(redisUrl);
    await redis.connect();
    const redisVersion = (await redis.info('server')).match(/redis_version:([^\r\n]+)/)?.[1];
    // Warm both providers before comparing request latency.
    await Promise.all(Array.from({ length: 20 }, () => pool.query('SELECT 1')));
    await redis.ping();
    const acquirePg = (seat, owner) => pool.query(`
      INSERT INTO seat_holds (showtime_id, seat_id, owner_id, expires_at)
      VALUES (1, $1, $2, clock_timestamp() + $3 * interval '1 millisecond')
      ON CONFLICT (showtime_id, seat_id) DO UPDATE
      SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at
      WHERE seat_holds.expires_at <= clock_timestamp()
      RETURNING seat_id`, [seat, owner, LEASE_MS]).then((r) => r.rowCount === 1);
    const results = { measuredAt: new Date().toISOString(), environment: {
      platform: `${os.platform()} ${os.release()}`, node: process.version,
      postgres: version, redis: redisVersion, postgresPoolSize: 20,
      requestsPerTrial: REQUESTS, seatsPerTrial: 1, leaseMs: LEASE_MS,
    }, redis: [], postgres: [] };
    for (let trial = 0; trial < trials; trial++) {
      const key = `${prefix}${trial}`;
      keys.push(key);
      const acquireRedis = (owner) => redis.set(key, owner, { NX: true, PX: LEASE_MS })
        .then((reply) => reply === 'OK');
      // Alternate ordering to reduce warm-cache/order bias.
      if (trial % 2 === 0) {
        results.redis.push(await race(acquireRedis));
        results.postgres.push(await race((owner) => acquirePg(trial, owner)));
      } else {
        results.postgres.push(await race((owner) => acquirePg(trial, owner)));
        results.redis.push(await race(acquireRedis));
      }
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM seat_holds WHERE seat_id=$1', [trial])).rows[0].count, 1);
    }
    // Reconnecting clients models application restart, not database/server restart.
    await redis.quit();
    redis = newRedis(redisUrl);
    await redis.connect();
    assert.notEqual(await redis.get(keys[0]), null);
    await pool.end();
    pool = new Pool(poolConfig);
    assert.equal(await acquirePg(0, 'after-reconnect'), false);
    // Force expiry to avoid waiting ten minutes; reclamation must work without a worker.
    await redis.pExpire(keys[0], 1);
    const deadline = performance.now() + 5000;
    while (await redis.get(keys[0]) !== null) {
      if (performance.now() > deadline) throw new Error('Redis expiry timed out.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(await redis.set(keys[0], 'after-expiry', { NX: true, PX: LEASE_MS }), 'OK');
    await pool.query("UPDATE seat_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE seat_id=0");
    assert.equal(await acquirePg(0, 'after-expiry'), true);
    // Expired PostgreSQL records are harmless even if the cleanup worker is stopped.
    await pool.query("UPDATE seat_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE seat_id=0");
    const firstCleanup = (await pool.query('DELETE FROM seat_holds WHERE expires_at <= clock_timestamp()')).rowCount;
    const secondCleanup = (await pool.query('DELETE FROM seat_holds WHERE expires_at <= clock_timestamp()')).rowCount;
    assert.equal(firstCleanup, 1);
    assert.equal(secondCleanup, 0);
    // Scoped key loss simulates loss of volatile lock data; never FLUSHDB.
    await redis.del(keys[1]);
    assert.equal(await redis.set(keys[1], 'after-key-loss', { NX: true, PX: LEASE_MS }), 'OK');
    results.scenarios = { applicationReconnect: 'PASS', expiryReclaim: 'PASS',
      postgresCleanupIdempotent: 'PASS', redisKeyLossAllowsNewOwner: true,
      serverRestartTested: false };
    completed = results;
  } finally {
    // Each cleanup must still execute when a different provider is unavailable.
    if (redis?.isOpen) {
      try { if (keys.length) await redis.del(keys); } catch { failures.push('Redis keys'); }
      try { await redis.quit(); } catch { if (redis.isOpen) await redis.disconnect(); }
    }
    if (pool) { try { await pool.end(); } catch { failures.push('PostgreSQL pool'); } }
    try {
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } catch { failures.push(`temporary database ${database}`); }
    finally { await admin.end().catch(() => {}); }
  }
  if (failures.length) throw new Error(`K-01 cleanup failed: ${failures.join(', ')}`);
  return completed;
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  runSpike().then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch(() => { console.error('K-01: FAIL (kiểm tra kết nối hoặc điều kiện cạnh tranh)'); process.exitCode = 1; });
}
module.exports = { race, percentile, runSpike };
