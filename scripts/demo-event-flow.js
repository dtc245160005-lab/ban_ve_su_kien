const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const argon2 = require('argon2');
require('dotenv').config();

const baseUrl = process.env.DB_CONNECTION_STRING;
if (!baseUrl) {
  console.error('DB_CONNECTION_STRING is required in .env.');
  process.exit(1);
}

const databaseName = `ban_ve_demo_${Date.now()}_${process.pid}`;
const demoUrl = new URL(baseUrl);
demoUrl.pathname = `/${databaseName}`;
const redisPrefix = `bvsk-demo:${databaseName}:`;
const port = 8091;
const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;

let adminClient;
let db;
let server;
let databaseCreated = false;
let shuttingDown = false;

async function cleanUp() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    const { getRedis, closeRedis } = require('../lib/redis');
    const redis = await getRedis();
    let cursor = 0;
    do {
      const reply = await redis.scan(cursor, { MATCH: `${redisPrefix}*`, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length) await redis.del(reply.keys);
    } while (cursor !== 0);
    await closeRedis();
  } catch {
    // Redis may already be stopped.
  }
  if (db) await db.destroy();
  if (adminClient) {
    if (databaseCreated) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      console.log('Demo database removed.');
    }
    await adminClient.end();
  }
}

async function main() {
  adminClient = new Client({ connectionString: baseUrl });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;

  process.env.DB_CONNECTION_STRING = demoUrl.toString();
  process.env.NODE_ENV = 'development';
  process.env.MAIL_TRANSPORT = 'dev';
  process.env.REDIS_KEY_PREFIX = redisPrefix;
  process.env.TRUST_PROXY = 'false';

  db = require('../db');
  await db.migrate.latest({ directory: path.resolve(__dirname, '../migrations') });

  for (const name of ['buyer', 'organizer']) {
    await db('roles').insert({ name }).onConflict('name').ignore();
  }
  const roles = await db('roles').whereIn('name', ['buyer', 'organizer']).select('id', 'name');
  const roleIds = new Map(roles.map((role) => [role.name, role.id]));
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const accounts = {};

  for (const role of ['buyer', 'organizer']) {
    const email = `${role}-demo@local.test`;
    const [user] = await db('users').insert({
      email,
      password_hash: passwordHash,
      is_active: true,
    }).returning('id');
    await db('user_roles').insert({ user_id: user.id, role_id: roleIds.get(role) });
    accounts[role] = { email, id: user.id };
  }

  const [event] = await db('events').insert({
    owner_id: accounts.organizer.id,
    title: 'Demo su kien: nap ghe va xuat ban',
    venue: 'Phong thu nghiem',
    description: 'Nap so do ghe JSON, sau do xuat ban de nguoi mua nhin thay.',
    status: 'draft',
  }).returning('id');
  await db('showtimes').insert({
    event_id: event.id,
    starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    room_name: 'Phong A',
  });

  const { getRedis } = require('../lib/redis');
  await getRedis();
  const createApp = require('../app');
  server = await new Promise((resolve, reject) => {
    const listener = createApp().listen(port, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });

  console.log(`Demo is running at http://localhost:${port}/login.html`);
  console.log(`Organizer: ${accounts.organizer.email}`);
  console.log(`Buyer: ${accounts.buyer.email}`);
  console.log(`One-time demo password: ${password}`);
  console.log('Press Ctrl+C to stop and remove the temporary database.');

  process.once('SIGINT', () => cleanUp().then(() => process.exit(0)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  }));
  process.once('SIGTERM', () => cleanUp().then(() => process.exit(0)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  }));
}

main().catch(async (error) => {
  console.error(`Cannot start demo: ${error.message}`);
  await cleanUp().catch((cleanupError) => console.error(`Cannot clean up demo: ${cleanupError.message}`));
  process.exitCode = 1;
});
