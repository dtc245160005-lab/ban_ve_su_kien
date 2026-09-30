const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const argon2 = require('argon2');

process.env.REDIS_KEY_PREFIX = `seat-map-val-api:${process.pid}:`;

const db = require('../db');
const createApp = require('../app');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');

describe('T-13 / S-06 Seat Map Validate API Tests', () => {
  let server;
  let baseUrl;
  let owner;
  let showtime;
  let event;
  let ownerCookie;

  async function login(user) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'Password123!@#' }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie');
  }

  async function uploadFile(showtimeId, filePath, cookie) {
    const content = fs.readFileSync(filePath);
    const form = new FormData();
    form.set('file', new Blob([content], { type: 'application/json' }), path.basename(filePath));
    const response = await fetch(`${baseUrl}/api/organizer/showtimes/${showtimeId}/seats/import`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();

    for (const name of ['organizer', 'buyer', 'admin']) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const roles = await db('roles').whereIn('name', ['organizer']).select('id', 'name');
    const roleId = roles[0].id;
    const hash = await argon2.hash('Password123!@#', { type: argon2.argon2id });

    [owner] = await db('users').insert({
      email: `seat_val_${process.pid}_${Date.now()}@example.test`,
      password_hash: hash,
      is_active: true,
    }).returning('*');
    await db('user_roles').insert({ user_id: owner.id, role_id: roleId });

    [event] = await db('events').insert({
      title: 'Seat map validation API test',
      venue: 'Test venue',
      status: 'draft',
      owner_id: owner.id,
    }).returning('*');

    [showtime] = await db('showtimes').insert({
      event_id: event.id,
      starts_at: new Date('2028-01-01T12:00:00Z'),
    }).returning('*');

    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    ownerCookie = await login(owner);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (showtime) {
      await db('seats').where({ showtime_id: showtime.id }).del();
      await db('seat_categories').where({ showtime_id: showtime.id }).del();
      await db('showtimes').where({ id: showtime.id }).del();
    }
    if (event) {
      await db('events').where({ id: event.id }).del();
    }
    if (owner) {
      await db('user_roles').where({ user_id: owner.id }).del();
      await db('users').where({ id: owner.id }).del();
    }
    if (redisClient.isOpen) {
      let cursor = 0;
      do {
        const reply = await redisClient.scan(cursor, {
          MATCH: `seat-map-val-api:${process.pid}:*`,
          COUNT: 100,
        });
        cursor = reply.cursor;
        if (reply.keys.length) await redisClient.del(reply.keys);
      } while (cursor !== 0);
    }
    await closeRedis();
    await db.destroy();
  });

  test('POST import với multi-error.json -> 400 kèm errors đầy đủ, bảng seats/seat_categories KHÔNG thay đổi', async () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/multi-error.json');
    const result = await uploadFile(showtime.id, fixturePath, ownerCookie);

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.ok(Array.isArray(result.body.errors));
    assert.equal(result.body.errors.length, 10);

    const [{ count: seatsCount }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    const [{ count: catCount }] = await db('seat_categories').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(seatsCount), 0);
    assert.equal(Number(catCount), 0);
  });

  test('POST import với invalid-json.json -> 400 kèm thông tin vị trí ký tự/dòng cột, không trả 500', async () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/invalid-json.json');
    const result = await uploadFile(showtime.id, fixturePath, ownerCookie);

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.ok(Array.isArray(result.body.errors));
    assert.equal(result.body.errors.length, 1);
    assert.equal(result.body.errors[0].code, 'INVALID_JSON');
    assert.ok(result.body.errors[0].line !== null);
  });

  test('POST import với valid-small.json -> 200 và nạp thành công dữ liệu vào DB', async () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/valid-small.json');
    const result = await uploadFile(showtime.id, fixturePath, ownerCookie);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.seats_count, 10);
    assert.equal(result.body.data.categories_count, 2);

    const [{ count: seatsCount }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(seatsCount), 10);
    const categories = await db('seat_categories').where({ showtime_id: showtime.id }).select('name');
    assert.deepEqual(categories.map((c) => c.name).sort(), ['Thường', 'VIP']);
  });

  test('POST import với duplicate.json -> 400 và giữ nguyên sơ đồ cũ trong DB', async () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/duplicate.json');
    const result = await uploadFile(showtime.id, fixturePath, ownerCookie);

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.ok(Array.isArray(result.body.errors));
    assert.ok(result.body.errors.some((e) => e.code === 'DUPLICATE_SEAT'));

    // Giữ nguyên 10 ghế của lần nạp valid-small trước đó
    const [{ count: seatsCount }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(seatsCount), 10);
  });

  test('Máy chủ giới hạn 5 MB: gửi tệp 5 MB + 1 byte tới API import thì nhận 413, DB không đổi', async () => {
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 32);
    const form = new FormData();
    form.set('file', new Blob([largeBuffer], { type: 'application/json' }), 'too-large.json');
    const response = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/seats/import`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
      body: form,
    });
    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.message, /vượt quá 5 MB/);

    const [{ count: seatsCount }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(seatsCount), 10);
  });

  test('Kiểm tra chạy trước transaction: bọc db.transaction bằng spy; gửi multi-error.json thì spy KHÔNG được gọi', async () => {
    let transactionCalled = false;
    const originalTransaction = db.transaction.bind(db);
    db.transaction = async function (...args) {
      transactionCalled = true;
      return originalTransaction(...args);
    };

    try {
      const fixturePath = path.join(__dirname, 'fixtures/seatmaps/multi-error.json');
      const result = await uploadFile(showtime.id, fixturePath, ownerCookie);
      assert.equal(result.status, 400);
      assert.equal(transactionCalled, false, 'db.transaction không được phép gọi khi validation thất bại');
    } finally {
      db.transaction = originalTransaction;
    }
  });

  test('Khi máy chủ trả 400 thì body có luôn cờ truncated lấy từ validator', async () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/multi-error.json');
    const result = await uploadFile(showtime.id, fixturePath, ownerCookie);
    assert.equal(result.status, 400);
    assert.strictEqual(result.body.truncated, false);

    const brokenSeats = Array.from({ length: 250 }, (_, i) => ({
      row: '',
      number: -i,
      category: '',
    }));
    const form = new FormData();
    form.set('file', new Blob([Buffer.from(JSON.stringify({ seats: brokenSeats }))], { type: 'application/json' }), 'truncated.json');
    const response = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/seats/import`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
      body: form,
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.truncated, true);
    assert.equal(body.errors.length, 200);
  });
});
