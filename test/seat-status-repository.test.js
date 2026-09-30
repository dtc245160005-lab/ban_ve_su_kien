const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');
const { createSeatStatusRepository } = require('../services/seatStatusRepository');
const { createSeatStatusService } = require('../services/seatStatusService');

describe('T-19 PostgreSQL hot query', () => {
  let user;
  let event;
  let showtime;
  let service;

  before(async () => {
    await db.raw('SELECT 1');
    const passwordHash = await argon2.hash('Password123!@#', { type: argon2.argon2id });
    [user] = await db('users').insert({
      email: `seat_status_${process.pid}@example.test`,
      password_hash: passwordHash,
      is_active: true,
    }).returning('*');
    [event] = await db('events').insert({
      title: 'T-19 benchmark',
      venue: 'Test venue',
      status: 'published',
      owner_id: user.id,
    }).returning('*');
    [showtime] = await db('showtimes').insert({
      event_id: event.id,
      starts_at: new Date('2027-12-01T12:00:00Z'),
      room_name: 'Phòng kiểm thử',
    }).returning('*');
    const categories = await db('seat_categories').insert([
      { showtime_id: showtime.id, name: 'VIP' },
      { showtime_id: showtime.id, name: 'Thường' },
    ]).returning('*');
    await db('seats').insert(Array.from({ length: 2000 }, (_, index) => ({
      showtime_id: showtime.id,
      category_id: categories[index % 2].id,
      row_label: `R${String(Math.floor(index / 50) + 1).padStart(2, '0')}`,
      seat_number: (index % 50) + 1,
    })));
    service = createSeatStatusService({ repository: createSeatStatusRepository(db) });
  });

  after(async () => {
    if (showtime) await db('showtimes').where({ id: showtime.id }).del();
    if (event) await db('events').where({ id: event.id }).del();
    if (user) await db('users').where({ id: user.id }).del();
    await db.destroy();
  });

  test('đọc 2.000 ghế bằng đúng một query và dưới 200 ms', async () => {
    await service.getSeatMap(showtime.id);
    let queryCount = 0;
    const countQuery = () => { queryCount += 1; };
    db.on('query', countQuery);
    const started = performance.now();
    const result = await service.getSeatMap(showtime.id);
    const durationMs = performance.now() - started;
    db.removeListener('query', countQuery);

    assert.equal(queryCount, 1);
    assert.equal(result.seats.length, 2000);
    assert.deepEqual(result.summary, { AVAILABLE: 2000, HELD: 0, SOLD: 0 });
    assert.ok(durationMs < 200, `T-19 hot query took ${Math.round(durationMs)} ms`);
  });

  test('nhiều lượt đọc đồng thời trả về cùng một sơ đồ hoàn chỉnh', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.getSeatMap(showtime.id)),
    );
    assert.ok(results.every((result) => result.seats.length === 2000));
    assert.ok(results.every((result) => result.seats[0].code === 'R01-001'));
    assert.ok(results.every((result) => result.seats.at(-1).code === 'R40-050'));
  });
});
