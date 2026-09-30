const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');
const { createExpiredSeatHoldsJob } = require('../jobs/expiredSeatHolds');
const { createSeatStatusRepository } = require('../services/seatStatusRepository');
const { createSeatStatusService } = require('../services/seatStatusService');

describe('T-27/T-28 expired seat holds with PostgreSQL time', () => {
  let user;
  let event;
  let showtime;
  let seats;

  before(async () => {
    const passwordHash = await argon2.hash('Password123!@#', { type: argon2.argon2id });
    [user] = await db('users').insert({
      email: `s12_${process.pid}@example.test`,
      password_hash: passwordHash,
      is_active: true,
    }).returning('*');
    [event] = await db('events').insert({
      title: 'S-12 expiry test',
      venue: 'Test venue',
      status: 'published',
      owner_id: user.id,
    }).returning('*');
    [showtime] = await db('showtimes').insert({
      event_id: event.id,
      starts_at: db.raw("CURRENT_TIMESTAMP + INTERVAL '7 days'"),
      room_name: 'S-12',
    }).returning('*');
    const [category] = await db('seat_categories').insert({
      showtime_id: showtime.id,
      name: 'Standard',
    }).returning('*');
    seats = await db('seats').insert(
      Array.from({ length: 104 }, (_, index) => ({
        showtime_id: showtime.id,
        category_id: category.id,
        row_label: index < 4 ? 'A' : 'B',
        seat_number: index < 4 ? index + 1 : index - 3,
      })),
    ).returning('*');
  });

  beforeEach(async () => {
    await db('seat_holds').whereIn('seat_id', seats.map(({ id }) => id)).del();
  });

  after(async () => {
    if (showtime) await db('showtimes').where({ id: showtime.id }).del();
    if (event) await db('events').where({ id: event.id }).del();
    if (user) await db('users').where({ id: user.id }).del();
    await db.destroy();
  });

  test('migration tạo đúng bảng, khóa ngoại và các index phục vụ quét hạn', async () => {
    assert.equal(await db.schema.hasTable('seat_holds'), true);
    for (const column of ['seat_id', 'user_id', 'order_id', 'expires_at', 'created_at']) {
      assert.equal(await db.schema.hasColumn('seat_holds', column), true, `thiếu cột ${column}`);
    }

    const indexes = await db('pg_indexes')
      .where({ schemaname: 'public', tablename: 'seat_holds' })
      .select('indexdef');
    const definitions = indexes.map(({ indexdef }) => indexdef).join('\n');
    assert.match(definitions, /\(expires_at\)/);
    assert.match(definitions, /\(seat_id, expires_at\)/);
  });

  test('job chỉ xóa lượt giữ đã hết hạn và chưa gắn đơn; chạy lại không đổi kết quả', async () => {
    await db('seat_holds').insert([
      {
        seat_id: seats[0].id,
        user_id: user.id,
        expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '5 minutes'"),
      },
      {
        seat_id: seats[1].id,
        user_id: user.id,
        expires_at: db.raw("CURRENT_TIMESTAMP + INTERVAL '5 minutes'"),
      },
      {
        seat_id: seats[2].id,
        user_id: user.id,
        order_id: 9001,
        expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '5 minutes'"),
      },
    ]);
    const logs = [];
    const job = createExpiredSeatHoldsJob({
      db,
      logger: (eventName, payload) => logs.push({ eventName, ...payload }),
    });

    assert.equal(await job.runOnce(), 1);
    assert.equal(await job.runOnce(), 0);

    const remaining = await db('seat_holds')
      .whereIn('seat_id', [seats[0].id, seats[1].id, seats[2].id])
      .orderBy('seat_id');
    assert.deepEqual(remaining.map(({ seat_id }) => seat_id), [seats[1].id, seats[2].id]);
    assert.deepEqual(logs.map(({ count }) => count), [1, 0]);
  });

  test('khởi động job dọn toàn bộ backlog và nhiều runOnce đồng thời vẫn idempotent', async () => {
    await db('seat_holds').insert(seats.slice(4).map((seat) => ({
      seat_id: seat.id,
      user_id: user.id,
      expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'"),
    })));
    const logs = [];
    const job = createExpiredSeatHoldsJob({
      db,
      logger: (eventName, payload) => logs.push({ eventName, ...payload }),
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
    });

    await job.start();
    job.stop();
    assert.equal(await db('seat_holds').whereIn('seat_id', seats.slice(4).map(({ id }) => id)).count('* as count').first().then((row) => Number(row.count)), 0);
    assert.equal(logs[0].count, 100);

    await db('seat_holds').insert(seats.slice(4).map((seat) => ({
      seat_id: seat.id,
      user_id: user.id,
      expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'"),
    })));
    logs.length = 0;
    const counts = await Promise.all(Array.from({ length: 20 }, () => job.runOnce()));
    assert.deepEqual(counts, Array(20).fill(100));
    assert.equal(logs.length, 1, 'các lượt chạy chồng nhau phải được gộp');
    assert.equal(await db('seat_holds').whereIn('seat_id', seats.slice(4).map(({ id }) => id)).count('* as count').first().then((row) => Number(row.count)), 0);
  });

  test('API coi lượt giữ vừa hết hạn là AVAILABLE trước khi job chạy và không dùng clock của app', async () => {
    await db('seat_holds').insert([
      {
        seat_id: seats[0].id,
        user_id: user.id,
        expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '1 millisecond'"),
      },
      {
        seat_id: seats[1].id,
        user_id: user.id,
        expires_at: db.raw("CURRENT_TIMESTAMP + INTERVAL '5 minutes'"),
      },
      {
        seat_id: seats[2].id,
        user_id: user.id,
        order_id: 9002,
        expires_at: db.raw("CURRENT_TIMESTAMP - INTERVAL '1 day'"),
      },
    ]);
    const service = createSeatStatusService({
      repository: createSeatStatusRepository(db),
      now: () => new Date('2099-01-01T00:00:00.000Z'),
    });

    const result = await service.getSeatMap(showtime.id);
    const byId = new Map(result.seats.map((seat) => [seat.id, seat.status]));

    assert.equal(byId.get(seats[0].id), 'AVAILABLE');
    assert.equal(byId.get(seats[1].id), 'HELD');
    assert.equal(byId.get(seats[2].id), 'HELD', 'lượt giữ gắn đơn không được giải phóng');
    assert.equal(byId.get(seats[3].id), 'AVAILABLE');
    assert.equal(result.generatedAt, '2099-01-01T00:00:00.000Z');
  });
});
