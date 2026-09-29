const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');

process.env.REDIS_KEY_PREFIX = `seat-map-test:${process.pid}:`;

const db = require('../db');
const createApp = require('../app');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');
const { createSeatMapService } = require('../services/seatMapService');

const service = createSeatMapService(db);
const seatMap = (count, category = 'Thường') => Buffer.from(JSON.stringify({
  seats: Array.from({ length: count }, (_, index) => ({
    row: String.fromCharCode(65 + Math.floor(index / 100)),
    number: index % 100 + 1,
    category,
  })),
}));

describe('T-11 / T-12 seat map migration and import', () => {
  let server;
  let baseUrl;
  let owner;
  let other;
  let buyer;
  let showtime;
  let secondShowtime;
  let event;
  let ownerCookie;
  let otherCookie;
  let buyerCookie;
  let createdHolds = false;
  let createdTickets = false;

  async function userWithRole(role, index, hash, roleIds) {
    const [user] = await db('users').insert({
      email: `seat_map_${process.pid}_${index}@example.test`,
      password_hash: hash,
      is_active: true,
    }).returning('*');
    await db('user_roles').insert({ user_id: user.id, role_id: roleIds.get(role) });
    return user;
  }

  async function login(user) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'Password123!@#' }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie');
  }

  async function upload(id, buffer, cookie) {
    const form = new FormData();
    form.set('file', new Blob([buffer], { type: 'application/json' }), 'seats.json');
    const response = await fetch(`${baseUrl}/api/organizer/showtimes/${id}/seats/import`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();
    for (const name of ['organizer', 'buyer']) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const roles = await db('roles').whereIn('name', ['organizer', 'buyer']).select('id', 'name');
    const roleIds = new Map(roles.map((role) => [role.name, role.id]));
    const hash = await argon2.hash('Password123!@#', { type: argon2.argon2id });
    owner = await userWithRole('organizer', 1, hash, roleIds);
    other = await userWithRole('organizer', 2, hash, roleIds);
    buyer = await userWithRole('buyer', 3, hash, roleIds);
    [event] = await db('events').insert({
      title: 'Seat map integration test', venue: 'Test venue', status: 'draft', owner_id: owner.id,
    }).returning('*');
    [showtime] = await db('showtimes').insert({
      event_id: event.id, starts_at: new Date('2027-12-01T12:00:00Z'),
    }).returning('*');
    [secondShowtime] = await db('showtimes').insert({
      event_id: event.id, starts_at: new Date('2027-12-02T12:00:00Z'),
    }).returning('*');

    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    ownerCookie = await login(owner);
    otherCookie = await login(other);
    buyerCookie = await login(buyer);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (createdTickets) await db.schema.dropTableIfExists('tickets');
    if (createdHolds) await db.schema.dropTableIfExists('seat_holds');
    if (event) {
      await db('showtimes').where({ event_id: event.id }).del();
      await db('events').where({ id: event.id }).del();
    }
    const ids = [owner?.id, other?.id, buyer?.id].filter(Boolean);
    if (ids.length) {
      await db('user_roles').whereIn('user_id', ids).del();
      await db('users').whereIn('id', ids).del();
    }
    if (redisClient.isOpen) {
      let cursor = 0;
      do {
        const reply = await redisClient.scan(cursor, {
          MATCH: `seat-map-test:${process.pid}:*`, COUNT: 100,
        });
        cursor = reply.cursor;
        if (reply.keys.length) await redisClient.del(reply.keys);
      } while (cursor !== 0);
    }
    await closeRedis();
    await db.destroy();
  });

  test('schema has showtime indexes, unique seat coordinate and same-showtime category FK', async () => {
    const indexes = await db('pg_indexes').whereIn('tablename', ['seats', 'seat_categories'])
      .select('tablename', 'indexdef');
    assert.ok(indexes.some((row) => row.tablename === 'seats' && /\(showtime_id\)/.test(row.indexdef)));
    assert.ok(indexes.some((row) => row.tablename === 'seat_categories' && /\(showtime_id\)/.test(row.indexdef)));

    const [category] = await db('seat_categories').insert({
      showtime_id: showtime.id, name: 'VIP',
    }).returning('*');
    const [otherCategory] = await db('seat_categories').insert({
      showtime_id: secondShowtime.id, name: 'VIP',
    }).returning('*');
    const seat = { showtime_id: showtime.id, category_id: category.id, row_label: 'A', seat_number: 1 };
    await db('seats').insert(seat);
    await assert.rejects(db('seats').insert(seat), { code: '23505' });
    await assert.rejects(db('seats').insert({ ...seat, seat_number: 2, category_id: otherCategory.id }),
      { code: '23503' });
  });

  test('endpoint requires organizer ownership and a multipart file', async () => {
    assert.equal((await upload(showtime.id, seatMap(1), null)).status, 401);
    assert.equal((await upload(showtime.id, seatMap(1), buyerCookie)).status, 403);
    assert.equal((await upload(showtime.id, seatMap(1), otherCookie)).status, 403);
    const missing = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/seats/import`, {
      method: 'POST', headers: { cookie: ownerCookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(missing.status, 415);
    assert.equal((await upload(showtime.id, Buffer.from('{bad'), ownerCookie)).status, 400);
    const duplicate = Buffer.from(JSON.stringify({ seats: [
      { row: 'A', number: 1, category: 'VIP' },
      { row: 'A', number: 1, category: 'Thường' },
    ] }));
    assert.equal((await upload(showtime.id, duplicate, ownerCookie)).status, 400);
    assert.equal((await upload(showtime.id, Buffer.alloc(5 * 1024 * 1024 + 1), ownerCookie)).status, 413);
  });

  test('2,000 seats import in less than 5 seconds and categories are deduplicated', async () => {
    const sample = JSON.parse(seatMap(2000));
    sample.seats.forEach((seat, index) => { seat.category = index % 2 ? 'VIP' : 'Thường'; });
    const started = performance.now();
    const result = await upload(showtime.id, Buffer.from(JSON.stringify(sample)), ownerCookie);
    const elapsed = performance.now() - started;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.seats_count, 2000);
    assert.equal(result.body.data.categories_count, 2);
    assert.ok(elapsed < 5000, `2,000-seat import took ${Math.round(elapsed)} ms`);
    const [{ count }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(count), 2000);
  });

  test('late DB failure rolls back every seat, and failed replacement preserves old map', async () => {
    const invalid = JSON.parse(seatMap(2000));
    invalid.seats[1999].row = 'X'.repeat(33); // Exceeds the DB column width at the last seat.
    assert.equal((await upload(secondShowtime.id, Buffer.from(JSON.stringify(invalid)), ownerCookie)).status, 400);
    const [{ count: empty }] = await db('seats').where({ showtime_id: secondShowtime.id }).count('* as count');
    assert.equal(Number(empty), 0);
    assert.equal((await upload(showtime.id, Buffer.from(JSON.stringify(invalid)), ownerCookie)).status, 400);
    const [{ count: preserved }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(preserved), 2000);
  });

  test('expired holds do not block; active holds and tickets block replacement', async () => {
    if (!await db.schema.hasTable('seat_holds')) {
      await db.schema.createTable('seat_holds', (table) => {
        table.increments('id').primary();
        table.string('seat_id').notNullable(); // Legacy hold schema has no showtime FK.
        table.timestamp('expires_at', { useTz: true }).notNullable();
      });
      createdHolds = true;
    }
    await db('seat_holds').insert({ seat_id: 'legacy-A1', expires_at: new Date(Date.now() - 1000) });
    assert.equal((await upload(showtime.id, seatMap(10), ownerCookie)).status, 200);
    await db('seat_holds').insert({ seat_id: 'legacy-A2', expires_at: new Date(Date.now() + 60000) });
    assert.equal((await upload(showtime.id, seatMap(5), ownerCookie)).status, 409);
    await db('seat_holds').del();

    if (!await db.schema.hasTable('tickets')) {
      await db.schema.createTable('tickets', (table) => {
        table.increments('id').primary();
        table.integer('showtime_id').notNullable();
      });
      createdTickets = true;
    }
    await db('tickets').insert({ showtime_id: showtime.id });
    assert.equal((await upload(showtime.id, seatMap(5), ownerCookie)).status, 409);
    const [{ count }] = await db('seats').where({ showtime_id: showtime.id }).count('* as count');
    assert.equal(Number(count), 10);
  });

  test('concurrent imports leave one complete map, never mixed or double-booked', async () => {
    const results = await Promise.all([
      service.importSeatMap(secondShowtime.id, seatMap(800, 'Red'), owner),
      service.importSeatMap(secondShowtime.id, seatMap(900, 'Blue'), owner),
    ]);
    assert.deepEqual(results.map((result) => result.seats_count).sort(), [800, 900]);
    const [{ count }] = await db('seats').where({ showtime_id: secondShowtime.id }).count('* as count');
    assert.equal(Number(count), 900);
    const categories = await db('seat_categories').where({ showtime_id: secondShowtime.id });
    assert.deepEqual(categories.map((category) => category.name), ['Blue']);
  });
});
